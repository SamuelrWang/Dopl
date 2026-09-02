/**
 * LAUNCH-OVER-MCP TYPES — an operator's external agent asking that operator's
 * OWN desktop to start an agent (Samuel's ruling, 2026-08-22).
 *
 * ⚠ SPLIT OUT OF `types.ts` at the 500-line cap; re-exported from there, so no
 * import path changed and there is no second path to a symbol.
 */

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

/**
 * ONE LAUNCH REQUEST from an operator's external agent to that operator's own
 * desktop.
 *
 * ⚠ **NOT A MESSAGE, AND DELIBERATELY OFF `channel_messages`** — INVARIANTS §5.
 * Two reasons, each sufficient: the LOOP BRAKE (an agent-authored addressed
 * message triggers a listener, so a "start an agent" message would be a
 * self-feeding cycle costing a consent decision per hop) and TRANSCRIPT PURITY
 * (a directive is not addressed to the counterparty, is refused more often than
 * not, and would leak the operator's orchestration into a room the other member
 * reads). The consequence to know: **a directive has no `seq` and can never end
 * an `await`.**
 *
 * ⚠ `status` is the REPORTED one, expiry already applied. It may differ from the
 * stored column — expiry is lazy and there is no cron.
 */
export type LaunchDirective = {
  id: string;
  /** Which verb this asks for. ⚠ `launch` on every row written before
   *  2026-09-01 and on every row that names no kind — the column's DEFAULT. */
  kind: LaunchDirectiveKind;
  /**
   * The operator whose machine this asks to launch — **always the reader's own
   * id, never anyone else's** (2026-08-23, F-284).
   *
   * ⚠ NOT A DISCLOSURE. Every read that produces this DTO is fenced on
   * `operator_user_id = ctx.userId` in `server/repository-launch.ts`, so this
   * field can only echo the caller back to itself.
   * ⚠ IT IS HERE FOR THE DESKTOP'S LOCAL RE-CHECK, which is the one consumer
   * that cannot take the fence on trust: `main/launch-directives.js › handle`
   * compares it against the signed-in user before acting, because the same
   * function also receives RAW realtime rows (`payload.new`), which arrive under
   * a subscription, not under a per-row auth answer. Without this field the
   * polled half compared against `''` and dropped every row.
   */
  operatorUserId: string;
  channelId: string;
  /** Thread the agent should work, or null. */
  threadId: string | null;
  goal: string | null;
  model: string | null;
  /**
   * The agent template this directive asks the machine to run AS — resolved
   * server-side, under the ORCHESTRATOR's visibility, before the row was written
   * (2026-08-23). `null` when none was named, **or when the template has since
   * been DELETED** (`ON DELETE SET NULL`).
   *
   * ⚠ **NEVER READ IT WITHOUT {@link LaunchDirective.templateName}.** Those two
   * nulls mean opposite things and the desktop acts on the difference: no
   * template requested → launch blank; template deleted → REFUSE `no-template`,
   * because the orchestrator picked an IDENTITY and an agent silently wearing
   * none is not noticed for several turns. Spec E-4.
   */
  templateId: string | null;
  /** The template's name as it stood AT CREATE. ⚠ A SNAPSHOT, deliberately not a
   *  join: it is the only thing that survives the FK's SET NULL, which is what
   *  makes a deletion distinguishable from "no template was asked for". */
  templateName: string | null;
  /**
   * ⚠ `done` IS THE NON-LAUNCH KINDS' SUCCESS AND `launched` IS THE LAUNCH'S,
   * and the split is not fussiness (2026-09-01). This row is read back by the
   * orchestrator that filed it and rendered into an agent-facing sentence;
   * putting the word "launched" on the record of an agent being STOPPED is the
   * one kind of wrong nothing downstream can detect. The column CHECK enforces
   * the pairing, so no reader has to ask which meaning it is looking at.
   */
  status: "pending" | "claimed" | "launched" | "done" | "refused" | "expired";
  /** Set iff `status` is `refused`. */
  refusalReason: LaunchRefusalReason | null;
  /**
   * WHICH AGENT AN `end` / `rename` ACTS ON — an INPUT, named by the caller at
   * create (2026-09-01). `null` on a launch.
   *
   * ⚠ **NEVER CONFLATE IT WITH {@link LaunchDirective.agentId}, WHICH IS THE
   * OUTPUT.** One says what this row aimed at, the other says what it produced;
   * a single field carrying both would make a table whose whole purpose is to be
   * read back as a record of what was asked unable to answer that question.
   */
  targetAgentId: string | null;
  /**
   * THE RENAME'S NEW DISPLAY NAME. Non-null iff `kind` is `rename`.
   *
   * ⚠ **`""` IS LEGAL AND MEANS "CLEAR IT"** — back to `Agent #<id>`, the same
   * gesture `sessions:rename` and the in-process `rename_agent` already take. So
   * `null` here is "this is not a rename", never "clear the name": a second
   * spelling for the clear would be a second way to say one thing.
   * ⚠ DISPLAY ONLY, ON ONE MACHINE. `main/agent-names.js` holds it in a local
   * `electron-store`; nothing resolves an agent by it, so a rename can never
   * re-point a running instruction.
   */
  targetName: string | null;
  /**
   * THE POSTURE A **LAUNCH** ASKED ITS NEW SESSION TO START ON (T24). `null` on
   * either axis is "not asked", which resolves to the operator's own stored
   * channel value — the pre-T24 behaviour byte for byte. `null` on every kind but
   * `launch`.
   *
   * ⚠ **SEPARATE FROM {@link LaunchDirective.targetToolMode} AND THEY MUST STAY
   * SO.** One names the posture a NEW session starts on, the other the posture a
   * RUNNING one moves to; merging them would let a `set_agent_mode` be answered
   * by a launch's fields on a row that carried both.
   * ⚠ **A REQUEST, NEVER A GRANT.** `main/launch-posture.js › resolveLaunch`
   * clamps both to the operator's ceiling before a spawn sees them.
   */
  startToolMode: LaunchToolMode | null;
  startMessageMode: LaunchMessageMode | null;
  /**
   * MAY THE LAUNCHED AGENT LAUNCH FURTHER AGENTS? **A TRI-STATE, and the third
   * value is load-bearing**: `true` asks for it, `false` asks for it off, `null`
   * did not ask and inherits the channel setting silently.
   *
   * ⚠ **REFUSED RATHER THAN CLAMPED WHEN THE CHANNEL FORBIDS IT**, which is the
   * one asymmetry with the posture pair above (`launch-posture.js ›
   * resolveChain`). A clamped posture still does the asked-for work under more
   * supervision; a clamped chain produces an agent that hits a bound it was told
   * it did not have, mid-run, after workers were already promised.
   */
  chain: boolean | null;
  /**
   * THE POSTURE A `set_agent_mode` ASKED A **RUNNING** AGENT TO MOVE TO. `null`
   * on either axis means that axis was not requested, which is ordinary — a
   * directive may move one and leave the other. At least one is non-null on a
   * `set_agent_mode` row (the column CHECK), and both are `null` on every other
   * kind.
   */
  targetToolMode: LaunchToolMode | null;
  targetMessageMode: LaunchMessageMode | null;
  /**
   * **THE ECHO — WHAT THE MACHINE SAYS IT ACTUALLY APPLIED, after its clamp.**
   *
   * ⚠ **`null` MEANS "NOT REPORTED". IT DOES NOT MEAN "UNCLAMPED" AND IT IS NEVER
   * THE REQUESTED VALUE ECHOED BACK.** No writer exists yet — the desktop's
   * `decideBody` has no field for these — so all three are `null` on every live
   * row, and a render that read `null` as agreement would tell an orchestrator
   * its posture landed on the strength of a column nobody filled in. It would
   * then size the work for room the agent may not have. The one statement of that
   * render is `packages/mcp-server/src/tools/channel-ops-launch.ts › postureLine`.
   * ⚠ `appliedChain: null` IS NOT `false` either — reading it as "no chaining"
   * is wrong in the direction that makes an orchestrator do the work itself for
   * no reason.
   */
  appliedToolMode: LaunchToolMode | null;
  appliedMessageMode: LaunchMessageMode | null;
  appliedChain: boolean | null;
  /** The agent instance the desktop started. Set iff `status` is `launched` —
   *  it is what the requester types as `@<agentId>` to direct it. */
  agentId: string | null;
  claimedAt: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
};
