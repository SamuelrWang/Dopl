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
  ChannelGrantLevel,
  ContainerGrantLevel,
  GrantLevel,
  GrantResourceType,
  GrantScopeType,
  ResourceGrantInput,
  ResourceGrantResult,
} from "./grant-types.js";
export type {
  BuildResult,
  // 🔒 THE CHANNEL ROW'S CONTAINER (R-26 (b)) — declared beside `WorkspaceKind`
  // because `channel-types.ts` is at §1's cap; see its docblock.
  ChannelContainer,
  CreditConsumeResponse,
  CreditWalletKind,
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
  TemplateKnowledgeRef,
  TemplateKnowledgeScope,
  TemplateKnowledgeScopeKind,
  TemplateShelf,
  TemplateVisibility,
} from "./agent-template-types.js";
// 🔒 **`HomeChannel`, `HomePeer` AND `HomePendingLink` ARE RETIRED** (R-26 (b),
// 2026-09-17): the row is `Channel`, and the link keeps the server's own name.
export type {
  ChannelPendingLink,
  HomeChannelCreateResult,
  HomeChannelsPayload,
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
  KnowledgeOutline,
  KnowledgeOutlineRow,
  KnowledgePathOpResult,
  KnowledgeReadFileResult,
  KnowledgeSearchHit,
  KnowledgeSectionOutcome,
  KnowledgeTreeSnapshot,
  KnowledgeWriteFileInput,
  KnowledgeWriteFileResult,
  KnowledgeWriteSource,
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
  // THE ARTIFACT TYPES (#1220, 2026-09-06) — hand mirrors of
  // `src/features/channels/types.ts`; both halves move in ONE change.
  ChannelArtifact,
  ChannelArtifactAction,
  ChannelArtifactResult,
  ChannelFoldedArtifact,
  ChannelReadEntry,
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
  // ⚠ THE AGENT COLOUR KEY (2026-09-13) — sixteen names, unique per channel among
  // LIVE agents across members, freed when an agent ends. A KEY, never a colour value.
  AgentColorKey,
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
