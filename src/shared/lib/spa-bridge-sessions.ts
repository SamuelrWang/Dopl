"use client";

/**
 * The operator's own agents, as bridge ops. Import from `./spa-bridge`, the import path of record.
 * Every member is optional and callers feature-detect the member they call (INVARIANTS §11).
 * ⚠ Keep in sync with `renderer/app-preload.js` and `apps/desktop-ui/src/lib/dopl-bridge.ts`
 * (pinned by `test/preload-parity.test.mjs › APP_OPS`). Ops are own-agents-only structurally: main
 * resolves against its own registry, which holds only this operator's sessions.
 */

import type {
  DesktopSessionSummary,
  DesktopNarrationEntry,
} from "./spa-bridge-shapes";

export interface SpaBridgeSessions {
  /** `segment`: a live windowless session reopens as the agent window, whose landing is a route. */
  reopen(
    channelId: string,
    taskId: string,
    segment?: string,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string }>;
  /** Asks for an agent window; no handle comes back (main creates and registers it, `main/app-windows.js`). */
  openAgentWindow?(
    segment: string,
    channelId: string,
    taskId: string,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string }>;
  /**
   * The one op that starts a turn: the operator speaking 1:1 to their own agent, never a channel
   * post. ⚠ It starts a PRIVATE turn: main withdraws Axis B's outbound widening for the turn, so any
   * post the agent attempts reaches the outbound consent gate. It grants no tool and widens no posture.
   */
  message?(
    channelId: string,
    taskId: string,
    text: string,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string }>;
  /**
   * Display-only rename; an empty name clears it (back to `Agent #<id>`). The answer is main's stored
   * value, never an echo: a refused name comes back `ok: false` so the field reverts.
   */
  rename?(
    agentId: string,
    name: string
  ): Promise<{ ok: boolean; reason?: string; displayName?: string | null }>;
  /** What the agent is for: `rename`'s contract (machine-local, display-only, empty clears). */
  describe?(
    agentId: string,
    description: string
  ): Promise<{ ok: boolean; reason?: string; description?: string | null }>;
  /**
   * A fresh instance id to pre-assign through `launch`'s `agentId`. Its presence is the capability
   * gate for pre-assigned ids. It reserves nothing (a CSPRNG draw, `main/agent-id.js`).
   */
  mintAgentId?(): Promise<{ ok: boolean; agentId?: string }>;
  /**
   * Move a live session's posture, from its next gate decision (`session-io.js › grantArgs` reads the
   * axes at call time). It widens supervision, never containment (the profile is checked first).
   * The answer carries main's post-dispatch values, never an echo.
   */
  setMode?(
    channelId: string,
    taskId: string,
    axis: "tools" | "messages",
    mode: string,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string; tools?: string; messages?: string }>;
  /**
   * Switch a live session's model from its next response; main records the pick so a resume keeps
   * it. `model` is an id from that runtime's live catalog, `""` the product default; an id it does
   * not offer is refused `no-model` with `detail` naming what it offers. Render main's `model`.
   */
  setModel?(
    channelId: string,
    taskId: string,
    model: string,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string; model?: string; detail?: string }>;
  /** The agent's work ring. Read once on mount, then listen: push-only would leave a new window blank. */
  narration?(
    channelId: string,
    taskId: string,
    agentId?: string
  ): Promise<{ entries: DesktopNarrationEntry[] }>;
  /** Frames fan out to every app window keyed by `sessionKey`; the reader filters. */
  onNarration?(
    cb: (e: { sessionKey: string; entries: DesktopNarrationEntry[] }) => void
  ): () => void;
  summaries?(): Promise<{ sessions: DesktopSessionSummary[] }>;
  onSummaries?(cb: (e: { sessions: DesktopSessionSummary[] }) => void): () => void;
  /**
   * A new windowless agent. The click is the consent; main owns the posture
   * (`session-ipc-ops.js › sessions:launch`). Returns the new agent's address. It starts nothing:
   * the agent registers idle and its first message launches it. `counterpartyId` only labels the
   * outbound consent card.
   */
  launch?(payload: {
    channelId: string;
    /** `null` = a channel-level agent (the main room). Pass `null`, not `""` (the legacy no-thread value). */
    taskId: string | null;
    /** A pre-assigned id ({@link mintAgentId}); absent = main mints. Accepted, not trusted (`agent-id.js › isAgentId`). */
    agentId?: string;
    workspaceId?: string;
    channelName?: string;
    threadTitle?: string | null;
    counterpartyId?: string | null;
    direct?: boolean;
    /**
     * ⚠ An id, never a snapshot: main resolves the content under the operator's credential at spawn
     * (`main/identity-resolve.js`), so renderer text can never forge a prompt (F-267).
     * Absent / `null` / `""` = a blank agent; a malformed id is a refusal.
     */
    identityId?: string | null;
    /**
     * This spawn's ephemeral re-points, never written back. Absent = no override; `fields` replaces
     * the identity's set, never merges. Main re-validates (`identity-resolve.js › narrowOverrides`, F-281).
     */
    overrides?: {
      model?: string | null;
      fields?: { key: string; value: string }[];
    };
    /** Forwarded raw and re-narrowed in main (`session-launch-op.js`); absent = the machine/server decides. */
    runtime?: string;
    color?: string;
  }): Promise<{
    ok: boolean;
    agentId?: string;
    sessionId?: string | null;
    /**
     * `identity-approval` is a question: a foreign identity's first launch here; show `identity`,
     * `approveIdentity`, relaunch. `no-identity` = deleted or not visible (one word: 404-never-403).
     */
    reason?: string;
    /** With `reason: "no-model"`: main's sentence naming the models it offers. */
    detail?: string;
    /** Only with `reason: "identity-approval"`: the text to show. */
    identity?: { name?: string | null; instructions?: string | null } | null;
  }>;
  /** Interrupt the turn in flight; the session stays live. Omitting `agentId` pauses the oldest live agent. */
  pause?(
    channelId: string,
    taskId: string,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string }>;
  /**
   * Answer one tool call held at the gate (the agent panel's inline Approve / Deny). Allow-once: no
   * standing grant. It carries a human's answer to a parked resolver and widens nothing.
   * `{ ok: false }` is a real outcome (`unknown-request`, `already-decided`, `no-session`).
   * ⚠ Name the `agentId`: an omitted id resolves to the oldest live agent, a different question.
   */
  answerPermission?(
    channelId: string,
    taskId: string,
    requestId: string,
    allow: boolean,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string; decision?: string }>;
  /**
   * End the agent; touches no thread (INVARIANTS §5). Ended is dead: later ops naming it answer
   * `no-session`. Its card survives seven days as read-only history.
   */
  end?(
    channelId: string,
    taskId: string,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string }>;
  /**
   * `end` (same stop path, INVARIANTS §11) plus erasing every local trace. Deletion is local: the
   * agent's posts stay in the channel, attributed by their own stamp. ⚠ `agentId` is required: a
   * destructive verb must never fall back to the oldest live agent. `ended: true` = it stopped a
   * running session.
   */
  delete?(
    channelId: string,
    taskId: string,
    agentId: string
  ): Promise<{ ok: boolean; reason?: string; ended?: boolean }>;
  /**
   * Record this machine's first-use approval of another member's identity, per identity. It grants
   * nothing but the prompt text. ⚠ Machine-local and never reachable from the server: a server-stored
   * approval would let a credential-holding agent pre-approve itself everywhere (`main/channel-prefs.js`).
   */
  approveIdentity?(identityId: string): Promise<{ ok: boolean; reason?: string }>;
  /**
   * Call after a thread delete succeeds (main cannot see the server cascade). Drops local ended-agent
   * history only; never messages, never a live session.
   */
  forgetThread?(
    channelId: string,
    taskId: string
  ): Promise<{ ok: boolean; forgotten?: number }>;
}
