import {
	ChevronLeftIcon,
	ChevronRightIcon,
	InfoIcon,
	PencilIcon,
} from "lucide-react";
import {
	type FC,
	memo,
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { useQuery } from "react-query";
import type { UrlTransform } from "streamdown";
import { preferenceSettings } from "#/api/queries/users";
import type * as TypesGen from "#/api/typesGenerated";
import type { ThinkingDisplayMode } from "#/api/typesGenerated";

import { AlertTitle } from "#/components/Alert/Alert";
import { Button } from "#/components/Button/Button";
import { CopyButton } from "#/components/CopyButton/CopyButton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { cn } from "#/utils/cn";

import {
	ConversationItem,
	Message,
	MessageContent,
	Response,
	Shimmer,
	Tool,
} from "../ChatElements";
import { WebSearchSources } from "../ChatElements/tools";
import { ReadFilesTool } from "../ChatElements/tools/ReadFilesTool";
import {
	getReadFileToolData,
	ReadFileTool,
} from "../ChatElements/tools/ReadFileTool";
import type { SubagentVariant } from "../ChatElements/tools/subagentDescriptor";
import { ToolCall } from "../ChatElements/tools/ToolCall";
import { ToolIcon } from "../ChatElements/tools/ToolIcon";
import { ImageLightbox } from "../ImageLightbox";
import { TextPreviewDialog } from "../TextPreviewDialog";
import {
	AttachmentBlock,
	type PreviewTextAttachment,
} from "./AttachmentBlocks";
import { groupSequentialReadFileBlocks } from "./blockUtils";
import { ChatStatusCallout } from "./ChatStatusCallout";
import { FileProbeProvider } from "./FileProbeContext";
import {
	type LiveStatusModel,
	shouldRenderLiveAssistant,
} from "./liveStatusModel";
import {
	buildDisplayMessages,
	deriveMessageDisplayState,
} from "./messageHelpers";
import { getEditableUserMessagePayload } from "./messageParsing";
import { useSmoothStreamingText } from "./SmoothText";
import { shouldShowGenericThinking } from "./streamingActivity";
import { getThinkingDisclosureDisplay } from "./thinkingTitle";
import type {
	MergedTool,
	ParsedMessageContent,
	ParsedMessageEntry,
	RenderBlock,
	StreamState,
} from "./types";
import {
	getChatMessageRenderKey,
	isDurableChatMessage,
	type RenderableChatMessage,
} from "./types";
import { UserMessageContent } from "./UserMessageContent";

const getChatMessageTextContent = (
	content: readonly TypesGen.ChatMessagePart[] | undefined,
): string | undefined => {
	if (!content) {
		return undefined;
	}

	let textContent = "";
	for (const part of content) {
		if (part.type === "text") {
			textContent += part.text;
		}
	}

	return textContent.length > 0 ? textContent : undefined;
};

const ReasoningDisclosure = memo<{
	id: string;
	text: string;
	isStreaming?: boolean;
	urlTransform?: UrlTransform;
	thinkingDisplayMode?: ThinkingDisplayMode;
}>(
	({
		id,
		text,
		isStreaming = false,
		urlTransform,
		thinkingDisplayMode: mode = "auto",
	}) => {
		const [manualToggle, setManualToggle] = useState<boolean | null>(null);

		// Reset manual override on streaming transitions so
		// auto/preview modes collapse when streaming stops.
		const [prevStreaming, setPrevStreaming] = useState(isStreaming);
		if (prevStreaming !== isStreaming) {
			setPrevStreaming(isStreaming);
			if (mode === "auto" || mode === "preview") {
				setManualToggle(null);
			}
		}

		const autoExpanded = (() => {
			switch (mode) {
				case "always_expanded":
					return true;
				case "always_collapsed":
					return false;
				case "auto":
				case "preview":
					return isStreaming;
				default: {
					const _exhaustive: never = mode;
					return _exhaustive;
				}
			}
		})();

		const expanded = manualToggle ?? autoExpanded;

		const isPreviewConstrained =
			mode === "preview" && isStreaming && manualToggle === null;

		const previewScrollRef = useRef<HTMLDivElement>(null);

		const { visibleText } = useSmoothStreamingText({
			fullText: text,
			isStreaming,
			bypassSmoothing: !isStreaming,
			streamKey: id,
		});
		const displayText = isStreaming ? visibleText : text;
		const { title, body } = getThinkingDisclosureDisplay(displayText);
		const hasText = body.trim().length > 0;

		// Auto-scroll the preview container to the bottom as new
		// thinking content streams in. useLayoutEffect avoids a
		// visible frame where content has grown but not scrolled.
		const displayTextLength = body.length;
		useLayoutEffect(() => {
			if (
				displayTextLength &&
				isPreviewConstrained &&
				previewScrollRef.current
			) {
				previewScrollRef.current.scrollTop =
					previewScrollRef.current.scrollHeight;
			}
		}, [displayTextLength, isPreviewConstrained]);

		return (
			<div data-transcript-row="">
				<ToolCall.Root
					className="w-full"
					status={isStreaming ? "running" : "completed"}
					hasContent={hasText}
					expanded={expanded}
					onExpandedChange={(open) => setManualToggle(open)}
				>
					<ToolCall.Header
						iconName="thinking"
						label={title}
						showStatus={false}
					/>
					<ToolCall.Content>
						<div
							ref={previewScrollRef}
							className={cn(
								"mt-1.5",
								isPreviewConstrained && "max-h-24 overflow-y-auto",
							)}
						>
							<Response
								className="text-[11px] text-content-secondary"
								urlTransform={urlTransform}
								streaming={isStreaming}
							>
								{body}
							</Response>
						</div>
					</ToolCall.Content>
				</ToolCall.Root>
			</div>
		);
	},
);

const ResponseBlock = memo<{
	text: string;
	isStreaming: boolean;
	streamKey: string;
	urlTransform?: UrlTransform;
}>(({ text, isStreaming, streamKey, urlTransform }) => {
	const { visibleText } = useSmoothStreamingText({
		fullText: text,
		isStreaming,
		bypassSmoothing: !isStreaming,
		streamKey,
	});
	return (
		<Response streaming={isStreaming} urlTransform={urlTransform}>
			{isStreaming ? visibleText : text}
		</Response>
	);
});

const ReadFileTimelineBlock = memo<{
	tools: readonly [MergedTool, ...MergedTool[]];
}>(({ tools }) => {
	const [expanded, setExpanded] = useState(false);
	const [firstTool] = tools;
	if (tools.length === 1) {
		const readFile = getReadFileToolData(firstTool);
		return (
			<ToolCall.PolicyProvider hookRewritten={firstTool.hookRewritten ?? false}>
				<div data-tool-call="">
					<ReadFileTool
						{...readFile}
						status={firstTool.status}
						expanded={expanded}
						onExpandedChange={setExpanded}
					/>
				</div>
			</ToolCall.PolicyProvider>
		);
	}

	return (
		<ReadFilesTool
			tools={tools}
			expanded={expanded}
			onExpandedChange={setExpanded}
		/>
	);
});

// Shared block renderer used by both ChatMessageItem (historical
// messages) and StreamingOutput (live stream). Encapsulates the
// response / thinking / tool / file / sources switch so both
// consumers stay in sync. PascalCase so the React Compiler
// auto-memoizes every element inside.
export const BlockList: FC<{
	blocks: readonly RenderBlock[];
	tools: readonly MergedTool[];
	keyPrefix: string;
	isStreaming?: boolean;
	subagentTitles?: Map<string, string>;
	subagentVariants?: Map<string, SubagentVariant>;
	showDesktopPreviews?: boolean;
	subagentStatusOverrides?: Map<string, TypesGen.ChatStatus>;
	mcpServers?: readonly TypesGen.MCPServerConfig[];
	onImageClick?: (src: string) => void;
	onTextFileClick?: (attachment: PreviewTextAttachment) => void;
	onImplementPlan?: () => Promise<void> | void;
	onSendAskUserQuestionResponse?: (message: string) => Promise<void> | void;
	isChatCompleted?: boolean;
	latestAskUserQuestionToolId?: string;
	askUserQuestionResponseTextByToolId?: ReadonlyMap<string, string>;
	hasUserResponseAfterAskQuestion?: boolean;
	urlTransform?: UrlTransform;
}> = ({
	blocks,
	tools,
	keyPrefix,
	isStreaming = false,
	subagentTitles,
	subagentVariants,
	showDesktopPreviews,
	subagentStatusOverrides,
	mcpServers,
	onImageClick,
	onTextFileClick,
	onImplementPlan,
	onSendAskUserQuestionResponse,
	isChatCompleted,
	latestAskUserQuestionToolId,
	askUserQuestionResponseTextByToolId,
	hasUserResponseAfterAskQuestion = false,
	urlTransform,
}) => {
	const prefQuery = useQuery(preferenceSettings());
	const thinkingDisplayMode: ThinkingDisplayMode =
		prefQuery.data?.thinking_display_mode || "auto";
	const shellToolDisplayMode: TypesGen.AgentDisplayMode =
		prefQuery.data?.shell_tool_display_mode || "always_collapsed";
	const codeDiffDisplayMode: TypesGen.AgentDisplayMode =
		prefQuery.data?.code_diff_display_mode || "auto";

	const toolByID = new Map(tools.map((tool) => [tool.id, tool]));
	const displayBlocks = groupSequentialReadFileBlocks(blocks, tools);

	// Pre-compute which tool IDs have a corresponding block so
	// we can render "remaining" (block-less) tools afterwards.
	const blockToolIDs = new Set(
		displayBlocks.flatMap((block) => {
			if (block.type === "tool") {
				return toolByID.has(block.id) || isStreaming ? [block.id] : [];
			}
			if (block.type === "tool-group") {
				return block.ids;
			}
			return [];
		}),
	);

	const remainingTools = tools.filter((tool) => !blockToolIDs.has(tool.id));

	// A thinking block is actively streaming only when it is the
	// very last block in the list. Once newer content arrives
	// (response, tool call, etc.) the thinking phase is over.
	const lastDisplayBlockIsThinking =
		displayBlocks.length > 0 &&
		displayBlocks[displayBlocks.length - 1].type === "thinking";

	return (
		<>
			{displayBlocks.map((block, index) => {
				switch (block.type) {
					case "response":
						return (
							<ResponseBlock
								key={`${keyPrefix}-response-${index}`}
								text={block.text}
								isStreaming={isStreaming}
								streamKey={keyPrefix}
								urlTransform={urlTransform}
							/>
						);
					case "thinking":
						return (
							<ReasoningDisclosure
								key={`${keyPrefix}-thinking-${index}`}
								id={`${keyPrefix}-thinking-${index}`}
								text={block.text}
								isStreaming={
									isStreaming &&
									lastDisplayBlockIsThinking &&
									index === displayBlocks.length - 1
								}
								urlTransform={urlTransform}
								thinkingDisplayMode={thinkingDisplayMode}
							/>
						);
					case "file-reference":
						return (
							<div
								key={`${keyPrefix}-file-reference-${index}`}
								className="my-1 flex items-start gap-2 rounded-md border border-content-link/20 bg-content-link/5 px-2.5 py-1.5"
							>
								<span className="shrink-0 text-xs font-medium text-content-link">
									{block.file_name}:
									{block.start_line === block.end_line
										? block.start_line
										: `${block.start_line}\u2013${block.end_line}`}
								</span>
							</div>
						);
					case "tool-group": {
						const [firstGroupTool, ...restGroupTools] = block.ids
							.map((id) => toolByID.get(id))
							.filter((tool) => tool !== undefined);
						if (!firstGroupTool) {
							return null;
						}
						return (
							<ReadFileTimelineBlock
								key={firstGroupTool.id}
								tools={[firstGroupTool, ...restGroupTools]}
							/>
						);
					}
					case "tool": {
						const tool = toolByID.get(block.id);
						if (!tool) {
							if (!isStreaming) {
								return null;
							}
							// Streaming placeholder for not-yet-resolved tool.
							return (
								<Tool
									key={block.id}
									name="Tool"
									status="running"
									isError={false}
									shellToolDisplayMode={shellToolDisplayMode}
									codeDiffDisplayMode={codeDiffDisplayMode}
									subagentTitles={subagentTitles}
									subagentVariants={subagentVariants}
									subagentStatusOverrides={subagentStatusOverrides}
									mcpServers={mcpServers}
								/>
							);
						}
						if (tool.name === "read_file") {
							return <ReadFileTimelineBlock key={tool.id} tools={[tool]} />;
						}
						return (
							<Tool
								key={tool.id}
								name={tool.name}
								args={tool.args}
								result={tool.result}
								status={tool.status}
								isError={tool.isError}
								killedBySignal={tool.killedBySignal}
								shellToolDisplayMode={shellToolDisplayMode}
								codeDiffDisplayMode={codeDiffDisplayMode}
								subagentTitles={subagentTitles}
								subagentVariants={subagentVariants}
								showDesktopPreviews={showDesktopPreviews}
								subagentStatusOverrides={
									isStreaming ? subagentStatusOverrides : undefined
								}
								mcpServerConfigId={tool.mcpServerConfigId}
								mcpServers={mcpServers}
								onImplementPlan={onImplementPlan}
								onSendAskUserQuestionResponse={onSendAskUserQuestionResponse}
								isChatCompleted={isChatCompleted}
								isLatestAskUserQuestion={
									tool.id === latestAskUserQuestionToolId &&
									!hasUserResponseAfterAskQuestion
								}
								previousResponseText={
									tool.name === "ask_user_question"
										? askUserQuestionResponseTextByToolId?.get(tool.id)
										: undefined
								}
								modelIntent={tool.modelIntent}
								parsedCommands={tool.parsedCommands}
								hookRewritten={tool.hookRewritten}
							/>
						);
					}
					case "file":
						return (
							<AttachmentBlock
								key={`${keyPrefix}-file-${block.file_id ?? index}`}
								block={block}
								onImageClick={onImageClick}
								onTextFileClick={onTextFileClick}
								framePreview
								showTextStatus
							/>
						);
					case "sources":
						return (
							<WebSearchSources
								key={`${keyPrefix}-sources-${index}`}
								sources={block.sources}
							/>
						);
					default: {
						const _exhaustive: never = block;
						return _exhaustive;
					}
				}
			})}
			{remainingTools.map((tool) => (
				<Tool
					key={tool.id}
					name={tool.name}
					args={tool.args}
					result={tool.result}
					status={tool.status}
					isError={tool.isError}
					killedBySignal={tool.killedBySignal}
					shellToolDisplayMode={shellToolDisplayMode}
					codeDiffDisplayMode={codeDiffDisplayMode}
					subagentTitles={subagentTitles}
					subagentVariants={subagentVariants}
					showDesktopPreviews={showDesktopPreviews}
					subagentStatusOverrides={
						isStreaming ? subagentStatusOverrides : undefined
					}
					mcpServerConfigId={tool.mcpServerConfigId}
					mcpServers={mcpServers}
					onImplementPlan={onImplementPlan}
					onSendAskUserQuestionResponse={onSendAskUserQuestionResponse}
					isChatCompleted={isChatCompleted}
					isLatestAskUserQuestion={
						tool.id === latestAskUserQuestionToolId &&
						!hasUserResponseAfterAskQuestion
					}
					previousResponseText={
						tool.name === "ask_user_question"
							? askUserQuestionResponseTextByToolId?.get(tool.id)
							: undefined
					}
					modelIntent={tool.modelIntent}
					parsedCommands={tool.parsedCommands}
					hookRewritten={tool.hookRewritten}
				/>
			))}
		</>
	);
};

const hasCalloutLiveStatus = (liveStatus: LiveStatusModel): boolean =>
	liveStatus.phase === "retrying" || liveStatus.phase === "reconnecting";

const LiveActivitySlot: FC = () => (
	<div
		data-testid="live-activity-slot"
		className="flex h-6 items-center gap-2 text-content-secondary"
	>
		<ToolIcon name="thinking" />
		<Shimmer as="span" className="text-[13px] leading-6">
			Thinking
		</Shimmer>
	</div>
);

type StreamingOutputProps = {
	renderKey: string;
	content:
		| { type: "durable"; parsed: ParsedMessageContent }
		| {
				type: "live";
				streamState: StreamState | null;
				streamTools: readonly MergedTool[];
				liveStatus: LiveStatusModel;
				subagentStatusOverrides: Map<string, TypesGen.ChatStatus>;
		  };
	subagentTitles?: Map<string, string>;
	subagentVariants?: Map<string, SubagentVariant>;
	showDesktopPreviews?: boolean;
	onImageClick?: (src: string) => void;
	onTextFileClick?: Parameters<typeof BlockList>[0]["onTextFileClick"];
	onImplementPlan?: () => Promise<void> | void;
	onSendAskUserQuestionResponse?: (message: string) => Promise<void> | void;
	isChatCompleted?: boolean;
	latestAskUserQuestionToolId?: string;
	askUserQuestionResponseTextByToolId?: ReadonlyMap<string, string>;
	hasUserResponseAfterAskQuestion?: boolean;
	urlTransform?: UrlTransform;
	mcpServers?: readonly TypesGen.MCPServerConfig[];
};

export const StreamingOutput: FC<StreamingOutputProps> = ({
	renderKey,
	content,
	subagentTitles,
	subagentVariants,
	showDesktopPreviews,
	onImageClick,
	onTextFileClick,
	onImplementPlan,
	onSendAskUserQuestionResponse,
	isChatCompleted,
	latestAskUserQuestionToolId,
	askUserQuestionResponseTextByToolId,
	hasUserResponseAfterAskQuestion,
	urlTransform,
	mcpServers,
}) => {
	const parsed = content.type === "durable" ? content.parsed : undefined;
	const streamState = content.type === "live" ? content.streamState : null;
	const streamTools = content.type === "live" ? content.streamTools : [];
	const liveStatus = content.type === "live" ? content.liveStatus : undefined;
	const subagentStatusOverrides =
		content.type === "live" ? content.subagentStatusOverrides : undefined;
	const isStreaming = liveStatus?.phase === "streaming";
	const shouldShowLiveBlocks =
		liveStatus?.phase === "streaming" || liveStatus?.hasAccumulatedOutput;
	const blocks =
		parsed?.blocks ?? (shouldShowLiveBlocks ? streamState?.blocks : []);
	const tools = parsed?.tools ?? streamTools;
	const showActivity = liveStatus
		? shouldShowGenericThinking({ liveStatus, streamState, streamTools })
		: false;

	return (
		<div className="relative flex flex-col gap-2 overflow-visible">
			{(parsed || shouldShowLiveBlocks) && (
				<BlockList
					blocks={blocks ?? []}
					tools={tools}
					keyPrefix={renderKey}
					isStreaming={isStreaming}
					subagentTitles={subagentTitles}
					subagentVariants={subagentVariants}
					showDesktopPreviews={showDesktopPreviews}
					subagentStatusOverrides={subagentStatusOverrides}
					onImageClick={onImageClick}
					onTextFileClick={onTextFileClick}
					onImplementPlan={onImplementPlan}
					onSendAskUserQuestionResponse={onSendAskUserQuestionResponse}
					isChatCompleted={isChatCompleted}
					latestAskUserQuestionToolId={latestAskUserQuestionToolId}
					askUserQuestionResponseTextByToolId={
						askUserQuestionResponseTextByToolId
					}
					hasUserResponseAfterAskQuestion={hasUserResponseAfterAskQuestion}
					urlTransform={urlTransform}
					mcpServers={mcpServers}
				/>
			)}
			{liveStatus && hasCalloutLiveStatus(liveStatus) && (
				<ChatStatusCallout status={liveStatus} />
			)}
			{showActivity && <LiveActivitySlot />}
		</div>
	);
};

// Avoid announcing historical hook notices as live alerts.
const TimelineNotice: FC<{ children?: ReactNode }> = ({ children }) => (
	<div
		role="note"
		className="relative my-1 w-full rounded-lg border border-solid border-border-default bg-surface-secondary p-4 text-left"
	>
		<div className="flex min-w-0 flex-1 flex-row items-start gap-3 text-sm">
			<InfoIcon className="size-icon-sm mt-[3px] text-highlight-sky" />
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	</div>
);

const LifecycleHookNotice: FC<{
	children: string;
	urlTransform?: UrlTransform;
}> = ({ children, urlTransform }) => (
	<TimelineNotice>
		<div className="flex flex-col gap-1">
			<AlertTitle>Lifecycle hook</AlertTitle>
			<Response urlTransform={urlTransform}>{children}</Response>
		</div>
	</TimelineNotice>
);

type ChatMessageRow =
	| {
			type: "message";
			message: RenderableChatMessage;
			parsed: ParsedMessageContent;
	  }
	| {
			type: "live";
			streamState: StreamState | null;
			streamTools: readonly MergedTool[];
			liveStatus: LiveStatusModel;
			subagentStatusOverrides: Map<string, TypesGen.ChatStatus>;
	  };

const ChatMessageItem = memo<{
	row: ChatMessageRow;
	renderKey: string;
	showRowIdentity?: boolean;
	onEditUserMessage?: (
		messageId: number,
		text: string,
		fileBlocks?: readonly TypesGen.ChatMessagePart[],
	) => void;
	editingMessageId?: number | null;
	isAfterEditingMessage?: boolean;
	hideActions?: boolean;
	hasActiveStream?: boolean;
	isAwaitingFirstStreamChunk?: boolean;

	// The bottom spacer fakes the height of the hidden action bar so
	// chain-end messages keep even spacing before the next bubble.
	// The last transcript message has nothing after it, so the spacer
	// would render as a dangling blank at the end of the chat.
	isLastMessage?: boolean;
	// When true, renders a gradient overlay inside the bubble
	// that fades text out toward the bottom. Used by the sticky
	// overlay to indicate truncated content.
	fadeFromBottom?: boolean;
	onImplementPlan?: () => Promise<void> | void;
	urlTransform?: UrlTransform;
	mcpServers?: readonly TypesGen.MCPServerConfig[];
	subagentTitles?: Map<string, string>;
	subagentVariants?: Map<string, SubagentVariant>;
	showDesktopPreviews?: boolean;
	onSendAskUserQuestionResponse?: (message: string) => Promise<void> | void;
	isChatCompleted?: boolean;
	latestAskUserQuestionToolId?: string;
	askUserQuestionResponseTextByToolId?: ReadonlyMap<string, string>;
	hasUserResponseAfterAskQuestion?: boolean;
	prevUserMessageId?: number;
	nextUserMessageId?: number;
	onJumpToUserMessage?: (messageId: number) => void;
}>(
	({
		row,
		renderKey,
		showRowIdentity = true,
		onEditUserMessage,
		editingMessageId,
		isAfterEditingMessage = false,
		hideActions = false,
		hasActiveStream = false,
		isAwaitingFirstStreamChunk = false,
		isLastMessage = false,
		fadeFromBottom = false,
		onImplementPlan,
		onSendAskUserQuestionResponse,
		isChatCompleted,
		latestAskUserQuestionToolId,
		askUserQuestionResponseTextByToolId,
		hasUserResponseAfterAskQuestion = false,
		prevUserMessageId,
		nextUserMessageId,
		onJumpToUserMessage,

		urlTransform,
		mcpServers,
		subagentTitles,
		subagentVariants,
		showDesktopPreviews,
	}) => {
		const message = row.type === "message" ? row.message : undefined;
		const parsed = row.type === "message" ? row.parsed : undefined;
		const streamState = row.type === "live" ? row.streamState : null;
		const streamTools = row.type === "live" ? row.streamTools : [];
		const liveStatus = row.type === "live" ? row.liveStatus : undefined;
		const subagentStatusOverrides =
			row.type === "live" ? row.subagentStatusOverrides : undefined;
		const isUser = message?.role === "user";
		const messageId =
			message && isDurableChatMessage(message) ? message.id : undefined;
		const [previewImage, setPreviewImage] = useState<string | null>(null);
		const [previewText, setPreviewText] =
			useState<PreviewTextAttachment | null>(null);
		const displayState =
			message && parsed
				? deriveMessageDisplayState({
						message,
						parsed,
						hideActions,
						hasActiveStream,
						isAwaitingFirstStreamChunk,
					})
				: undefined;
		if (displayState?.shouldHide) {
			return null;
		}
		if (message?.role === "system" && parsed) {
			return (
				<div
					className={cn(
						isAfterEditingMessage && "opacity-40 pointer-events-none",
						"transition-opacity duration-200",
					)}
					// Keep links in dimmed notices out of accessibility navigation.
					inert={isAfterEditingMessage ? true : undefined}
				>
					{parsed.hookNotices.length > 0 ? (
						parsed.hookNotices.map((notice, index) => (
							<LifecycleHookNotice
								key={`${renderKey}-hook-notice-${index}`}
								urlTransform={urlTransform}
							>
								{notice}
							</LifecycleHookNotice>
						))
					) : (
						<TimelineNotice>
							<Response urlTransform={urlTransform}>{parsed.markdown}</Response>
						</TimelineNotice>
					)}
				</div>
			);
		}

		if (!message && !liveStatus) {
			return null;
		}

		const liveContent: StreamingOutputProps["content"] | undefined = liveStatus
			? {
					type: "live",
					streamState: streamState ?? null,
					streamTools: streamTools ?? [],
					liveStatus,
					subagentStatusOverrides: subagentStatusOverrides ?? new Map(),
				}
			: undefined;
		const assistantContent: StreamingOutputProps["content"] | undefined = parsed
			? { type: "durable", parsed }
			: liveContent;

		const conversationItemProps: { role: "user" | "assistant" } = {
			role: isUser ? "user" : "assistant",
		};

		return (
			<div
				data-testid={showRowIdentity ? `chat-message-${renderKey}` : undefined}
				data-message-key={showRowIdentity ? renderKey : undefined}
				className={cn(
					isAfterEditingMessage && "opacity-40 pointer-events-none",
					"group/msg relative transition-opacity duration-200",
				)}
				inert={isAfterEditingMessage ? true : undefined}
			>
				<ConversationItem {...conversationItemProps}>
					{isUser && displayState && parsed ? (
						<UserMessageContent
							displayState={displayState}
							markdown={parsed.markdown}
							isEditing={
								messageId !== undefined && editingMessageId === messageId
							}
							fadeFromBottom={fadeFromBottom}
							onImageClick={setPreviewImage}
							onTextFileClick={setPreviewText}
						/>
					) : assistantContent ? (
						<Message className="w-full">
							<MessageContent className="whitespace-normal">
								<StreamingOutput
									renderKey={renderKey}
									content={assistantContent}
									subagentTitles={subagentTitles}
									subagentVariants={subagentVariants}
									showDesktopPreviews={showDesktopPreviews}
									onImplementPlan={onImplementPlan}
									onSendAskUserQuestionResponse={onSendAskUserQuestionResponse}
									isChatCompleted={isChatCompleted}
									latestAskUserQuestionToolId={latestAskUserQuestionToolId}
									askUserQuestionResponseTextByToolId={
										askUserQuestionResponseTextByToolId
									}
									hasUserResponseAfterAskQuestion={
										hasUserResponseAfterAskQuestion
									}
									onImageClick={setPreviewImage}
									onTextFileClick={setPreviewText}
									urlTransform={urlTransform}
									mcpServers={mcpServers}
								/>
							</MessageContent>
						</Message>
					) : null}
				</ConversationItem>
				{parsed?.hookNotices.map((notice, index) => (
					<LifecycleHookNotice
						key={`${renderKey}-hook-notice-${index}`}
						urlTransform={urlTransform}
					>
						{notice}
					</LifecycleHookNotice>
				))}
				{displayState &&
					!hideActions &&
					(displayState.hasCopyableContent ||
						(isUser && onEditUserMessage)) && (
						<div
							className={cn(
								"mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100",
								isUser && "w-full justify-end",
							)}
							data-testid="message-actions"
						>
							{displayState.hasCopyableContent && parsed && (
								<CopyButton
									text={parsed.markdown}
									label="Copy message"
									className="size-6"
									tooltipSide="bottom"
								/>
							)}
							{isUser && messageId !== undefined && onEditUserMessage && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											size="icon"
											variant="subtle"
											className="size-6"
											aria-label="Edit message"
											onClick={() => {
												const { text, fileBlocks } =
													getEditableUserMessagePayload(message);
												if (messageId !== undefined) {
													onEditUserMessage(messageId, text, fileBlocks);
												}
											}}
										>
											<PencilIcon />
											<span className="sr-only">Edit message</span>
										</Button>
									</TooltipTrigger>
									<TooltipContent side="bottom">Edit message</TooltipContent>
								</Tooltip>
							)}
							{isUser &&
								onJumpToUserMessage &&
								(prevUserMessageId !== undefined ||
									nextUserMessageId !== undefined) && (
									<>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													size="icon"
													variant="subtle"
													className="size-6"
													aria-label="Jump to previous user message"
													disabled={prevUserMessageId === undefined}
													onClick={() => {
														if (prevUserMessageId !== undefined) {
															onJumpToUserMessage(prevUserMessageId);
														}
													}}
												>
													<ChevronLeftIcon />
													<span className="sr-only">
														Jump to previous user message
													</span>
												</Button>
											</TooltipTrigger>
											<TooltipContent side="bottom">
												Jump to previous user message
											</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													size="icon"
													variant="subtle"
													className="size-6"
													aria-label="Jump to next user message"
													disabled={nextUserMessageId === undefined}
													onClick={() => {
														if (nextUserMessageId !== undefined) {
															onJumpToUserMessage(nextUserMessageId);
														}
													}}
												>
													<ChevronRightIcon />
													<span className="sr-only">
														Jump to next user message
													</span>
												</Button>
											</TooltipTrigger>
											<TooltipContent side="bottom">
												Jump to next user message
											</TooltipContent>
										</Tooltip>
									</>
								)}
						</div>
					)}
				{displayState?.needsAssistantBottomSpacer && !isLastMessage && (
					<div className="min-h-6" data-testid="assistant-bottom-spacer" />
				)}
				{previewImage && (
					<ImageLightbox
						src={previewImage}
						onClose={() => setPreviewImage(null)}
					/>
				)}
				{previewText !== null && (
					<TextPreviewDialog
						content={previewText.content}
						fileName={previewText.fileName}
						mediaType={previewText.mediaType}
						onClose={() => setPreviewText(null)}
					/>
				)}
			</div>
		);
	},
);

const StickyUserMessage = memo<{
	message: RenderableChatMessage;
	parsed: ParsedMessageContent;
	onEditUserMessage?: (
		messageId: number,
		text: string,
		fileBlocks?: readonly TypesGen.ChatMessagePart[],
	) => void;
	editingMessageId?: number | null;
	isAfterEditingMessage?: boolean;
	prevUserMessageId?: number;
	nextUserMessageId?: number;
	onJumpToUserMessage?: (messageId: number) => void;
	sentinelsRef?: RefObject<Map<string, HTMLDivElement>>;
	urlTransform?: UrlTransform;
}>(
	({
		message,
		parsed,
		onEditUserMessage,
		editingMessageId,
		isAfterEditingMessage = false,
		prevUserMessageId,
		nextUserMessageId,
		onJumpToUserMessage,
		sentinelsRef,
		urlTransform,
	}) => {
		const [isStuck, setIsStuck] = useState(false);
		const [isReady, setIsReady] = useState(false);
		const [isTooTall, setIsTooTall] = useState(false);
		const sentinelRef = useRef<HTMLDivElement>(null);
		const messageKey = getChatMessageRenderKey(message);
		const setSentinelRef = (el: HTMLDivElement | null) => {
			sentinelRef.current = el;
			if (el) {
				sentinelsRef?.current.set(messageKey, el);
			} else {
				sentinelsRef?.current.delete(messageKey);
			}
		};
		const containerRef = useRef<HTMLDivElement>(null);
		const updateFnRef = useRef<(() => void) | null>(null);

		// useLayoutEffect so isStuck and --clip-h are both resolved
		// before the browser paints, avoiding a flash on load.
		useLayoutEffect(() => {
			const sentinel = sentinelRef.current;
			if (!sentinel) return;
			// Immediate check so the first paint is correct when the
			// sentinel is already scrolled out of view.
			const scroller = sentinel.closest(".overflow-y-auto");
			if (scroller) {
				const stuck =
					sentinel.getBoundingClientRect().top <
					scroller.getBoundingClientRect().top;
				if (stuck) {
					setIsStuck(true);
				}
			}
			setIsReady(true);
			const observer = new IntersectionObserver(
				([entry]) => setIsStuck(!entry.isIntersecting),
				{ threshold: 0 },
			);
			observer.observe(sentinel);
			return () => observer.disconnect();
		}, []);

		// Sets a single CSS custom property (--clip-h) on the sticky
		// container. All visual behaviour (max-height, mask fade) is
		// driven by CSS using this variable.
		useLayoutEffect(() => {
			const sentinel = sentinelRef.current;
			const container = containerRef.current;
			if (!sentinel || !container) return;
			const scroller = sentinel.closest(
				".overflow-y-auto",
			) as HTMLElement | null;
			if (!scroller) return;

			const MIN_HEIGHT = 72;
			const STICKY_TOP = 8;

			const update = () => {
				// Read the scroller geometry on each tick. Caching it goes
				// stale when the scroller moves or resizes without a window
				// resize (for example the composer growing), which skews the
				// clip height and push-up math.
				const scrollerTop = scroller.getBoundingClientRect().top;
				const scrollerHeight = scroller.clientHeight;
				const fullHeight = container.offsetHeight;

				// Skip sticky behavior for messages that take up
				// most of the visible area — accounting for the
				// chat input and some breathing room.
				const tooTall = fullHeight > scrollerHeight * 0.75;
				setIsTooTall(tooTall);
				if (tooTall) {
					container.style.setProperty("--clip-h", `${fullHeight}px`);
					container.style.setProperty("--fade-opacity", "0");
					container.style.top = `${STICKY_TOP}px`;

					return;
				}
				const sentinelTop = sentinel.getBoundingClientRect().top;
				const scrolledPast = scrollerTop - sentinelTop;

				if (scrolledPast <= 0) {
					// Always set a valid value so the overlay has the
					// correct height immediately when isStuck flips.
					container.style.setProperty("--clip-h", `${fullHeight}px`);
					container.style.setProperty("--fade-opacity", "0");
					container.style.top = `${STICKY_TOP}px`;

					return;
				}
				const visible = Math.max(fullHeight - scrolledPast, MIN_HEIGHT);
				container.style.setProperty("--clip-h", `${visible}px`);
				// Only show the blur and gradient once the message
				// is near its minimum compressed height. Ramp over
				// the last 40px before MIN_HEIGHT so it doesn't pop.
				const FADE_RANGE = 40;
				const fade = Math.max(
					0,
					Math.min((MIN_HEIGHT + FADE_RANGE - visible) / FADE_RANGE, 1),
				);
				container.style.setProperty("--fade-opacity", String(fade));
				// Push-up effect: when the next user message's sentinel
				// approaches the bottom of this sticky container, shift
				// this container upward so it slides out of view — the
				// same visual as the old section-boundary behavior.
				let nextSentinel: Element | null = sentinel.nextElementSibling;
				while (nextSentinel) {
					if (nextSentinel.hasAttribute("data-user-sentinel")) {
						break;
					}
					nextSentinel = nextSentinel.nextElementSibling;
				}
				if (nextSentinel) {
					const nextY = nextSentinel.getBoundingClientRect().top - scrollerTop;
					container.style.top = `${Math.min(STICKY_TOP, nextY - visible + STICKY_TOP)}px`;
				} else {
					container.style.top = `${STICKY_TOP}px`;
				}
			};
			updateFnRef.current = update;

			// Throttle to one update per animation frame so we don't
			// do redundant work on high-refresh-rate displays.
			let rafId: number | null = null;
			const onScroll = () => {
				if (rafId !== null) return;
				rafId = requestAnimationFrame(() => {
					rafId = null;
					update();
				});
			};

			// Re-run the visual update when the transcript height changes,
			// for example a streaming response or several messages arriving
			// at once. In flex-col-reverse the scrollTop stays at 0 while
			// pinned to the bottom, so no scroll event fires; observing the
			// content wrapper catches that growth instead.
			//
			// The scroller's firstElementChild is the flex spacer that pins
			// content to the bottom. It collapses to 0px once the transcript
			// overflows and then stops emitting resize callbacks, which is
			// exactly when truncation is active, so observe the real content
			// node (an ancestor of the sentinel) and fall back to the spacer
			// only when the marker is absent.
			const contentEl =
				sentinel.closest<HTMLElement>("[data-chat-scroll-content]") ??
				(scroller.firstElementChild as HTMLElement | null);
			let contentRafId: number | null = null;
			const contentObserver = contentEl
				? new ResizeObserver(() => {
						if (contentRafId !== null) return;
						contentRafId = requestAnimationFrame(() => {
							contentRafId = null;
							update();
						});
					})
				: null;
			contentObserver?.observe(contentEl!);

			scroller.addEventListener("scroll", onScroll, { passive: true });
			window.addEventListener("resize", update);
			update();
			// Set immediately — both --clip-h and --overlay-ready are
			// applied before the browser paints since we're in a
			// useLayoutEffect.
			container.style.setProperty("--overlay-ready", "1");
			return () => {
				scroller.removeEventListener("scroll", onScroll);
				window.removeEventListener("resize", update);
				contentObserver?.disconnect();
				container.style.removeProperty("--overlay-ready");
				if (rafId !== null) cancelAnimationFrame(rafId);
				if (contentRafId !== null) cancelAnimationFrame(contentRafId);
			};
		}, []);

		// Re-run the height calculation synchronously whenever
		// isStuck changes so --clip-h is correct on the same frame
		// the overlay appears. Without this, the async
		// IntersectionObserver + RAF-throttled scroll handler can
		// leave a stale --clip-h for one paint.
		// biome-ignore lint/correctness/useExhaustiveDependencies: isStuck is an intentional trigger
		useLayoutEffect(() => {
			updateFnRef.current?.();
		}, [isStuck]);

		const handleEditUserMessage = onEditUserMessage
			? (
					messageId: number,
					text: string,
					fileBlocks?: readonly TypesGen.ChatMessagePart[],
				) => {
					onEditUserMessage(messageId, text, fileBlocks);
					requestAnimationFrame(() => {
						const sentinel = sentinelRef.current;
						if (!sentinel) return;
						const scroller = sentinel.closest(
							".overflow-y-auto",
						) as HTMLElement | null;
						if (!scroller) return;
						const offset =
							sentinel.getBoundingClientRect().top -
							scroller.getBoundingClientRect().top;
						scroller.scrollBy({ top: offset, behavior: "smooth" });
					});
				}
			: undefined;

		return (
			<>
				<div ref={setSentinelRef} className="h-0" data-user-sentinel />
				<div
					ref={containerRef}
					data-testid={`chat-message-${messageKey}`}
					data-message-key={messageKey}
					className={cn(
						"relative px-3 -mx-3 -mt-2",
						!isTooTall && "sticky z-10",
						!isReady && "invisible",
						isStuck && !isTooTall && "pointer-events-none",
					)}
				>
					{/* Flow element: always in the DOM to preserve
				    scroll layout. Hidden when stuck so the
				    clipped overlay takes over visually. */}
					<div
						className={
							isStuck && !isTooTall ? undefined : "pointer-events-auto"
						}
						style={
							isStuck && !isTooTall
								? { opacity: "calc(1 - var(--overlay-ready, 0))" }
								: undefined
						}
						// While the overlay copy is shown, drop the flow copy
						// from the accessibility tree so the message and its
						// hook notices aren't exposed twice.
						aria-hidden={isStuck && !isTooTall ? true : undefined}
						inert={isStuck && !isTooTall ? true : undefined}
					>
						<ChatMessageItem
							renderKey={messageKey}
							showRowIdentity={false}
							row={{ type: "message", message, parsed }}
							onEditUserMessage={handleEditUserMessage}
							editingMessageId={editingMessageId}
							isAfterEditingMessage={isAfterEditingMessage}
							prevUserMessageId={prevUserMessageId}
							nextUserMessageId={nextUserMessageId}
							onJumpToUserMessage={onJumpToUserMessage}
							urlTransform={urlTransform}
						/>
					</div>

					{/* Overlay: absolutely positioned, matching the
				    sticky container. max-height + mask are driven
				    entirely by the --clip-h CSS variable which the
				    scroll handler sets on the container. */}
					{isStuck && !isTooTall && (
						<div
							className="absolute inset-0"
							style={{
								opacity: "var(--overlay-ready, 0)",
								contain: "layout style",
							}}
						>
							{/* Blur layer: extends 48px beyond the
						    clipped content so the frosted effect
						    is visible around the bubble. Promoted
						    to its own GPU layer via will-change. */}
							<div
								className="absolute inset-0 backdrop-blur-[1px] bg-surface-primary/15"
								style={{
									opacity: "var(--fade-opacity, 0)",
									maxHeight: "calc(var(--clip-h, 100%) + 48px)",
									willChange: "max-height, mask-image",
									maskImage:
										"linear-gradient(to bottom, black calc(var(--clip-h, 100%) + 24px), transparent calc(var(--clip-h, 100%) + 48px))",
									WebkitMaskImage:
										"linear-gradient(to bottom, black calc(var(--clip-h, 100%) + 24px), transparent calc(var(--clip-h, 100%) + 48px))",
								}}
							/>
							{/* Content layer: px-3 matches the sticky
							    container's padding so the overlay aligns
							    with the flow element. will-change promotes
							    to GPU layer. */}
							<div className="relative px-3 pointer-events-auto will-change-[max-height]">
								<ChatMessageItem
									renderKey={messageKey}
									showRowIdentity={false}
									row={{ type: "message", message, parsed }}
									onEditUserMessage={handleEditUserMessage}
									editingMessageId={editingMessageId}
									isAfterEditingMessage={isAfterEditingMessage}
									prevUserMessageId={prevUserMessageId}
									nextUserMessageId={nextUserMessageId}
									onJumpToUserMessage={onJumpToUserMessage}
									urlTransform={urlTransform}
									fadeFromBottom
								/>
							</div>
						</div>
					)}
				</div>
			</>
		);
	},
);

function computeLastInChainFlags(
	displayMessages: readonly ParsedMessageEntry[],
): boolean[] {
	const flags = new Array<boolean>(displayMessages.length).fill(false);
	let nextVisibleIsUser = true;
	for (let i = displayMessages.length - 1; i >= 0; i--) {
		const entry = displayMessages[i];
		if (entry.message.role === "system") {
			nextVisibleIsUser = true;
			continue;
		}
		if (entry.message.role !== "user") {
			flags[i] = nextVisibleIsUser;
		}
		nextVisibleIsUser = entry.message.role === "user";
	}
	return flags;
}

type TimelineRow =
	| { type: "message"; entry: ParsedMessageEntry; index: number; key: string }
	| { type: "live"; key: string; liveStatus: LiveStatusModel };

const buildTimelineRows = (
	displayMessages: readonly ParsedMessageEntry[],
	liveStatus: LiveStatusModel | undefined,
): TimelineRow[] => {
	const rows: TimelineRow[] = [];
	let userKey: string | undefined;
	let assistantOrdinal = 0;
	for (const [index, entry] of displayMessages.entries()) {
		const { message } = entry;
		if (message.role === "user") {
			userKey = getChatMessageRenderKey(message);
			assistantOrdinal = 0;
			rows.push({ type: "message", entry, index, key: userKey });
			continue;
		}
		if (message.role === "assistant" && userKey) {
			rows.push({
				type: "message",
				entry,
				index,
				key: `${userKey}:assistant:${assistantOrdinal}`,
			});
			assistantOrdinal += 1;
			continue;
		}
		rows.push({
			type: "message",
			entry,
			index,
			key: getChatMessageRenderKey(message),
		});
	}
	if (liveStatus && shouldRenderLiveAssistant(liveStatus)) {
		rows.push({
			type: "live",
			key: userKey
				? `${userKey}:assistant:${assistantOrdinal}`
				: "live-assistant",
			liveStatus,
		});
	}
	return rows;
};

interface ConversationTimelineProps {
	parsedMessages: readonly ParsedMessageEntry[];
	streamState?: StreamState | null;
	streamTools?: readonly MergedTool[];
	liveStatus?: LiveStatusModel;
	subagentStatusOverrides?: Map<string, TypesGen.ChatStatus>;
	subagentTitles: Map<string, string>;
	subagentVariants?: Map<string, SubagentVariant>;
	onEditUserMessage?: (
		messageId: number,
		text: string,
		fileBlocks?: readonly TypesGen.ChatMessagePart[],
	) => void;
	editingMessageId?: number | null;
	onImplementPlan?: () => Promise<void> | void;
	onSendAskUserQuestionResponse?: (message: string) => Promise<void> | void;
	isChatCompleted?: boolean;
	urlTransform?: UrlTransform;
	mcpServers?: readonly TypesGen.MCPServerConfig[];
	showDesktopPreviews?: boolean;
	hasActiveStream?: boolean;
	isAwaitingFirstStreamChunk?: boolean;
}

export const ConversationTimeline = memo<ConversationTimelineProps>(
	({
		parsedMessages,
		streamState,
		streamTools = [],
		liveStatus,
		subagentStatusOverrides,
		subagentTitles,
		subagentVariants,
		onEditUserMessage,
		editingMessageId,
		onImplementPlan,
		onSendAskUserQuestionResponse,
		isChatCompleted,
		urlTransform,
		mcpServers,
		showDesktopPreviews,
		hasActiveStream,
		isAwaitingFirstStreamChunk,
	}) => {
		const sentinelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
		const jumpToUserMessage = (messageId: number) => {
			const message = parsedMessages.find(
				(entry) =>
					isDurableChatMessage(entry.message) && entry.message.id === messageId,
			)?.message;
			if (!message) {
				return;
			}
			sentinelsRef.current
				.get(getChatMessageRenderKey(message))
				?.scrollIntoView({
					behavior: "smooth",
					block: "start",
				});
		};

		const displayMessages = buildDisplayMessages(parsedMessages);
		const lastInChainFlags = computeLastInChainFlags(displayMessages);
		const renderRows = buildTimelineRows(displayMessages, liveStatus);

		if (renderRows.length === 0) {
			return null;
		}

		// Build a set of message IDs that appear after the message
		// currently being edited so they can be visually faded.
		const afterEditingMessageIds = new Set<number>();
		if (editingMessageId != null) {
			let found = false;
			for (const entry of parsedMessages) {
				if (
					isDurableChatMessage(entry.message) &&
					entry.message.id === editingMessageId
				) {
					found = true;
					continue;
				}
				if (found && isDurableChatMessage(entry.message)) {
					afterEditingMessageIds.add(entry.message.id);
				}
			}
		}

		// Ordered list of visible user message IDs, used to drive the
		// per-bubble prev/next arrow buttons that jump the transcript
		// to the neighbouring user prompt.
		const visibleUserMessageIds: number[] = [];
		for (const { message, parsed } of parsedMessages) {
			if (message.role !== "user" || !isDurableChatMessage(message)) continue;
			const { shouldHide } = deriveMessageDisplayState({
				message,
				parsed,
				hideActions: false,
				hasActiveStream: false,
				isAwaitingFirstStreamChunk: false,
			});
			if (!shouldHide) visibleUserMessageIds.push(message.id);
		}
		const userNeighborsById = new Map<
			number,
			{ prevId?: number; nextId?: number }
		>();
		for (let i = 0; i < visibleUserMessageIds.length; i++) {
			userNeighborsById.set(visibleUserMessageIds[i], {
				prevId: i > 0 ? visibleUserMessageIds[i - 1] : undefined,
				nextId:
					i < visibleUserMessageIds.length - 1
						? visibleUserMessageIds[i + 1]
						: undefined,
			});
		}
		let latestAskUserQuestionToolId: string | undefined;
		let hasUserResponseAfterAskQuestion = false;
		const askUserQuestionResponseTextByToolId = new Map<string, string>();
		let pendingAskUserQuestionToolId: string | undefined;
		for (const { message, parsed } of parsedMessages) {
			let askUserQuestionToolIdInMessage: string | undefined;
			for (const tool of parsed.tools) {
				if (tool.name === "ask_user_question") {
					askUserQuestionToolIdInMessage = tool.id;
					latestAskUserQuestionToolId = tool.id;
					hasUserResponseAfterAskQuestion = false;
				}
			}

			if (askUserQuestionToolIdInMessage) {
				pendingAskUserQuestionToolId = askUserQuestionToolIdInMessage;
			}

			if (pendingAskUserQuestionToolId && message.role === "user") {
				hasUserResponseAfterAskQuestion =
					pendingAskUserQuestionToolId === latestAskUserQuestionToolId;
				const responseText = getChatMessageTextContent(message.content);
				if (responseText !== undefined) {
					askUserQuestionResponseTextByToolId.set(
						pendingAskUserQuestionToolId,
						responseText,
					);
				}
				pendingAskUserQuestionToolId = undefined;
			}
		}
		const historicalAskUserQuestionResponseTextByToolId =
			askUserQuestionResponseTextByToolId.size > 0
				? askUserQuestionResponseTextByToolId
				: undefined;

		return (
			<FileProbeProvider>
				<div
					data-testid="conversation-timeline"
					className="flex flex-col gap-2"
				>
					{renderRows.map((row) => {
						if (row.type === "live") {
							return (
								<ChatMessageItem
									key={row.key}
									renderKey={row.key}
									row={{
										type: "live",
										streamState: streamState ?? null,
										streamTools,
										liveStatus: row.liveStatus,
										subagentStatusOverrides:
											subagentStatusOverrides ?? new Map(),
									}}
									subagentTitles={subagentTitles}
									subagentVariants={subagentVariants}
									urlTransform={urlTransform}
									mcpServers={mcpServers}
								/>
							);
						}
						const { message, parsed } = row.entry;
						const msgIdx = row.index;
						const stableKey = row.key;
						const messageId = isDurableChatMessage(message)
							? message.id
							: undefined;
						if (message.role === "user") {
							const { shouldHide } = deriveMessageDisplayState({
								message,
								parsed,
								hideActions: false,
								hasActiveStream: false,
								isAwaitingFirstStreamChunk: false,
							});
							if (shouldHide) {
								return null;
							}
							return (
								<StickyUserMessage
									key={stableKey}
									message={message}
									parsed={parsed}
									onEditUserMessage={onEditUserMessage}
									editingMessageId={editingMessageId}
									isAfterEditingMessage={
										messageId !== undefined &&
										afterEditingMessageIds.has(messageId)
									}
									prevUserMessageId={
										messageId === undefined
											? undefined
											: userNeighborsById.get(messageId)?.prevId
									}
									nextUserMessageId={
										messageId === undefined
											? undefined
											: userNeighborsById.get(messageId)?.nextId
									}
									onJumpToUserMessage={jumpToUserMessage}
									sentinelsRef={sentinelsRef}
									urlTransform={urlTransform}
								/>
							);
						}
						// Hide actions on assistant messages that are not the
						// last in a consecutive assistant chain. Flags are
						// precomputed in a single reverse pass above.
						const isLastInChain = lastInChainFlags[msgIdx];
						return (
							<ChatMessageItem
								key={stableKey}
								renderKey={stableKey}
								row={{ type: "message", message, parsed }}
								onImplementPlan={onImplementPlan}
								onSendAskUserQuestionResponse={onSendAskUserQuestionResponse}
								isChatCompleted={isChatCompleted}
								latestAskUserQuestionToolId={latestAskUserQuestionToolId}
								askUserQuestionResponseTextByToolId={
									historicalAskUserQuestionResponseTextByToolId
								}
								hasUserResponseAfterAskQuestion={
									hasUserResponseAfterAskQuestion
								}
								urlTransform={urlTransform}
								isAfterEditingMessage={
									messageId !== undefined &&
									afterEditingMessageIds.has(messageId)
								}
								hideActions={!isLastInChain}
								hasActiveStream={Boolean(hasActiveStream)}
								isAwaitingFirstStreamChunk={Boolean(isAwaitingFirstStreamChunk)}
								isLastMessage={msgIdx === displayMessages.length - 1}
								mcpServers={mcpServers}
								subagentTitles={subagentTitles}
								subagentVariants={subagentVariants}
								showDesktopPreviews={showDesktopPreviews}
							/>
						);
					})}
				</div>
			</FileProbeProvider>
		);
	},
);
