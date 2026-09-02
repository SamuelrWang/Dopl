/**
 * THE TWO PRIVATE AGENT LANES' CLOSED SETS — the refusal vocabularies, the
 * directive verbs and the two posture axes, stated ONCE for all three trees.
 *
 * ⚠ **MOVED HERE ON 2026-09-02, VERBATIM.** Every union below was declared twice
 * — `src/features/channels/types-{direction,launch}.ts` and
 * `packages/dopl-client/src/{direction,launch}-types.ts` — with no script
 * between any pair. Both files now RE-EXPORT from here under their existing
 * names, so no consumer import changes and the two trees can no longer disagree.
 *
 * ⚠ **THE DATABASE STILL STATES EVERY ONE OF THEM A THIRD TIME** as a column
 * `CHECK`, and no TypeScript reaches a CHECK. That is why each docblock below
 * keeps its "a sixth reason is a schema change in both trees" sentence: the
 * compiler now holds the TS halves together and nothing holds SQL.
 *
 * ⚠ **TYPE-ONLY** (see `index.ts`) — and for {@link LaunchToolMode} /
 * {@link LaunchMessageMode} that matters twice over: the ORDER of their members
 * is part of the contract, and the arrays the desktop clamps over live in
 * `main/launch-directive-wire.js`, which cannot import this package at all.
 */

/**
 * WHY A DESKTOP SAID NO TO A DIRECTION — **exactly five words, and the closed set
 * is the wire contract both trees code against.**
 *
 * ⚠ **A KEY, NEVER A SENTENCE**, for {@link LaunchRefusalReason}'s reason: prose
 * on the wire needs a desktop release to reword, and desktop-authored text
 * rendered into an MCP result is text nobody neutralized.
 *
 *  - `no-session` — **the one that actually happens.** No live session on that
 *                   machine with that `(channel, thread, agent)` key: the agent
 *                   ended, was deleted, or was never there. It is the honest
 *                   answer and the only authoritative one, because whether an
 *                   agent is alive is knowable only on the machine running it.
 *  - `auth-hold`  — the desktop is signed out or its credential is held, so the
 *                   session has no query to feed and the words would vanish.
 *  - `busy`       — the machine declined for now. Genuinely temporary.
 *  - `blocked`    — the desktop is below the version floor and is refusing every
 *                   turn-starting op until it updates.
 *  - `no-bridge`  — **the operator's direct-over-MCP toggle is OFF.** Kept in the
 *                   set for the same reason the launch lane keeps it, and written
 *                   by nothing today: a machine that has not opted in ignores the
 *                   row SILENTLY, because a refusal would itself admit the machine
 *                   is listening. It exists so an older or future producer has a
 *                   word, and so the reader has a sentence if one ever arrives.
 *
 * ⚠ A SIXTH REASON IS A SCHEMA CHANGE IN BOTH TREES, deliberately: the column
 * carries the same CHECK, so an unknown value cannot be stored and cannot reach a
 * render as raw text.
 */
export type DirectionRefusalReason =
  | "no-session"
  | "auth-hold"
  | "busy"
  | "blocked"
  | "no-bridge";

/**
 * WHY A DESKTOP SAID NO TO A LAUNCH — **exactly six words, and the closed set is
 * the wire contract both trees code against** (2026-08-22).
 *
 * ⚠ **A KEY, NEVER A SENTENCE.** The readable line is written by the reader
 * (`packages/mcp-server/src/tools/channel-ops-launch.ts`), for the same reason
 * {@link SessionDetailKey} splits that way: prose on the wire is prose that needs
 * a desktop release to reword, and desktop-authored text rendered into an MCP
 * result is text nobody neutralized.
 *
 *  - `cap`             — already at the machine's concurrent-agent ceiling.
 *  - `busy`            — the machine is under load and declined for now.
 *  - `no-sdk`          — no agent runtime available on that machine.
 *  - `auth-hold`       — the desktop is signed out or its credential is held.
 *  - `no-bridge`       — **the operator's launch-over-MCP toggle is OFF.** This
 *                        is Samuel's consent mechanism, so this reason is a
 *                        CHOICE and the render must not read as a fault.
 *  - `no-counterparty` — nothing to work with in that channel.
 *  - `no-template`     — ⚠ THE SEVENTH, 2026-08-22 (agent templates). The
 *                        directive named a TEMPLATE and the operator's machine
 *                        could not resolve it: DELETED, or not visible to the
 *                        OPERATOR even though it was visible to the orchestrator
 *                        that named it. Those are ONE answer on purpose — the
 *                        resolve endpoint is 404-never-403 so the difference is
 *                        not observable, and a render that guessed would rebuild
 *                        the oracle. The next action is to re-check the template
 *                        list as the operator, not to re-issue.
 *
 * ⚠ AN EIGHTH REASON IS A SCHEMA CHANGE IN BOTH TREES, deliberately: the column
 * carries the same CHECK, so an unknown value cannot be stored and cannot reach
 * a render as raw text.
 * ⚠ `no-template` IS FULLY LANDED SINCE 2026-08-23. It was half-landed for a day
 * — this list at seven while the column CHECK was at six — and the note here said
 * so, because a producer shipped in that window would have passed zod and been
 * refused AT REST. Both halves are in now:
 * `20260823140000_channel_launch_directives_template.sql` widens the CHECK
 * (⚠ WRITTEN — applied is a measurement, INVARIANTS §12) in the same wave as the
 * producer, `main/launch-directives.js › spawn`, which resolves the directive's
 * template at CLAIM time under the OPERATOR's credential.
 *
 * ⚠ `template-approval` IS NOT A MEMBER AND MUST NOT BECOME ONE. It is an
 * IPC-only word: the desktop answers it to its OWN renderer when a FOREIGN
 * template's first run on that machine needs one human click. There is no human
 * at the keyboard on this lane, and `orchestratorLaunchEnabled` already stands in
 * for the click here (the toggle IS the standing consent), so a directive can
 * never produce it and the column must never be able to store it.
 */
export type LaunchRefusalReason =
  | "cap"
  | "busy"
  | "no-sdk"
  | "auth-hold"
  | "no-bridge"
  | "no-counterparty"
  | "no-template"
  // ⚠ THE EIGHTH AND NINTH, 2026-09-01 (external end / rename — Samuel's "Dopl
  // MCP need to be able to do all that stuff"). Both belong to the NON-LAUNCH
  // kinds and neither can be produced by a launch, which is why the sentences in
  // `channel-ops-launch.ts` may name a target agent without hedging.
  //  - `no-session` — no LIVE session of this operator's carries that agent id on
  //    the machine that claimed the row. ⚠ NOT AN ERROR: an agent that finished
  //    is the ordinary cause, and it is the same spelling
  //    `service-directions.ts › DIRECTION_REFUSAL_REASONS` already uses for the
  //    same fact, deliberately — two vocabularies disagreeing about how to say
  //    "that agent is not here" is how a render learns to guess.
  //  - `bad-name`   — the rename's string was refused by the machine's own
  //    sanitizer (`main/agent-names.js › sanitizeName`). The column CHECK admits
  //    only names that sanitizer would take, so this is reachable mainly when the
  //    two builds disagree — and it exists BECAUSE the alternative is arriving as
  //    `no-bridge`, which reads to an orchestrator as the operator having turned
  //    the lane off.
  | "no-session"
  // ⚠ THE TENTH, 2026-09-02, and it is a LAUNCH word — the only new one that is.
  // A directive that asked to CHAIN in a channel where the operator has not
  // enabled it used to answer `no-bridge`, which is what this machine says when
  // it is not watching that channel at all: opposite instructions, one word. This
  // one means the channel is right and ONE NAMED SETTING is off
  // (`main/launch-posture.js › CHAIN_SETTING` = `channelAgentChain`), so a caller
  // can re-issue without `chain` or ask for one toggle instead of hunting for
  // another route. ⚠ Its CHECK lands in the SAME wave
  // (`20260910120000_channel_launch_directives_posture.sql` §3A).
  | "no-chain"
  | "bad-name";

/**
 * WHICH VERB A DIRECTIVE ASKS FOR (2026-09-01).
 *
 * ⚠ **THE MAILBOX WAS ALWAYS A MAILBOX; ONLY THE LETTER WAS FIXED.** `launch`
 * is the default and every pre-2026-09-01 row is one, so widening the table cost
 * a `DEFAULT` and no backfill (`20260907120000_channel_launch_directives_kind
 * .sql`).
 *
 * ⚠ **THE KINDS DO NOT SHARE A CONSENT GATE, AND THAT IS THE ONE THING TO CARRY
 * AWAY.** `launch` is gated by the per-machine `orchestratorLaunchEnabled`
 * toggle ("THE TOGGLE IS THE CONSENT", INVARIANTS §6). `end` and `rename` are
 * NOT: they are the STOP verb and the DISPLAY verb, they widen nothing, and
 * `main/agent-self-ops.js`'s header carries the whole argument for why the
 * in-process twins of these two verbs already ride ungated on the same subjects.
 *
 * ⚠ **`set_agent_mode` IS THE FOURTH (2026-09-01, T24's sibling) AND IT DOES NOT
 * JOIN THE UNGATED PAIR.** It is the ONE non-launch kind still behind the
 * machine's launch-consent toggle, and the desktop states that as data rather
 * than as a condition (`main/launch-directive-wire.js ›
 * KINDS_NEEDING_LAUNCH_CONSENT`). The reason is the same one that let the other
 * two out: the toggle gates LOCAL COMPUTE BEING SPENT, and a posture is the only
 * one of the three that spends any — Axis A at `bypass` pre-approves work tools
 * on hardware the operator pays for. Reading the three non-launch kinds as one
 * class hands an un-armed machine the widest half of the launch lane.
 */
export type LaunchDirectiveKind = "launch" | "end" | "rename" | "set_agent_mode";

/**
 * THE TWO PERMISSION AXES, **ORDERED NARROWEST FIRST** — and the ORDER IS PART OF
 * THE CONTRACT, not presentation (2026-09-01, T24).
 *
 * ⚠ **THE CLAMP IS AN INDEX COMPARISON OVER THESE SEQUENCES**
 * (`dopl-desktop-app/main/launch-posture.js › narrowTo`, over
 * `main/launch-directive-wire.js › TOOL_MODES` / `MESSAGE_MODES`). Re-ordering
 * either union — or the array in `schema-launch.ts` that mirrors it — silently
 * INVERTS the bound, and nothing type-checks that: a union is a set to the
 * compiler and a sequence to that function.
 *
 * ⚠ **A DIRECTIVE CARRYING ONE OF THESE ASKS. IT NEVER WIDENS.** The value is
 * clamped to the operator's own stored channel posture before it reaches a spawn
 * or a live session. Nothing in this feature enforces that and nothing can — the
 * ceiling is an `electron-store` record no server sees — so every sentence built
 * from these values must say "asked for", never "set".
 */
export type LaunchToolMode = "manual" | "accept_edits" | "auto" | "bypass";

export type LaunchMessageMode =
  | "ask"
  | "auto_inbound"
  | "auto_outbound"
  | "auto_both";

