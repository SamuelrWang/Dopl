/**
 * Launch-over-MCP types: asking an operator's own desktop to start (or end, rename, re-posture) an
 * agent. A directive is a request, and not a message — it never touches `channel_messages` (loop
 * brake, transcript purity), so it has no `seq` and can never end an `await`. The closed sets are
 * `@dopl/contracts › directives.ts`, re-exported here.
 */
import type {
  AgentColorKey,
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchDirectiveStatus,
  LaunchToolMode,
  LaunchMessageMode,
} from "@dopl/contracts";

export type {
  AgentColorKey,
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchDirectiveStatus,
  LaunchToolMode,
  LaunchMessageMode,
};

/**
 * One directive row. Optional fields are absent on an older server (INVARIANTS §13). `status` has
 * lazy expiry applied server-side; `expired` means nothing claimed it in time, not a failure.
 */
export interface LaunchDirective {
  id: string;
  /** `launch` on every row that names no kind. */
  kind: LaunchDirectiveKind;
  /** Always the caller's own id (the read is fenced on it); the desktop re-checks ownership locally. */
  operatorUserId: string;
  channelId: string;
  threadId: string | null;
  goal: string | null;
  model: string | null;
  /** The runtime ASKED for; `null` = did not ask (the machine's chain decides — see
   *  `appliedRuntime`). Never derived from `model`: runtime picks the adapter, model a model in it. */
  runtime?: string | null;
  /** Resolved server-side under the requester's visibility. A null id beside a live `identityName`
   *  is a deletion, and the desktop refuses `no-identity` rather than launching a blank agent. */
  identityId: string | null;
  /** Snapshot at create time; survives the id's `ON DELETE SET NULL`. */
  identityName: string | null;
  /** The colour asked for — a request, not a reservation (a collision resolves to the next free key). */
  color?: AgentColorKey | null;
  /** The name asked for; `null` on an older client's row (the machine names it `New Agent`). */
  agentName?: string | null;
  /** The name the machine actually gave it — the tag to address it by (`Coder` may be stored
   *  `Coder-1`). `null` = not reported. */
  appliedAgentName?: string | null;
  /** What the machine actually started on. `null` = not reported, never "the default"; an
   *  unusable requested runtime is refused (`no-sdk`), never swapped. `appliedModel: null` can also
   *  mean the runtime's own default. */
  appliedRuntime?: string | null;
  appliedModel?: string | null;
  status: LaunchDirectiveStatus;
  /** Set iff `status` is `refused`. */
  refusalReason: LaunchRefusalReason | null;
  /** The agent an `end` / `rename` / `set_agent_mode` acts on (an input); `null` on a launch. */
  targetAgentId: string | null;
  /** The rename's new name; non-null iff `kind` is `rename`, where `""` means clear. Display only. */
  targetName: string | null;
  /** The posture a LAUNCH asked its new session to start on; `null` = not asked (the operator's
   *  stored channel value applies). Not `target*`, which moves a running session. */
  startToolMode: LaunchToolMode | null;
  startMessageMode: LaunchMessageMode | null;
  /** Tri-state: `true` asks chaining on (refused where the channel forbids it), `false` asks it off
   *  (always granted, wins over ON), `null` inherits the channel setting. */
  chain: boolean | null;
  /** The posture a `set_agent_mode` asked a running agent to move to; `null` = that axis not asked. */
  targetToolMode: LaunchToolMode | null;
  targetMessageMode: LaunchMessageMode | null;
  /** What the machine says it applied after its clamp, in the runtime's own words. `null` = not
   *  reported — never agreement with the request, and `appliedChain: null` is not `false`. */
  appliedToolMode: LaunchToolMode | null;
  appliedMessageMode: LaunchMessageMode | null;
  appliedChain: boolean | null;
  /** The agent instance started; set iff `status` is `launched`. */
  agentId: string | null;
  claimedAt: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

/** What `createLaunchDirective` asks for. No operator field, ever: the server stamps the caller, so
 *  the only machine an agent can ask is its own operator's. */
export interface LaunchDirectiveCreateInput {
  channel: string;
  threadId?: string;
  goal?: string;
  model?: string;
  /** Which adapter (`claude`, `codex`, …); never a runtime name sent as `model`. Omitted follows the
   *  operator's chain; a runtime their machine cannot start is refused (`no-sdk`), never swapped. */
  runtime?: string;
  /** An identity id OR exact name, resolved server-side under the caller's visibility; an ambiguous
   *  name is a 409 `AGENT_IDENTITY_AMBIGUOUS` listing `details.matches`, never a pick. */
  identity?: string;
  /** Posture the new session is ASKED to start on — clamped to the operator's stored channel
   *  posture, never widened. `chain` is a tri-state (see {@link LaunchDirective.chain}). */
  tools?: LaunchToolMode;
  messages?: LaunchMessageMode;
  chain?: boolean;
  /** Idempotency key, 1-200 chars, scoped to (channel, this operator): re-sending it returns the
   *  first request's directive (`existing`) instead of queuing a second agent. */
  clientMsgId?: string;
  /** Omitted = the first free key. A taken key is a 409 `AGENT_COLOR_TAKEN` with `details.free`,
   *  never a silent substitution — retry with the same `clientMsgId`. */
  color?: AgentColorKey;
  /** Required: an agent that launches an agent names it (1-60 visible chars, one line). Display, but
   *  what others @-tag (slugged), so two live agents should not share one. */
  agentName: string;
}

/**
 * `offline: true` is a normal 200: nothing was filed and nothing is pending. `existing: true` means
 * this call filed nothing (a converged `clientMsgId` retry); absent (an older server) means "filed".
 */
export type LaunchDirectiveCreated =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective; existing?: boolean };

/**
 * What `createAgentDirective` asks for — end, rename or re-posture one of the operator's own
 * running agents. No operator field (the server stamps the caller). `channel` is required so the
 * create proves a membership row, not a bare "end agent X" primitive.
 */
export type AgentDirectiveCreateInput =
  | { kind: "end"; channel: string; agentId: string }
  /** `name: ""` means clear; bounded at 60 (the desktop store's cap). */
  | { kind: "rename"; channel: string; agentId: string; name: string }
  /**
   * At least one axis required (the route 400s an empty ask); asks, never widens. No model field —
   * the desktop's narrower has nowhere to put one. Behind the machine's launch toggle, so `no-bridge`
   * here can mean the toggle is off.
   */
  | {
      kind: "set_agent_mode";
      channel: string;
      agentId: string;
      tools?: LaunchToolMode;
      messages?: LaunchMessageMode;
    };

/** `offline: true` is a normal 200: nothing was filed. */
export type AgentDirectiveCreated =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective };
