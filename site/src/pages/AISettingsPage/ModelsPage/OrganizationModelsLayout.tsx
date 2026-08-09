import type { FC } from "react";
import { useQuery } from "react-query";
import { Outlet, useNavigate, useParams } from "react-router";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { EmptyState } from "#/components/EmptyState/EmptyState";
import { Loader } from "#/components/Loader/Loader";
import { OrganizationAutocomplete } from "#/components/OrganizationAutocomplete/OrganizationAutocomplete";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import {
	manageableModelOrganizations,
	NoManageableModelOrganizations,
	OrganizationModelsContext,
} from "./organizationModels";

/**
 * Org context for the /ai/settings models pages. Resolves the :organization
 * route param against the organizations the caller may manage chat model
 * configs in, and renders an org switcher above the matched page.
 */
const OrganizationModelsLayout: FC = () => {
	const { organization } = useParams<{ organization: string }>();
	const navigate = useNavigate();
	const { organizations } = useDashboard();

	const manageableOrgsQuery = useQuery(
		manageableModelOrganizations(organizations),
	);

	const manageableOrganizations = manageableOrgsQuery.data ?? [];
	const activeOrganization = manageableOrganizations.find(
		(org) => org.name === organization,
	);

	if (manageableOrgsQuery.isLoading) {
		return <Loader />;
	}

	if (
		manageableOrgsQuery.error !== null &&
		manageableOrgsQuery.data === undefined
	) {
		return <ErrorAlert error={manageableOrgsQuery.error} />;
	}

	if (activeOrganization === undefined) {
		return manageableOrganizations.length === 0 ? (
			<NoManageableModelOrganizations />
		) : (
			<EmptyState
				message="Organization unavailable"
				description="This organization does not exist or you do not have permission to manage its chat models."
			/>
		);
	}

	return (
		<OrganizationModelsContext.Provider
			value={{
				organization: activeOrganization,
				organizations: manageableOrganizations,
			}}
		>
			<div className="flex flex-col gap-6">
				{manageableOrgsQuery.error !== null && (
					<ErrorAlert error={manageableOrgsQuery.error} />
				)}
				<div>
					<OrganizationAutocomplete
						value={activeOrganization}
						ariaLabel={`Organization: ${activeOrganization.display_name}`}
						options={manageableOrganizations}
						triggerClassName="w-60"
						onChange={(org) => {
							if (org) {
								navigate(`/ai/settings/organizations/${org.name}/models`);
							}
						}}
					/>
				</div>
				<Outlet />
			</div>
		</OrganizationModelsContext.Provider>
	);
};

export default OrganizationModelsLayout;
