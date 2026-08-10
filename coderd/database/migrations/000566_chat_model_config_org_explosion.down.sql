-- This migration is best-effort because copied configs have no persisted
-- provenance. A non-default config is treated as a copy when a default-org
-- config has the same provider and model.
CREATE TEMPORARY TABLE model_config_copy_map (
    copy_id uuid PRIMARY KEY,
    orig_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO model_config_copy_map (copy_id, orig_id)
SELECT cp.id, orig.id
FROM chat_model_configs cp
JOIN organizations copy_org
  ON copy_org.id = cp.organization_id
 AND NOT copy_org.is_default
JOIN LATERAL (
    SELECT default_config.id
    FROM chat_model_configs default_config
    JOIN organizations default_org
      ON default_org.id = default_config.organization_id
     AND default_org.is_default
    WHERE default_config.ai_provider_id IS NOT DISTINCT FROM cp.ai_provider_id
      AND default_config.model = cp.model
    ORDER BY default_config.created_at ASC, default_config.id ASC
    LIMIT 1
) orig ON true;

UPDATE chats c
SET last_model_config_id = m.orig_id
FROM model_config_copy_map m
WHERE c.last_model_config_id = m.copy_id;

UPDATE chat_messages mm
SET model_config_id = m.orig_id
FROM model_config_copy_map m
WHERE mm.model_config_id = m.copy_id;

UPDATE chat_queued_messages q
SET model_config_id = m.orig_id
FROM model_config_copy_map m
WHERE q.model_config_id = m.copy_id;

UPDATE chat_debug_runs d
SET model_config_id = m.orig_id
FROM model_config_copy_map m
WHERE d.model_config_id = m.copy_id;

DELETE FROM user_configs uc
USING model_config_copy_map m
WHERE uc.key = 'chat_compaction_threshold_pct:' || m.copy_id::text;

DELETE FROM chat_model_configs cmc
USING model_config_copy_map m
WHERE cmc.id = m.copy_id;
