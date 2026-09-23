/** Launch-over-MCP types: an operator's agent asking that operator's own desktop to start or
 *  manage an agent. The closed sets are declared in `@dopl/contracts › directives.ts`. */
import type {
  AgentColorKey,
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchDirectiveStatus,
  LaunchToolMode,
  LaunchMessageMode,
} from "@dopl/contracts";

export type {
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchToolMode,
  LaunchMessageMode,
};

/** Not a message (INVARIANTS §5): no `seq`, and it can never end an `await`. `status` is the
 *  reported one, lazy expiry applied, so it may differ from the stored column. */
export type LaunchDirective = {
  id: string;
  kind: LaunchDirectiveKind;
  /** Always the reader's own id (every read is fenced on it); here for the desktop's local
   *  ownership re-check of rows it did not get through an authed read (F-284). */
  operatorUserId: string;
  channelId: string;
  threadId: string | null;
  goal: string | null;
  model: string | null;
  /** Requested runtime; `null` = did not ask, never "claude" and never inferred from `model`. */
  runtime: string | null;
  /** `null` when none was named OR the identity was deleted (SET NULL); `identityName` is a
   *  snapshot, so a null id beside a name means deleted and the desktop refuses `no-identity`. */
  identityId: string | null;
  identityName: string | null;
  /** A request, not a reservation; `null` = none named and none free at create. */
  color: AgentColorKey | null;
  /** The requested name; `null` from an older MCP client, and the machine then uses `New Agent`. */
  agentName: string | null;
  /** The machine's stored name (e.g. `Coder-1`): address the agent by it. `null` = not reported. */
  appliedAgentName: string | null;
  /** `done` is the non-launch kinds' success; `launched` is never reused for it. */
  status: LaunchDirectiveStatus;
  refusalReason: LaunchRefusalReason | null;
  targetAgentId: string | null;
  /** The rename's new name: `""` clears it, `null` means this is not a rename. */
  targetName: string | null;
  /** A launch's requested posture (`null` = not asked); the machine clamps it. */
  startToolMode: LaunchToolMode | null;
  startMessageMode: LaunchMessageMode | null;
  /** Tri-state request: `true` asks on (refused `no-chain` where the channel forbids it),
   *  `false` always wins, `null` inherits the channel setting. */
  chain: boolean | null;
  /** A `set_agent_mode`'s requested posture; `null` on every other kind. */
  targetToolMode: LaunchToolMode | null;
  targetMessageMode: LaunchMessageMode | null;
  /** The machine's report after its clamp; `null` = not reported, never the request echoed. */
  appliedToolMode: LaunchToolMode | null;
  appliedMessageMode: LaunchMessageMode | null;
  appliedChain: boolean | null;
  /** What the machine actually started on; `null` = not reported, never "claude". */
  appliedRuntime: string | null;
  appliedModel: string | null;
  /** Retired: `null` on new rows (no server clamp); the desktop falls back to `start*`. */
  resolvedToolMode: LaunchToolMode | null;
  resolvedMessageMode: LaunchMessageMode | null;
  resolvedChain: boolean | null;
  resolvedModel: string | null;
  /** Set iff `status` is `launched`; the requester addresses it as `@<agentId>`. */
  agentId: string | null;
  claimedAt: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
};
