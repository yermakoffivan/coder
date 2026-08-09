import { useQueries } from "react-query";
import { organizationChatModels } from "#/api/queries/chats";

export const useOrganizationChatModels = (
	organizationIds: readonly string[],
) => {
	const queries = useQueries({
		queries: organizationIds.map((organizationId) =>
			organizationChatModels(organizationId),
		),
	});

	const error = queries.find((query) => query.error)?.error ?? null;
	const hasData = queries.some((query) => query.data !== undefined);

	return {
		models: queries.flatMap((query) => query.data?.models ?? []),
		providers: queries.flatMap((query) => query.data?.providers ?? []),
		isLoading: !hasData && queries.some((query) => query.isLoading),
		isFetching: queries.some((query) => query.isFetching),
		error: hasData ? null : error,
		partialError: hasData ? error : null,
	};
};
