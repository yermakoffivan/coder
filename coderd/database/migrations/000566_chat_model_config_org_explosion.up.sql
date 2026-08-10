-- Copy default-organization chat model configs into each live non-default
-- organization. Referenced soft-deleted configs are copied only into the
-- organizations that reference them.
CREATE TEMPORARY TABLE model_config_copy_map (
    orig_id uuid NOT NULL,
    org_id uuid NOT NULL,
    copy_id uuid NOT NULL,
    PRIMARY KEY (orig_id, org_id)
) ON COMMIT DROP;

INSERT INTO model_config_copy_map (orig_id, org_id, copy_id)
SELECT cmc.id, o.id, gen_random_uuid()
FROM chat_model_configs cmc
JOIN organizations def ON def.id = cmc.organization_id AND def.is_default
CROSS JOIN organizations o
WHERE NOT o.is_default
  AND NOT o.deleted
  AND (
    NOT cmc.deleted
    OR EXISTS (
        SELECT 1
        FROM chats c
        WHERE c.last_model_config_id = cmc.id
          AND c.organization_id = o.id
    )
    OR EXISTS (
        SELECT 1
        FROM chat_messages mm
        JOIN chats c ON c.id = mm.chat_id
        WHERE mm.model_config_id = cmc.id
          AND c.organization_id = o.id
    )
    OR EXISTS (
        SELECT 1
        FROM chat_queued_messages q
        JOIN chats c ON c.id = q.chat_id
        WHERE q.model_config_id = cmc.id
          AND c.organization_id = o.id
    )
    OR EXISTS (
        SELECT 1
        FROM chat_debug_runs d
        JOIN chats c ON c.id = d.chat_id
        WHERE d.model_config_id = cmc.id
          AND c.organization_id = o.id
    )
  );

-- Each copy retains the original behavior and audit fields. The everyone
-- group ACL is re-keyed to the destination organization.
INSERT INTO chat_model_configs
    (id, model, display_name, created_by, updated_by, enabled, is_default,
     deleted, deleted_at, created_at, updated_at, context_limit,
     compression_threshold, options, ai_provider_id, organization_id,
     group_acl, user_acl)
SELECT
    m.copy_id,
    cmc.model,
    cmc.display_name,
    cmc.created_by,
    cmc.updated_by,
    cmc.enabled,
    cmc.is_default,
    cmc.deleted,
    cmc.deleted_at,
    cmc.created_at,
    cmc.updated_at,
    cmc.context_limit,
    cmc.compression_threshold,
    cmc.options,
    cmc.ai_provider_id,
    m.org_id,
    jsonb_build_object(
        m.org_id::text,
        COALESCE(
            cmc.group_acl -> cmc.organization_id::text,
            '{"permissions": ["read"]}'::jsonb
        )
    ),
    '{}'::jsonb
FROM model_config_copy_map m
JOIN chat_model_configs cmc ON cmc.id = m.orig_id;

UPDATE chats c
SET last_model_config_id = m.copy_id
FROM model_config_copy_map m
WHERE c.last_model_config_id = m.orig_id
  AND m.org_id = c.organization_id;

UPDATE chat_messages mm
SET model_config_id = m.copy_id
FROM chats c, model_config_copy_map m
WHERE c.id = mm.chat_id
  AND mm.model_config_id = m.orig_id
  AND m.org_id = c.organization_id;

UPDATE chat_queued_messages q
SET model_config_id = m.copy_id
FROM chats c, model_config_copy_map m
WHERE c.id = q.chat_id
  AND q.model_config_id = m.orig_id
  AND m.org_id = c.organization_id;

UPDATE chat_debug_runs d
SET model_config_id = m.copy_id
FROM chats c, model_config_copy_map m
WHERE c.id = d.chat_id
  AND d.model_config_id = m.orig_id
  AND m.org_id = c.organization_id;

INSERT INTO user_configs (user_id, key, value)
SELECT uc.user_id, 'chat_compaction_threshold_pct:' || m.copy_id::text, uc.value
FROM user_configs uc
JOIN model_config_copy_map m
  ON uc.key = 'chat_compaction_threshold_pct:' || m.orig_id::text
ON CONFLICT (user_id, key) DO NOTHING;
