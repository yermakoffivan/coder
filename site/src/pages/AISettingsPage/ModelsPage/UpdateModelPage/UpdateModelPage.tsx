import { type FC, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Navigate, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	availableChatModels,
	deleteChatModelConfig,
	organizationChatModels,
	updateChatModelConfig,
} from "#/api/queries/chats";
import { Loader } from "#/components/Loader/Loader";
import { deriveProviderStates } from "#/modules/aiModels/providerStates";
import { pageTitle } from "#/utils/page";
import {
	useOrganizationModels,
	useOrganizationModelsPath,
} from "../organizationModels";
import UpdateModelPageView from "./UpdateModelPageView";

const UpdateModelPage: FC = () => {
	const { modelId } = useParams<{ modelId: string }>();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { organization } = useOrganizationModels();
	const modelsPath = useOrganizationModelsPath();

	const organizationModelsQuery = useQuery(
		organizationChatModels(organization.id),
	);
	const availableModelsQuery = useQuery(availableChatModels(organization.id));
	const updateMutation = useMutation(updateChatModelConfig(queryClient));
	const deleteMutation = useMutation(deleteChatModelConfig(queryClient));
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
	const model = models.find((model) => model.id === modelId);
	const currentDefaultModel = models.find((model) => model.is_default);

	const [providerKeyOverride, setProviderKeyOverride] = useState<string | null>(
		null,
	);
	const selectedProviderState =
		(providerKeyOverride
			? providerStates.find((ps) => ps.key === providerKeyOverride)
			: undefined) ??
		providerStates.find((ps) =>
			ps.modelConfigs.some((m) => m.id === modelId),
		) ??
		null;

	if (!modelId) {
		return <Navigate to={modelsPath} replace />;
	}

	if (isLoading) {
		return (
			<>
				<title>{pageTitle("Loading...", "AI Settings")}</title>
				<Loader fullscreen />
			</>
		);
	}

	if (loadError) {
		return <UpdateModelPageView state="error" error={loadError} />;
	}

	if (!model) {
		return <Navigate to={modelsPath} replace />;
	}

	return (
		<UpdateModelPageView
			state="loaded"
			model={model}
			refetchError={refetchError}
			currentDefaultModel={currentDefaultModel}
			providerStates={providerStates}
			selectedProviderState={selectedProviderState}
			onProviderChange={setProviderKeyOverride}
			isSaving={updateMutation.isPending}
			isDeleting={deleteMutation.isPending}
			onUpdateModel={async (id, req) => {
				try {
					const updated = await updateMutation.mutateAsync({
						modelConfigId: id,
						req,
					});
					toast.success(
						`Model "${updated.display_name || updated.model}" updated.`,
					);
					await navigate(modelsPath);
				} catch (error) {
					toast.error(getErrorMessage(error, "Failed to update model."));
				}
			}}
			onDeleteModel={async (id) => {
				try {
					await deleteMutation.mutateAsync(id);
					toast.success(
						`Model "${model.display_name || model.model}" deleted.`,
					);
					await navigate(modelsPath, { replace: true });
				} catch (error) {
					toast.error(getErrorMessage(error, "Failed to delete model."));
				}
			}}
			onDuplicate={() => {
				if (!selectedProviderState) return;
				void navigate(
					`${modelsPath}/add?provider=${encodeURIComponent(
						selectedProviderState.key,
					)}&duplicate=${encodeURIComponent(model.id)}`,
				);
			}}
			onToggleEnabled={(enabled) => {
				updateMutation.mutate(
					{ modelConfigId: model.id, req: { enabled } },
					{
						onSuccess: () => {
							toast.success(
								`Model "${model.display_name || model.model}" ${
									enabled ? "enabled" : "disabled"
								}.`,
							);
						},
						onError: (error) => {
							toast.error(getErrorMessage(error, "Failed to update model."));
						},
					},
				);
			}}
		/>
	);
};

export default UpdateModelPage;
