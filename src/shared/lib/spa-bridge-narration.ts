/**
 * One line of an agent's work, as `main/session-narration.js › entryFor` emits it. Import from
 * `./spa-bridge`, the import path of record.
 */

/**
 * Every field is already-summarized display text, bounded main-side. `inputFull` never enters a
 * ring entry: it is unbounded and this feed crosses to a renderer.
 */
export interface DesktopNarrationEntry {
  /** Epoch ms. */
  at: number;
  /**
   * A closed vocabulary; render an unknown kind as nothing, never a fallback bubble.
   * `thinking` the model's reasoning (collapse by default) · `assistant` narrating a public turn ·
   * `operator` the operator spoke 1:1 (what they typed, never posted) · `private` the agent's answer
   * to a private turn · `tool` / `result` a call and its outcome · `post` the agent SENT this to the
   * channel (it left the machine; a local echo, deduped against the transcript) · `status` a phase
   * move · `directed` another of this operator's agents spoke 1:1 (not the operator) ·
   * `directed-reply` this agent's answer to that.
   */
  kind:
    | "thinking"
    | "assistant"
    | "operator"
    | "private"
    | "tool"
    | "result"
    | "post"
    | "status"
    | "directed"
    | "directed-reply";
  /**
   * Who can see this line; it outranks `kind`. `channel` = it left the machine; `operator`,
   * `private` and `directed` are 1:1. Absent on the narration kinds, and absent is not `channel`.
   * `directed` names the lane, not the direction (`agent-stream-model.ts › frameLane` splits them).
   */
  lane?: "operator" | "private" | "channel" | "directed";
  /** On `tool` and `result`: joins a result to its call. */
  toolUseId?: string;
  /** The raw tool name on a `tool` entry; the renderer shortens it. */
  tool?: string;
  /** `false` only on a `result` that failed. */
  ok?: boolean;
  /**
   * Bounded main-side by kind (`main/session-narration.js`): 300 for captions, 1000 for a `post`,
   * 8000 for prose. ⚠ The prose cap equals the UI's expanded ceiling
   * (`agent-stream-log.tsx › EXPANDED_CHARS`): a cap below what the UI shows is a silent cut.
   */
  text?: string;
  /**
   * Prose kinds only: main cut this line at its cap and the tail exists nowhere (INVARIANTS §9).
   * Only an explicit `true` counts; absent means the line arrived whole.
   */
  truncated?: boolean;
  /**
   * `directed` only: which of this operator's agents filed the direction (F-376a), an 8-char agent
   * id. ⚠ A caption, unverified (derived from `X-Dopl-Session-Id`, a non-authorization header,
   * INVARIANTS §10): nothing may gate, route or authorize on it. Absent = an external orchestrator;
   * render "your agent", never a placeholder.
   */
  senderAgentId?: string;
  /**
   * `post` only: the outbound consent gate is holding it until a human presses Post (INVARIANTS §6).
   * Only `true` counts; absent means sent. It never clears — the transcript row says it landed.
   */
  pending?: boolean;
}
