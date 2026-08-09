import type { FC } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	availableChatModels,
	createChatModelConfig,
	organizationChatModels,
} from "#/api/queries/chats";
import {
	canManageProviderModels,
	deriveProviderStates,
} from "#/modules/aiModels/providerStates";
import { pageTitle } from "#/utils/page";
import {
	useOrganizationModels,
	useOrganizationModelsPath,
} from "../organizationModels";
import AddModelPageView from "./AddModelPageView";

const AddModelPage: FC = () => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [searchParams] = useSearchParams();
	const providerKey = searchParams.get("provider") ?? "";
	const duplicateId = searchParams.get("duplicate");
	const { organization } = useOrganizationModels();
	const modelsPath = useOrganizationModelsPath();

	const organizationModelsQuery = useQuery(
		organizationChatModels(organization.id),
	);
	const availableModelsQuery = useQuery(availableChatModels(organization.id));
	const createMutation = useMutation(createChatModelConfig(queryClient));
	const models = organizationModelsQuery.data?.models ?? [];
	const providerStates = deriveProviderStates(
		models,
		organizationModelsQuery.data?.providers ?? [],
		availableModelsQuery.data,
	);
	const isLoading =
		organizationModelsQuery.isLoading || availableModelsQuery.isLoading;
	const loadError =
		(organizationModelsQuery.data === undefined
			? organizationModelsQuery.error
			: null) ??
		(availableModelsQuery.data === undefined
			? availableModelsQuery.error
			: null);
	const refetchError = loadError
		? null
		: (organizationModelsQuery.error ?? availableModelsQuery.error);

	const selectedProviderState = providerKey
		? (providerStates.find((ps) => ps.key === providerKey) ?? null)
		: (providerStates.find(canManageProviderModels) ?? null);
	const duplicateSourceModel = duplicateId
		? models.find((m) => m.id === duplicateId)
		: undefined;
	const currentDefaultModel = models.find((m) => m.is_default);

	return (
		<>
			<title>{pageTitle("Add model", "AI Settings")}</title>

			<AddModelPageView
				isLoading={isLoading}
				loadError={loadError}
				refetchError={refetchError}
				providerStates={providerStates}
				selectedProviderState={selectedProviderState}
				duplicateSourceModel={duplicateSourceModel}
				currentDefaultModel={currentDefaultModel}
				isSaving={createMutation.isPending}
				onProviderChange={(key) => {
					const next = new URLSearchParams(searchParams);
					next.set("provider", key);
					void navigate(`${modelsPath}/add?${next.toString()}`, {
						replace: true,
					});
				}}
				onCreateModel={async (req) => {
					try {
						const created = await createMutation.mutateAsync({
							organizationId: organization.id,
							req,
						});
						toast.success(
							`Model "${created.display_name || created.model}" added.`,
						);
						await navigate(`${modelsPath}/${created.id}`);
					} catch (error) {
						toast.error(getErrorMessage(error, "Failed to add model."));
					}
				}}
			/>
		</>
	);
};

export default AddModelPage;
