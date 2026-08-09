-- Fixture for 000566 (org explosion cutover). Fixtures apply right after
-- their migration runs, so this executes after the explosion has copied
-- the default organization's configs into every live organization. It
-- seeds one organically created config in the non-default organization
-- from fixture 000291, so later migrations run over configs that the
-- explosion did not create.
INSERT INTO chat_model_configs (
    id,
    model,
    display_name,
    enabled,
    is_default,
    context_limit,
    compression_threshold,
    ai_provider_id,
    organization_id,
    group_acl,
    created_at,
    updated_at
) VALUES (
    '566c0001-0000-4000-8000-000000000001',
    'gpt-5.2-org-fixture',
    'Fixture Org Model 566',
    TRUE,
    FALSE,
    128000,
    70,
    'a52c6f0e-7d4b-4e1a-9c3f-2b8d5e6f7a8b',
    '20362772-802a-4a72-8e4f-3648b4bfd168',
    jsonb_build_object('20362772-802a-4a72-8e4f-3648b4bfd168', jsonb_build_object('permissions', jsonb_build_array('read'))),
    '2024-01-01 00:00:00+00',
    '2024-01-01 00:00:00+00'
);
