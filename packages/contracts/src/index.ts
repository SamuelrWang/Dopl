/**
 * `@dopl/contracts` — every closed set stated in more than one tree (`src/`, `packages/*`), declared
 * once. Rules: (1) type-only — no const, function or enum, so the package needs no build step or
 * `dist/`; (2) closed sets and shapes built directly on them; a DTO only when both trees would
 * otherwise declare it (the tasks wire shapes). SQL CHECKs, zod enums and the
 * desktop's `main/*.js` copies are still compared by `scripts/check-*-drift.ts` (INVARIANTS §14).
 * No `export *`: every published name is a listed line.
 */

export type {
  ChannelVisibility,
  ChannelRole,
  ThreadMode,
  ThreadStatus,
  ThreadOutcome,
  MessageAuthorKind,
  PostableAuthorKind,
  ChannelMessageKind,
  PostableMessageKind,
  MessageIntent,
} from "./channels.js";

export type {
  SessionPillState,
  AgentColorKey,
  ChannelSessionTelemetry,
  ChannelSessionHealth,
} from "./sessions.js";

export type {
  DirectionRefusalReason,
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchDirectiveStatus,
  LaunchToolMode,
  LaunchAppliedToolMode,
  LaunchMessageMode,
} from "./directives.js";

export type {
  WorkspaceRole,
  MembershipStatus,
  WorkspaceKind,
  ContainerKind,
  IdentityVisibility,
} from "./workspaces.js";

export type {
  TaskStatus,
  SubtaskState,
  TaskActor,
  TaskActorRef,
  TaskLink,
  ChannelTaskSubtask,
  ChannelTaskNote,
  ChannelTask,
  ChannelTaskDetail,
  ChannelTaskPage,
  ChannelTaskWriteResult,
  ChannelTaskAction,
} from "./tasks.js";

// Device SDK (C1–C10, frozen v1). TYPES ONLY here: the zod schemas are values and live behind the
// `@dopl/contracts/device-sdk` subpath so this barrel stays erasable (rule 1).
export type {
  Environment,
  ApiKeyKind,
  ApiKeyScope,
  ApiKey,
  DeviceKind,
  RiskTier,
  CapabilityFamily,
  CapabilityId,
  CapabilityScope,
  LatencyClass,
  CapabilityLimits,
  PresentDisplayLimits,
  CapabilityDescriptor,
  Device,
  ConnectBranding,
  ConnectSessionCreateRequest,
  ConnectSessionCreateResponse,
  ConnectionExchangeRequest,
  ConnectionExchangeResponse,
  Grant,
  ConnectionStatus,
  Connection,
  ConnectionListResponse,
  ConnectWebhookEvent,
  DeliverIntent,
  Urgency,
  ActionStatus,
  DeliverTarget,
  DeliverContent,
  DeliverRequest,
  RoutedTo,
  DeliverResponse,
  DeviceActionRequest,
  DeviceActionResponse,
  Action,
  Posture,
  ProfileOutput,
  ProfileMatch,
  ConfirmationMode,
  ProfileConfirmation,
  ProfileOverflow,
  ContextProfile,
  DeviceContext,
  SdkBlockType,
  ChoiceOption as SdkChoiceOption,
  ImageBlock,
  V2DisplayBlock,
  DisplayBlock as SdkDisplayBlock,
  EventOutcome,
  RouteDecision,
  DeviceEventRow,
  WebhookEventName,
  ErrorType,
  ErrorCode,
  ErrorCodeInfo,
  ErrorBody,
  ErrorResponse,
  ApiVersion,
  AdapterTransport,
  PairingMethod,
  PairingSession,
  PairingFlow,
  ActionResult,
  DeviceEvent,
  DeviceHealth,
  DeviceAdapter,
} from "./device-sdk/index.js";
