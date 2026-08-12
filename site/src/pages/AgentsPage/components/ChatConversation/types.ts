import type * as TypesGen from "#/api/typesGenerated";
import type { ReconnectSchedule } from "#/utils/reconnectingWebSocket";

export type OptimisticUserMessage = Omit<TypesGen.ChatMessage, "id"> & {
	readonly id?: never;
	readonly client_message_id: string;
	readonly role: "user";
};

export type RenderableChatMessage =
	| TypesGen.ChatMessage
	| OptimisticUserMessage;

export const isDurableChatMessage = (
	message: RenderableChatMessage,
): message is TypesGen.ChatMessage => "id" in message;

export const getChatMessageRenderKey = (
	message: RenderableChatMessage,
): string =>
	isDurableChatMessage(message) && !message.client_message_id
		? `message:${message.id}`
		: `client-message:${message.client_message_id}`;

export type ParsedToolCall = {
	id: string;
	name: string;
	args?: unknown;
	parsedCommands?: readonly string[][];
	mcpServerConfigId?: string;
	hookRewritten?: boolean;
};

export type ParsedToolResult = {
	id: string;
	name: string;
	result?: unknown;
	isError: boolean;
	mcpServerConfigId?: string;
};

export type MergedTool = {
	id: string;
	name: string;
	args?: unknown;
	result?: unknown;
	isError: boolean;
	status: "completed" | "error" | "running";
	mcpServerConfigId?: string;
	modelIntent?: string;
	parsedCommands?: readonly string[][];
	hookRewritten?: boolean;
	/** Set when a process_signal killed/terminated this process. */
	killedBySignal?: "kill" | "terminate";
};

export type RenderBlock =
	| {
			type: "response";
			text: string;
	  }
	| {
			type: "thinking";
			text: string;
	  }
	| {
			type: "tool";
			id: string;
	  }
	| TypesGen.ChatFilePart
	| TypesGen.ChatFileReferencePart
	| {
			type: "sources";
			sources: Array<{ url: string; title: string }>;
	  };

export type ParsedMessageContent = {
	markdown: string;
	reasoning: string;
	toolCalls: ParsedToolCall[];
	toolResults: ParsedToolResult[];
	tools: MergedTool[];
	blocks: RenderBlock[];
	sources: Array<{ url: string; title: string }>;
	hookNotices: string[];
};

export type ParsedMessageEntry = {
	message: RenderableChatMessage;
	parsed: ParsedMessageContent;
};

export type ReconnectState = ReconnectSchedule;

export type RetryState = {
	attempt: number;
	error: string;
	kind: TypesGen.ChatErrorKind;
	provider?: string;
	retryingAt?: string;
};

type StreamToolCall = {
	id: string;
	name: string;
	args?: unknown;
	argsRaw?: string;
	parsedCommands?: readonly string[][];
	mcpServerConfigId?: string;
	modelIntent?: string;
};

type StreamToolResult = {
	id: string;
	name: string;
	result?: unknown;
	resultRaw?: string;
	isError: boolean;
	/** True while result deltas are still accumulating before the final result. */
	isStreaming?: boolean;
	mcpServerConfigId?: string;
};

export type StreamState = {
	blocks: RenderBlock[];
	toolCalls: Record<string, StreamToolCall>;
	toolResults: Record<string, StreamToolResult>;
	sources: Array<{ url: string; title: string }>;
};
