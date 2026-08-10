-- This migration is best-effort because copied configs carry no persisted
-- provenance. A non-default-organization config is treated as a copy when a
-- default-organization config matches every behavior and audit field that
-- the up migration copies verbatim. is_default is excluded from the match,
-- because a copy gives up is_default when its destination organization
-- already owns a live default config.
--
-- Duplicate originals are paired to duplicate copies by rank, so the
-- mapping is one-to-one and deterministic. Two originals that match on the
-- whole tuple hold the same options and the same context limit, so either
-- pairing restores identical behavior.
--
-- The temporary table name is migration-specific because pgTxnDriver runs
-- every migration in one transaction, so temporary tables from other
-- migrations are still visible here.
CREATE TEMPORARY TABLE chat_model_config_org_fanout_map (
    copy_id uuid PRIMARY KEY,
    orig_id uuid NOT NULL
) ON COMMIT DROP;

WITH originals AS (
    SELECT
        cmc.id,
        cmc.ai_provider_id,
        cmc.model,
        cmc.display_name,
        cmc.created_by,
        cmc.updated_by,
        cmc.enabled,
        cmc.deleted,
        cmc.deleted_at,
        cmc.created_at,
        cmc.updated_at,
        cmc.context_limit,
        cmc.compression_threshold,
        cmc.options,
        ROW_NUMBER() OVER (
            PARTITION BY cmc.ai_provider_id, cmc.model, cmc.display_name,
                cmc.created_by, cmc.updated_by, cmc.enabled, cmc.deleted,
                cmc.deleted_at, cmc.created_at, cmc.updated_at,
                cmc.context_limit, cmc.compression_threshold, cmc.options
            ORDER BY cmc.id
        ) AS duplicate_rank
    FROM chat_model_configs cmc
    JOIN organizations o ON o.id = cmc.organization_id AND o.is_default
),
copies AS (
    SELECT
        cmc.id,
        cmc.ai_provider_id,
        cmc.model,
        cmc.display_name,
        cmc.created_by,
        cmc.updated_by,
        cmc.enabled,
        cmc.deleted,
        cmc.deleted_at,
        cmc.created_at,
        cmc.updated_at,
        cmc.context_limit,
        cmc.compression_threshold,
        cmc.options,
        ROW_NUMBER() OVER (
            PARTITION BY cmc.organization_id, cmc.ai_provider_id, cmc.model,
                cmc.display_name, cmc.created_by, cmc.updated_by, cmc.enabled,
                cmc.deleted, cmc.deleted_at, cmc.created_at, cmc.updated_at,
                cmc.context_limit, cmc.compression_threshold, cmc.options
            ORDER BY cmc.id
        ) AS duplicate_rank
    FROM chat_model_configs cmc
    JOIN organizations o ON o.id = cmc.organization_id AND NOT o.is_default
)
INSERT INTO chat_model_config_org_fanout_map (copy_id, orig_id)
SELECT cp.id, orig.id
FROM copies cp
JOIN originals orig
  ON orig.duplicate_rank = cp.duplicate_rank
 AND orig.ai_provider_id IS NOT DISTINCT FROM cp.ai_provider_id
 AND orig.model IS NOT DISTINCT FROM cp.model
 AND orig.display_name IS NOT DISTINCT FROM cp.display_name
 AND orig.created_by IS NOT DISTINCT FROM cp.created_by
 AND orig.updated_by IS NOT DISTINCT FROM cp.updated_by
 AND orig.enabled IS NOT DISTINCT FROM cp.enabled
 AND orig.deleted IS NOT DISTINCT FROM cp.deleted
 AND orig.deleted_at IS NOT DISTINCT FROM cp.deleted_at
 AND orig.created_at IS NOT DISTINCT FROM cp.created_at
 AND orig.updated_at IS NOT DISTINCT FROM cp.updated_at
 AND orig.context_limit IS NOT DISTINCT FROM cp.context_limit
 AND orig.compression_threshold IS NOT DISTINCT FROM cp.compression_threshold
 AND orig.options IS NOT DISTINCT FROM cp.options;

UPDATE chats c
SET last_model_config_id = m.orig_id
FROM chat_model_config_org_fanout_map m
WHERE c.last_model_config_id = m.copy_id;

UPDATE chat_messages mm
SET model_config_id = m.orig_id
FROM chat_model_config_org_fanout_map m
WHERE mm.model_config_id = m.copy_id;

UPDATE chat_queued_messages q
SET model_config_id = m.orig_id
FROM chat_model_config_org_fanout_map m
WHERE q.model_config_id = m.copy_id;

UPDATE chat_debug_runs d
SET model_config_id = m.orig_id
FROM chat_model_config_org_fanout_map m
WHERE d.model_config_id = m.copy_id;

DELETE FROM user_configs uc
USING chat_model_config_org_fanout_map m
WHERE uc.key = 'chat_compaction_threshold_pct:' || m.copy_id::text;

DELETE FROM chat_model_configs cmc
USING chat_model_config_org_fanout_map m
WHERE cmc.id = m.copy_id;
