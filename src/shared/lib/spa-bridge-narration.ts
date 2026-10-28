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
   * channel (it left the machine; a local echo, deduped against the transcript) · `inbound` a channel
   * message ARRIVED for this agent and woke it (#3081; the counterparty's words, `senderName` beside
   * them) · `status` a phase move · `directed` another of this operator's agents spoke 1:1 (not the
   * operator) · `directed-reply` this agent's answer to that.
   */
  kind:
    | "thinking"
    | "assistant"
    | "operator"
    | "private"
    | "tool"
    | "result"
    | "post"
    | "inbound"
    | "status"
    | "directed"
    | "directed-reply";
  /**
   * Who can see this line; it outranks `kind`. `channel` = it left the machine; `inbound` = it
   * arrived from the channel, so both members have it but this agent did not write it; `operator`,
   * `private` and `directed` are 1:1. Absent on the narration kinds, and absent is not `channel`.
   * `directed` names the lane, not the direction (`agent-stream-model.ts › frameLane` splits them).
   * ⚠ `inbound` is its own lane and NOT `channel`: `channel` is drawn as the dark "Posted to…" box,
   * so an arriving message on that lane would render as something this agent said.
   */
  lane?: "operator" | "private" | "channel" | "inbound" | "directed";
  /** On `tool` and `result`: joins a result to its call. */
  toolUseId?: string;
  /** The raw tool name on a `tool` entry; the renderer shortens it. */
  tool?: string;
  /** `false` only on a `result` that failed. */
  ok?: boolean;
  /**
   * `tool` and `result` only: HOW MANY TOOL USES THIS RUN HAD HAD when main appended the frame
   * (`main/session-narration.js › stampToolRun`), counting from 1.
   *
   * ⚠ IT EXISTS BECAUSE THE RING EVICTS AND THIS SIDE CANNOT COUNT WHAT IT NEVER RECEIVED. The run row's
   * number used to be the frames the reader still held, so a run past the ring's bound counted DOWN as its
   * head went over the side (Samuel, 2026-10-10: 105 then lower). The ordinal rides the NEWEST frames,
   * which a ring never drops, so `max` over a group is exact however much of the head is missing.
   * ⚠ ABSENT IS ORDINARY — an older main stamps nothing and the reader falls back to its own frame count.
   */
  runCount?: number;
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
   * `inbound` only: WHO SENT IT, already resolved to words by main (#3081) —
   * `main/session-dispatch.js › authorLabel`: a member's display name, *"<person>'s agent"*, or its
   * own "A teammate" fallback.
   *
   * ⚠ A CAPTION AND PEER-TYPED, on `senderAgentId`'s precedent: nothing may gate, route or
   * authorize on it, and every face neutralizes it (a React text child on a `truncate` line).
   * ⚠ Absent is ordinary — render the anonymous sentence, never a blank and never an id.
   */
  senderName?: string;
  /**
   * `inbound` only: the operator's own account sent it, rather than a counterparty (#3081).
   *
   * ⚠ NOT A PRIVACY FLAG. The message is in the channel either way — which is why it does not
   * move the `lane` — and this only lets a face say "you" where it would otherwise name a member.
   * Only `true` counts; absent means a counterparty or not answered.
   */
  fromOperator?: boolean;
  /**
   * `inbound` only: WHAT KIND OF AUTHOR wrote it (2026-10-12) — `"user"` for a person, `"agent"`
   * for a machine.
   *
   * ⚠ **DERIVED SERVER-SIDE FROM THE AUTHOR'S CREDENTIAL**, which is what makes it the one
   * trustworthy human-vs-agent answer on this lane: `senderName` is already-resolved peer prose
   * and must never be sniffed for `"'s agent"` to recover this.
   * ⚠ **IT OUTRANKS {@link DesktopNarrationEntry.fromOperator} ON THE FACE.** That flag folds the
   * operator's own agents into "you" (ruling 2, 2026-09-25) — the right answer to *whose account
   * spoke* and the wrong one to *who wrote it*.
   * ⚠ Absent is UNKNOWN, not a person: an older main stamps nothing, and the face then paints the
   * neutral banner rather than a human's weight (INVARIANTS §11).
   */
  authorKind?: "user" | "agent";
  /**
   * `inbound` only, and only beside `authorKind: "agent"`: the OPERATOR'S NAME for the agent that
   * wrote it, joined server-side (`channels/types.ts › ChannelMessage.authorAgentName`).
   *
   * ⚠ A CAPTION AND PEER-TYPED, `senderName`'s rule exactly — neutralized at every render.
   * ⚠ Absent is ordinary (a human author, or a page that resolved no name): the face falls back
   * through `senderName` to the anonymous sentence, never to an id.
   */
  senderAgentName?: string;
  /**
   * `inbound` only, and only beside `authorKind: "agent"`: THAT AGENT'S IDENTITY COLOUR KEY
   * (`agent-01` … `agent-16`), joined server-side onto the message
   * (`channels/types.ts › ChannelMessage.authorAgentColor`) and passed through main untouched.
   *
   * ⚠ **A KEY, NEVER A COLOUR VALUE** — `shared/lib/agent-colors.ts › agentColorVar` is the only
   * place one becomes a `var()`, and main does not own the palette.
   * ⚠ **UNNARROWED ON THIS WIRE, ON PURPOSE**: a newer server may name a seventeenth key, and
   * `agentColorOrNull` is the ONE membership test — it runs where the item is built, so an unknown
   * key reads as "no colour" at one boundary rather than at two that can disagree.
   * ⚠ Absent is ordinary: a human author, an uncoloured agent, an older server.
   */
  senderColor?: string;
  /**
   * `post` only: the outbound consent gate is holding it until a human presses Post (INVARIANTS §6).
   * Only `true` counts; absent means sent. It never clears — the transcript row says it landed.
   */
  pending?: boolean;
}
