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
