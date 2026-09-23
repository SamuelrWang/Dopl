/**
 * ONE LINE OF AN AGENT'S WORK — the narration wire shape, split from `./spa-bridge-shapes` at the
 * 500-line cap. Re-exported from `./spa-bridge`, the import path of record.
 */

/**
 * ONE LINE OF AN AGENT'S WORK — the wire shape
 * `dopl-desktop-app/main/session-narration.js › entryFor` emits.
 *
 * ⚠ EVERY FIELD IS ALREADY-SUMMARIZED DISPLAY TEXT, bounded on the main side.
 * `inputFull` deliberately never enters a ring entry: it is unbounded by
 * construction (it can carry an entire file), and this feed crosses to a
 * renderer.
 */
export interface DesktopNarrationEntry {
  /** Epoch ms. */
  at: number;
  /**
   * ⚠ THE VOCABULARY IS CLOSED, AND THREE KINDS JOINED IT ON 2026-08-22. Read it as FOUR
   * AUDIENCES rather than four stylings — collapsing any pair makes the view claim something
   * was shared when it was not, or the reverse:
   *
   * - `thinking`      the model's own reasoning for this step. Addressed to nobody. **Collapse
   *                   it by default** — it is the longest and least load-bearing kind.
   * - `assistant`     the agent narrating a PUBLIC turn (one worked from a channel message).
   * - `operator`      the OPERATOR spoke to this agent 1:1, over `sessions.message`. It was
   *                   never posted anywhere and nobody else can see it. `text` is what they
   *                   TYPED, not the framed prompt the model received. Carries
   *                   `lane: "operator"`.
   * - `private`       the agent's answer to a PRIVATE turn — the turn's final text, for the
   *                   operator alone; `lane: "private"`. ⚠ Never posted: while a private turn
   *                   is active main withdraws the auto-send widening, so a post would have to
   *                   pass the outbound consent gate first (INVARIANTS §11).
   * - `tool`          a tool call, with its RAW name and a bounded input summary.
   * - `result`        how that call came back.
   * - `post`          the agent SENT a message into the channel or thread; `lane: "channel"`.
   *                   ⚠ This one LEFT THE MACHINE — the other member has it. A `post` inside a
   *                   private turn is still a `post`, deliberately: it is the one thing that
   *                   did not stay private, and re-labelling it would hide that. Treat it as a
   *                   LOCAL ECHO and dedupe it against the real transcript row once that
   *                   exists; it covers the window before the transcript has loaded.
   * - `status`        a phase move worth a line (paused, ended, waiting on a permission).
   * - `directed`      **ANOTHER OF THIS OPERATOR'S AGENTS spoke to this one, 1:1** (2026-08-31,
   *                   the private direct lane). It arrives on the same `steer` an operator turn
   *                   does and is NOT one — rendering it as `operator` puts words in the
   *                   operator's mouth on their own screen, wearing their avatar. Carries
   *                   `lane: "directed"`.
   * - `directed-reply` this agent's ANSWER to that direction — `retagDirected` narrows a
   *                   `private` line, so it is private traffic with one extra fact attached:
   *                   whose question it answers. Carries `lane: "directed"` too.
   *
   * ⚠ RENDER AN UNKNOWN KIND AS NOTHING, never as a fallback bubble: main's vocabulary can
   * gain a member before this build knows it, and a mystery line in a work lane is worse than
   * a missing one.
   *
   * ⚠ **NEITHER DIRECTED KIND CARRIES THE COUNTERPARTY'S IDENTITY, AND NOTHING UPSTREAM HOLDS
   * ONE** (measured 2026-08-31 — F-376). `channel_agent_directions.agent_id` is the ADDRESSEE;
   * the row has no sender column, `DirectionCreateSchema` has no sender field, and
   * `agent-direction-wire.js › directionFrom` therefore has nothing to carry. So the SPA's
   * face names the RELATION ("your agent") rather than an agent, and the name slot stays empty
   * until a sender identity exists end to end.
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
   * ⚠ WHO CAN SEE THIS LINE — **and it OUTRANKS `kind`** (2026-08-22). Audience is a fact, not
   * something a renderer should infer from a word:
   * - `"operator"` the operator said it, 1:1. Private.
   * - `"private"`  the agent said it, 1:1, to the operator. Private.
   * - `"channel"`  it LEFT THE MACHINE — the other member has it.
   * - `"directed"` **the private direct lane** (2026-08-31): one of the operator's OTHER agents
   *   said it, or this agent answered it. Private, like `operator`/`private`, and marked apart
   *   from them because the VOICE is neither the operator's nor an unprompted turn.
   *
   * ⚠ **`"directed"` NAMES THE LANE, NOT THE DIRECTION** — inbound and outbound share it, and
   * only `kind` (`directed` vs `directed-reply`) says which. That does not weaken the rule
   * below: the two kinds differ in SPEAKER, never in AUDIENCE, so a kind rename can still not
   * change who could see the line. `channels/components/agent-stream-model.ts › frameLane` is the one
   * reader that splits them.
   *
   * A kind can be renamed, aliased or added; this cannot drift into meaning something else, so
   * a future rename can neither leak a private reply into a public-looking face nor dress a
   * real channel post as private (which would hide that it was shared).
   * ⚠ **ABSENT on the narration kinds** (`thinking` / `assistant` / `tool` / `result` /
   * `status`) — deliberately: they went nowhere and have no audience to be wrong about. Absent
   * is not `"channel"`.
   */
  lane?: "operator" | "private" | "channel" | "directed";
  /** On `tool` and `result` — what joins a result to the call it answers. */
  toolUseId?: string;
  /** The RAW tool name on a `tool` entry; the renderer shortens it. */
  tool?: string;
  /** `false` only on a `result` that failed. */
  ok?: boolean;
  /**
   * The line itself, already bounded main-side, and the bound is THREE numbers because they are
   * three kinds of string (`main/session-narration.js`): **300 for a CAPTION** (a tool's input
   * or result summary — the input already 140 before that — and the status lines), **1000 for a
   * `post`** (a MESSAGE, but one the transcript is the real record of, and the UI dedupes it),
   * and **8000 for the agent's own PROSE** — `assistant` / `thinking` / the operator's 1:1 text,
   * where this ring is the only copy that exists anywhere.
   * ⚠ **8000 IS THE UI's OWN EXPANDED CEILING** (`channels/components/agent-stream-log.tsx ›
   * EXPANDED_CHARS`), and that is the point of the number: prose was capped at 300 until
   * 2026-08-27, so "Show more" raised a display clamp over a string main had already cut
   * mid-word, with nothing saying so. **A cap below what the UI will show is a silent lie.**
   * (2000 until 2026-08-31; it is `main/session-directed.js › REPLY_CAP`'s 8000 now, so the
   * panel never shows the operator LESS of a private reply than the MCP mailbox carries away.)
   * ⚠ **Truncate further in the UI** — these caps exist so the IPC frame stays small (the ring
   * is 200 deep and multiplied by the concurrent-session ceiling), not because they are display
   * lengths.
   */
  text?: string;
  /**
   * ⚠ ON THE PROSE KINDS ONLY — **main CUT this line at its own cap, and the tail exists
   * nowhere** (2026-08-31, Samuel's cutoff report). The prose cap deliberately EQUALS the UI's
   * expanded ceiling, so the renderer's own `length > EXPANDED_CHARS` clip check is false on
   * every line main shortened — this flag is the only way the reader can ever be told, and for
   * prose there is no second copy to go read (INVARIANTS §9: a clipped read says so).
   *
   * ⚠ **ABSENT MEANS "ARRIVED WHOLE", NOT "UNKNOWN"** — the same discipline `pending` states:
   * only an explicit `true` counts, every main that predates the field emits nothing, and a
   * renderer must treat `truncated !== true` as an uncut line.
   */
  truncated?: boolean;
  /**
   * ⚠ ON `directed` ONLY — **WHICH of this operator's agents filed the direction** (F-376a,
   * 2026-08-31). An 8-char agent instance id (`main/agent-id.js › AGENT_ID_RE`), shape-gated
   * twice on the way here, which the renderer resolves to a display name exactly as it does for
   * any other agent id on this surface.
   *
   * 🔒 **IT IS A CAPTION AND IT IS UNVERIFIED. NOTHING MAY GATE, ROUTE, FILTER OR AUTHORIZE ON
   * IT.** The server derives it from the third segment of `X-Dopl-Session-Id` — a documented
   * NON-authorization header (INVARIANTS §10: *"nothing may be GRANTED on it"*) that anything
   * holding the operator's device token can set. It is exactly as trustworthy as
   * `metadata.session_id`: good enough to tell two of your OWN agents apart on your OWN screen,
   * worth nothing as a claim. The fence on this lane is `operatorUserId`, compared in
   * `main/session-reopen.js › messageByTask`, and it is untouched by this field's presence.
   *
   * ⚠ **ABSENT MEANS "AN EXTERNAL ORCHESTRATOR", WHICH IS THE ORDINARY CASE** — Claude Desktop,
   * Claude Code and every other MCP client that is not a spawned desktop session sends no
   * session stamp and has no agent id to send. It is ALSO what an older main and an older server
   * emit, and both read correctly as the same thing. **The fallback is the sentence this surface
   * showed before the field existed — "your agent" — never a placeholder id and never blank.**
   */
  senderAgentId?: string;
  /**
   * ⚠ ON `post` ONLY — **this post has NOT left the machine** (2026-08-25, Samuel's
   * outbound-review ruling). The outbound consent gate is holding it and a human has to press
   * Post before it goes (INVARIANTS §6). `session-io.js › sdkRenderEvents` stamps it from
   * `willGatePost` at the moment the agent CALLS the tool, which is long before any row settles.
   *
   * ⚠ **ABSENT MEANS "NOT GATED", NOT "UNKNOWN"** — every main that predates this field emits a
   * `post` frame only for a post it was free to send, so an older build reads correctly as
   * `undefined`. A renderer must therefore treat `pending !== true` as SENT, never as a third
   * state.
   *
   * ⚠ IT IS NOT A STATUS AND IT NEVER CLEARS. The ring entry is written once and main does not
   * revisit it, so a frame stays `pending` after the operator posts — the SERVER's record is what
   * says it landed (`agent-stream-model.ts` dedupes a pending frame against the real transcript
   * row, exactly as it does an ordinary echo).
   */
  pending?: boolean;
}
