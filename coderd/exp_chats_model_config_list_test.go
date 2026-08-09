package coderd_test

import (
	"context"
	"slices"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

// TestChatModelConfigListReadContracts pins the visible config set for each
// role after chat model config reads become organization-scoped.
func TestChatModelConfigListReadContracts(t *testing.T) {
	t.Parallel()

	ctx := testutil.Context(t, testutil.WaitLong)
	rawDB, pubsub := dbtestutil.NewDB(t)
	client := newChatClient(t, func(opts *coderdtest.Options) {
		opts.Database = rawDB
		opts.Pubsub = pubsub
	})
	_ = coderdtest.CreateFirstUser(t, client.Client)

	defaultOrg, err := rawDB.GetDefaultOrganization(ctx)
	require.NoError(t, err)
	otherOrg := dbgen.Organization(t, rawDB, database.Organization{IsDefault: false})
	seedEveryoneGroup(t, rawDB, otherOrg.ID)

	ownEnabled := dbgen.ChatModelConfig(t, rawDB, database.ChatModelConfig{
		OrganizationID: defaultOrg.ID,
		GroupACL: database.ChatACL{
			defaultOrg.ID.String(): {Permissions: []policy.Action{policy.ActionRead}},
		},
	})
	ownDisabled := dbgen.ChatModelConfig(t, rawDB, database.ChatModelConfig{
		OrganizationID: defaultOrg.ID,
		GroupACL: database.ChatACL{
			defaultOrg.ID.String(): {Permissions: []policy.Action{policy.ActionRead}},
		},
	}, func(params *database.InsertChatModelConfigParams) {
		params.Enabled = false
	})
	otherEnabled := dbgen.ChatModelConfig(t, rawDB, database.ChatModelConfig{
		OrganizationID: otherOrg.ID,
		GroupACL: database.ChatACL{
			otherOrg.ID.String(): {Permissions: []policy.Action{policy.ActionRead}},
		},
	})
	require.True(t, ownEnabled.Enabled)
	require.False(t, ownDisabled.Enabled)
	require.True(t, otherEnabled.Enabled)

	testCases := []struct {
		name   string
		client func(t *testing.T, ctx context.Context) *codersdk.ExperimentalClient
	}{
		{
			name: "Owner",
			client: func(*testing.T, context.Context) *codersdk.ExperimentalClient {
				return client
			},
		},
		{
			name: "SiteAuditor",
			client: func(t *testing.T, _ context.Context) *codersdk.ExperimentalClient {
				rawClient, _ := coderdtest.CreateAnotherUser(t, client.Client, defaultOrg.ID, rbac.RoleAuditor())
				return codersdk.NewExperimentalClient(rawClient)
			},
		},
		{
			name: "CustomSiteReadRole",
			client: func(t *testing.T, ctx context.Context) *codersdk.ExperimentalClient {
				return newSiteCustomRoleClient(ctx, t, client, rawDB, defaultOrg.ID, database.CustomRolePermission{
					ResourceType: rbac.ResourceChatModelConfig.Type,
					Action:       policy.ActionRead,
				})
			},
		},
		{
			name: "OrgAdmin",
			client: func(t *testing.T, _ context.Context) *codersdk.ExperimentalClient {
				rawClient, _ := coderdtest.CreateAnotherUser(t, client.Client, defaultOrg.ID, rbac.ScopedRoleOrgAdmin(defaultOrg.ID))
				return codersdk.NewExperimentalClient(rawClient)
			},
		},
		{
			name: "OrgAuditor",
			client: func(t *testing.T, _ context.Context) *codersdk.ExperimentalClient {
				rawClient, _ := coderdtest.CreateAnotherUser(t, client.Client, defaultOrg.ID, rbac.ScopedRoleOrgAuditor(defaultOrg.ID))
				return codersdk.NewExperimentalClient(rawClient)
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			ctx := testutil.Context(t, testutil.WaitLong)
			configs, err := testCase.client(t, ctx).ChatModels(ctx, defaultOrg.ID)
			require.NoError(t, err)
			require.True(t, containsChatModelConfig(configs.Models, ownEnabled.ID), "must see enabled config in the requested org")
			require.True(t, containsChatModelConfig(configs.Models, ownDisabled.ID), "must see disabled config in the requested org")
			require.False(t, containsChatModelConfig(configs.Models, otherEnabled.ID), "must not see config from another org")
		})
	}
}

func containsChatModelConfig(configs []codersdk.ChatModel, id uuid.UUID) bool {
	return slices.ContainsFunc(configs, func(config codersdk.ChatModel) bool {
		return config.ID == id
	})
}

func seedEveryoneGroup(t testing.TB, db database.Store, organizationID uuid.UUID) {
	t.Helper()
	dbgen.Group(t, db, database.Group{
		ID:             organizationID,
		Name:           database.EveryoneGroup,
		OrganizationID: organizationID,
	})
}

// newSiteCustomRoleClient seeds a null-org role through the raw store because
// public custom-role APIs create organization roles and reject site permissions.
func newSiteCustomRoleClient(
	ctx context.Context,
	t testing.TB,
	ownerClient *codersdk.ExperimentalClient,
	db database.Store,
	organizationID uuid.UUID,
	permissions ...database.CustomRolePermission,
) *codersdk.ExperimentalClient {
	t.Helper()

	role, err := db.InsertCustomRole(ctx, database.InsertCustomRoleParams{
		Name:            testutil.GetRandomName(t),
		DisplayName:     "Site Custom Test Role",
		OrganizationID:  uuid.NullUUID{},
		SitePermissions: permissions,
	})
	require.NoError(t, err)

	rawClient, user := coderdtest.CreateAnotherUser(t, ownerClient.Client, organizationID)
	_, err = ownerClient.Client.UpdateUserRoles(ctx, user.ID.String(), codersdk.UpdateRoles{
		Roles: []string{role.Name},
	})
	require.NoError(t, err)
	return codersdk.NewExperimentalClient(rawClient)
}
