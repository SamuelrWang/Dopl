export { DoplClient } from "./client.js";
export type { DoplClientOptions } from "./client.js";
export { workspaceContext } from "./transport.js";
export {
  DoplAbortError,
  DoplApiError,
  DoplAuthError,
  DoplNetworkError,
  DoplTimeoutError,
} from "./errors.js";
export { isStandardWorkspace } from "./types.js";
export type {
  BuildResult,
  CreditConsumeResponse,
  WorkspaceKind,
  WorkspaceRole,
  WorkspaceSummary,
  WorkspaceListItem,
  DoplEntry,
  ListResult,
  PendingIngestItem,
  PendingStatus,
  PrepareIngestResult,
  ResolvedWorkspace,
  SearchResult,
  SubmitIngestedEntryInput,
  SubmitIngestedEntryResult,
} from "./types.js";
export type {
  AgentTemplate,
  AgentTemplateCreateInput,
  AgentTemplateListPayload,
  AgentTemplateUpdateInput,
  TemplateField,
  TemplateKnowledgeBaseRef,
  TemplateShelf,
  TemplateVisibility,
} from "./agent-template-types.js";
export type {
  HomeChannel,
  HomeChannelCreateResult,
  HomeChannelsPayload,
  HomePeer,
  HomePendingLink,
} from "./home-types.js";
export type {
  KbShelf,
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseListPayload,
  KnowledgeBaseUpdateInput,
  KnowledgeDirListing,
  KnowledgeEntry,
  KnowledgeEntryType,
  KnowledgeFolder,
  KnowledgePathOpResult,
  KnowledgeSearchHit,
  KnowledgeTreeSnapshot,
  KnowledgeWriteFileInput,
  KnowledgeWriteSource,
  // PINNED STARTUP CONTEXT (T81) — the payload `getKbStartupContext` returns.
  StartupContext,
  StartupContextItem,
  StartupContextPointer,
} from "./knowledge-types.js";
export type {
  ResolvedSkill,
  ResolvedSkillReference,
  Skill,
  SkillAccessMode,
  SkillConnector,
  SkillProvider,
  SkillStatus,
  SkillVisibility,
  SkillWriteSource,
} from "./skill-types.js";
export type {
  Chat,
  ChatDeliverable,
  ChatDetail,
  ChatExportFormat,
  ChatExportInput,
  ChatFolder,
  ChatFolderAccessMode,
  ChatFolderUpdateInput,
  ChatList,
  ChatMessage,
  ChatMessageInput,
  ChatMessageRole,
  ChatOwner,
  ChatSource,
  ChatUpdateInput,
  ChatVisibility,
} from "./chat-types.js";
export type {
  AccessMatrix,
  AccessMatrixResource,
  EffectiveAccessRow,
  MemberAccessLevel,
  MembershipStatus,
  MemberTeamRef,
  MyAccess,
  MyMembership,
  TeamGrant,
  WorkspaceMember,
  WorkspaceTeam,
} from "./member-types.js";
export type {
  AwaitMessagesOptions,
  AwaitResult,
  Channel,
  ChannelAuthorKind,
  ChannelCreateInput,
  ChannelDelivery,
  ChannelMember,
  ChannelMemberRole,
  ChannelMessage,
  ChannelMessageInput,
  ChannelMessagePosted,
  ChannelMessageKind,
  ChannelSessionState,
  ChannelSessionStateOwn,
  ChannelSessionsPage,
  ChannelSessionTelemetry,
  ChannelThread,
  ChannelThreadCreated,
  ChannelThreadCreateInput,
  ChannelThreadPage,
  ChannelVisibility,
  ChannelWakeVerdict,
  MessageIntent,
  ReadMessagesOptions,
  SessionDetailKey,
  SessionPillState,
  ThreadMode,
  ThreadOutcome,
  WorkspaceAwaitResult,
  WorkspaceChannelMessage,
  ThreadStatus,
} from "./channel-types.js";
// ⚠ The HEALTH half of an own-scoped session — its own module because
// `channel-types.ts` is at the 500-line cap, and a HAND MIRROR of
// `src/features/channels/types-sessions.ts › ChannelSessionHealth` with no drift
// gate: both halves move in ONE change.
export type { ChannelSessionHealth } from "./session-health-types.js";
export type {
  AccountChannelMessage,
  AccountChannelStatus,
  AccountMessagesOptions,
  AccountMessagesPage,
  AccountStatus,
  AccountStatusClips,
  AccountStatusOptions,
  AccountStatusView,
  AccountWaitingItem,
} from "./account-types.js";
export type {
  ChannelInfoCard,
  ChannelInfoCardBuiltInKey,
  ChannelInfoCardRow,
  ChannelUpdateInput,
} from "./info-card-types.js";
export type {
  OntologyAttribute,
  OntologyAttributeValue,
  OntologyCluster,
  OntologyClusterCreateInput,
  OntologyClusterPatch,
  OntologyClusterSummary,
  OntologyMethod,
  OntologyObject,
  OntologyObjectCreateInput,
  OntologyObjectPatch,
  OntologyObjectSummary,
  OntologyRelationship,
  OntologySnapshot,
  OntologySummary,
  OntologyTemplateField,
} from "./ontology-types.js";

// LAUNCH-OVER-MCP types — their own module since 2026-08-22 (`channel-types.ts`
// hit the 500-line cap). ⚠ Re-exported here unchanged, so no consumer moved.
export type {
  // ⚠ THE AGENT-MANAGEMENT KINDS (2026-09-01) live in the SAME module because
  // they are the same mailbox — `end` / `rename` directives, not a second lane.
  AgentDirectiveCreateInput,
  AgentDirectiveCreated,
  LaunchDirective,
  LaunchDirectiveCreateInput,
  LaunchDirectiveCreated,
  LaunchDirectiveKind,
  // ⚠ THE TWO POSTURE AXES (2026-09-01, T24). ORDERED unions — the clamp on the
  // machine indexes into them, so their order is contract, not presentation.
  LaunchToolMode,
  LaunchMessageMode,
  LaunchRefusalReason,
} from "./launch-types.js";

// THE PRIVATE DIRECT LANE's types — their own module since 2026-08-31, for the
// same reason. ⚠ Re-exported here unchanged, so no consumer moved.
export type {
  AgentDirection,
  AgentDirectionCreateInput,
  AgentDirectionCreated,
  DirectionRefusalReason,
} from "./direction-types.js";

// STRUCTURED ESCALATION types — their own module since 2026-08-31, for the same
// reason. ⚠ Re-exported here unchanged, so no consumer moved.
export type {
  ChannelEscalationAnswerInput,
  ChannelEscalationFields,
  ChannelEscalationInput,
  ChannelEscalationOption,
} from "./escalation-types.js";
