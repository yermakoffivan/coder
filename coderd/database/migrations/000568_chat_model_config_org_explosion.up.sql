-- Copy default-organization chat model configs into each live non-default
-- organization. Referenced soft-deleted configs are copied only into the
-- organizations that reference them.
--
-- The temporary table name is migration-specific because pgTxnDriver runs
-- every migration in one transaction, so temporary tables from other
-- migrations are still visible here.
--
-- 'chat_personal_model_override:root' user config values are not remapped.
-- The key is user-global and has no per-organization remap target, so a
-- cross-organization override falls back to the organization default at
-- chat creation.
CREATE TEMPORARY TABLE chat_model_config_org_fanout_map (
    orig_id uuid NOT NULL,
    org_id uuid NOT NULL,
    copy_id uuid NOT NULL,
    PRIMARY KEY (orig_id, org_id)
) ON COMMIT DROP;

INSERT INTO chat_model_config_org_fanout_map (orig_id, org_id, copy_id)
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
--
-- A live copy of the default config gives up is_default when the
-- destination organization already owns a live default config, because
-- idx_chat_model_configs_single_default permits one per organization. The
-- subquery reads the pre-statement snapshot, so it never sees the copies
-- that this statement inserts.
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
    CASE
        WHEN cmc.is_default AND NOT cmc.deleted THEN NOT EXISTS (
            SELECT 1
            FROM chat_model_configs existing
            WHERE existing.organization_id = m.org_id
              AND existing.is_default
              AND NOT existing.deleted
        )
        ELSE cmc.is_default
    END,
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
FROM chat_model_config_org_fanout_map m
JOIN chat_model_configs cmc ON cmc.id = m.orig_id;

UPDATE chats c
SET last_model_config_id = m.copy_id
FROM chat_model_config_org_fanout_map m
WHERE c.last_model_config_id = m.orig_id
  AND m.org_id = c.organization_id;

UPDATE chat_messages mm
SET model_config_id = m.copy_id
FROM chats c, chat_model_config_org_fanout_map m
WHERE c.id = mm.chat_id
  AND mm.model_config_id = m.orig_id
  AND m.org_id = c.organization_id;

UPDATE chat_queued_messages q
SET model_config_id = m.copy_id
FROM chats c, chat_model_config_org_fanout_map m
WHERE c.id = q.chat_id
  AND q.model_config_id = m.orig_id
  AND m.org_id = c.organization_id;

UPDATE chat_debug_runs d
SET model_config_id = m.copy_id
FROM chats c, chat_model_config_org_fanout_map m
WHERE c.id = d.chat_id
  AND d.model_config_id = m.orig_id
  AND m.org_id = c.organization_id;

INSERT INTO user_configs (user_id, key, value)
SELECT uc.user_id, 'chat_compaction_threshold_pct:' || m.copy_id::text, uc.value
FROM user_configs uc
JOIN chat_model_config_org_fanout_map m
  ON uc.key = 'chat_compaction_threshold_pct:' || m.orig_id::text
ON CONFLICT (user_id, key) DO NOTHING;
