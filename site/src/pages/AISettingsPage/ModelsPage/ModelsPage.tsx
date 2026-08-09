import type { FC } from "react";
import { useQuery } from "react-query";
import {
	availableChatModels,
	organizationChatModels,
} from "#/api/queries/chats";
import { deriveProviderStates } from "#/modules/aiModels/providerStates";
import { pageTitle } from "#/utils/page";
import ModelsPageView from "./ModelsPageView";
import { useOrganizationModels } from "./organizationModels";

const ModelsPage: FC = () => {
	const { organization } = useOrganizationModels();
	const organizationModelsQuery = useQuery(
		organizationChatModels(organization.id),
	);
	const availableModelsQuery = useQuery(availableChatModels(organization.id));
	const providers = organizationModelsQuery.data?.providers ?? [];
	const providerTypeByID = new Map(
		providers.map((provider) => [provider.id, provider.type]),
	);
	const models = (organizationModelsQuery.data?.models ?? [])
		.slice()
		.sort((a, b) => {
			const aProvider = providerTypeByID.get(a.ai_provider_id) ?? "";
			const bProvider = providerTypeByID.get(b.ai_provider_id) ?? "";
			const cmp = aProvider.localeCompare(bProvider);
			return cmp !== 0 ? cmp : a.model.localeCompare(b.model);
		});
	const providerStates = deriveProviderStates(
		models,
		providers,
		availableModelsQuery.data,
	);

	return (
		<>
			<title>{pageTitle("Models", "AI Settings")}</title>

			<ModelsPageView
				key={organization.id}
				isLoading={
					organizationModelsQuery.isLoading || availableModelsQuery.isLoading
				}
				error={organizationModelsQuery.error ?? availableModelsQuery.error}
				models={models}
				providerStates={providerStates}
				providerTypeByID={providerTypeByID}
			/>
		</>
	);
};

export default ModelsPage;
