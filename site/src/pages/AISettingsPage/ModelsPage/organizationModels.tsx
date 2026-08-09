import { createContext, useContext } from "react";
import { organizationsPermissions } from "#/api/queries/organizations";
import type { Organization } from "#/api/typesGenerated";
import { EmptyState } from "#/components/EmptyState/EmptyState";
import type { OrganizationPermissions } from "#/modules/permissions/organizations";

export const manageableModelOrganizations = (
	organizations: readonly Organization[],
) => ({
	...organizationsPermissions(
		organizations.length > 0
			? organizations.map((organization) => organization.id)
			: undefined,
	),
	select: (
		permissionsByOrganization: Record<string, OrganizationPermissions>,
	) =>
		organizations.filter(
			(organization) =>
				permissionsByOrganization[organization.id]?.createChatModelConfigs ||
				permissionsByOrganization[organization.id]?.editChatModelConfigs,
		),
});

export const NoManageableModelOrganizations = () => (
	<EmptyState
		message="No manageable organizations"
		description="You do not have permission to manage chat models in any organization. Ask an organization administrator for access."
	/>
);

type OrganizationModelsContextValue = {
	organization: Organization;
	organizations: readonly Organization[];
};

/**
 * The organization whose chat model configs the current /ai/settings
 * models pages manage. Resolved from the :organization route param by
 * OrganizationModelsLayout.
 */
export const OrganizationModelsContext =
	createContext<OrganizationModelsContextValue | null>(null);

export const useOrganizationModels = (): OrganizationModelsContextValue => {
	const context = useContext(OrganizationModelsContext);
	if (!context) {
		throw new Error(
			"useOrganizationModels only can be used inside of OrganizationModelsLayout",
		);
	}
	return context;
};

export const useOrganizationModelsPath = (): string => {
	const { organization } = useOrganizationModels();
	return `/ai/settings/organizations/${organization.name}/models`;
};
