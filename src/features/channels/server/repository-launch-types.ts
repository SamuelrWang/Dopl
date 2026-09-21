/**
 * THE DIRECTIVE MAILBOX'S **ROW SHAPES** — what `channel_launch_directives` stores, what a
 * create supplies, and what a terminal decision writes.
 *
 * ⚠ **SPLIT OUT OF `repository-launch.ts` ON 2026-09-21, AT THE §1 CAP** (that file measured 554
 * of 500 once U9's runtime columns landed with their arguments). The seam is a real one and not
 * arithmetic: this file is the TABLE'S SHAPE and changes when a column does; that one is the
 * STATEMENTS and changes when a query does. It is the same split `types-launch.ts` took off
 * `types.ts` and `channel-artifact-types.ts` took off `channel-types.ts`, for the same reason —
 * a shape file at the cap cannot absorb the comment that explains its newest column, and this
 * table's columns are exactly the ones whose MEANING has to stay correctable (three posture
 * groups, two name columns, and now a requested/applied runtime pair).
 *
 * ⚠ **RE-EXPORTED FROM `repository-launch.ts`, VERBATIM, SO NO IMPORTER MOVED.**
 * `service-launch-dto.ts` and `service-launch.ts` still name that module.
 *
 * ⚠ **NO STATEMENT, NO CLIENT, NO FENCE LIVES HERE.** Every `operator_user_id` argument and
 * every gate stayed behind. This file decides nothing.
 */

/** One directive row. Column names, because this is what the database stores. */
export type LaunchDirectiveRow = {
  id: string;
  /** ⚠ `launch` on every row written before 2026-09-01 and on every row that
   *  names no kind — the column's DEFAULT, which is what made the widening a
   *  no-backfill change. */
  kind: string;
  workspace_id: string;
  channel_id: string;
  task_id: string | null;
  operator_user_id: string;
  goal: string | null;
  model: string | null;
  /**
   * The agent template this directive asks to run AS, resolved under the
   * ORCHESTRATOR's visibility at create time (2026-08-23).
   *
   * ⚠ `ON DELETE SET NULL` — read it BESIDE `template_name`, never alone. A null
   * id with a live name is a template that was DELETED after the directive was
   * filed, and the desktop must REFUSE (`no-template`) rather than launch a
   * blank agent; a null id with a null name is a directive that named none.
   * Spec E-4, and the column comment in
   * `20260823140000_channel_launch_directives_template.sql`.
   */
  template_id: string | null;
  /** The template's name, SNAPSHOTTED AT CREATE. ⚠ Never joined, never
   *  refreshed — it is the only signal that survives the FK's SET NULL. */
  template_name: string | null;
  /** THE COLOUR THIS LAUNCH ASKED FOR (2026-09-13, `20261005120000`) — one of
   *  `agent-01 … agent-16`, or NULL for "named none and the bank was empty".
   *  ⚠ A REQUEST AND NOT A RESERVATION: the only authority is
   *  `channel_sessions_channel_color_live_key`, so by claim time the key may be gone
   *  and the machine's own push resolves the collision. ⚠ NULL on every non-launch
   *  kind, and on every row written before the migration — the DTO reads it `?? null`
   *  for the stale-cache reason `service-launch-dto.ts` states. */
  color: string | null;
  agent_name: string | null; // ⚠ WHAT THE LAUNCH ASKED THE AGENT TO BE CALLED (`20261006120000`); `null` on a non-launch kind, and on a launch from a client older than that wave
  /**
   * WHICH AGENT an `end` / `rename` acts on — an INPUT (2026-09-01).
   *
   * ⚠ **NOT `agent_id`, WHICH IS THE OUTPUT A LAUNCH PRODUCED.** They are two
   * columns because they answer two questions — what this row aimed at, and what
   * it created — and a table that exists to be read back as a record of what was
   * asked cannot afford to lose the difference.
   */
  target_agent_id: string | null;
  /** The rename's new display name. ⚠ Non-null iff `kind = 'rename'`, and `''`
   *  is LEGAL there: it means CLEAR, back to `Agent #<id>`. */
  target_name: string | null;
  /**
   * THE POSTURE COLUMNS (2026-09-01, T24 and `set_agent_mode`).
   *
   * ⚠ **`start_*` / `chain` BELONG TO A LAUNCH, `target_*` TO A
   * `set_agent_mode`, AND THE COLUMN CHECK KEEPS THEM APART.** One names the
   * posture a NEW session starts on, the other the posture a RUNNING one moves
   * to; a row carrying both would be answered by whichever lane read it first.
   * ⚠ **EVERY ONE OF THEM IS A REQUEST AND NONE IS A GRANT.** The machine clamps
   * to the operator's own stored ceiling; nothing in this repository enforces
   * that and nothing can.
   * ⚠ `?` ON THE READ SIDE TOO — a payload cached against an older PostgREST
   * schema arrives without them, which is why the mapper defaults rather than
   * reads (INVARIANTS: the stale-cache field rule).
   */
  start_tool_mode?: string | null;
  start_message_mode?: string | null;
  chain?: boolean | null;
  target_tool_mode?: string | null;
  target_message_mode?: string | null;
  /**
   * **THE ECHO TRIO — what the machine SAYS it applied, after its clamp.**
   *
   * ⚠ **THE WRITER IS THE DECIDE AND NOTHING ELSE** (2026-09-01, T24's second
   * half): `main/launch-directive-wire.js › decideBody` puts the three values on
   * the `launched` body and `service-launch.ts › decideLaunchDirective` maps them
   * onto these columns. {@link LaunchDirectiveInsert} still has no field for
   * them, deliberately — see there.
   * ⚠ **NULL MEANS "NOT REPORTED".** Not "unclamped", and never the requested
   * value echoed back. It is the live value on every row written before this wave
   * AND on every row decided by a desktop older than it (INVARIANTS §13 — an
   * older peer is supported), which is why the render must keep saying `not
   * reported` rather than guessing (`channel-ops-launch.ts › postureFacts`).
   */
  applied_tool_mode?: string | null;
  applied_message_mode?: string | null;
  applied_chain?: boolean | null;
  applied_agent_name?: string | null; // ⚠ WHAT THE AGENT IS ACTUALLY CALLED, as the launching machine reported it (2026-09-15) — `-1` where the uniqueness rule fired
  /**
   * **THE MACHINE'S REPORT OF WHICH RUNTIME AND MODEL IT ACTUALLY STARTED ON**
   * (2026-09-21, U9; `20261017120000_channel_launch_directives_runtime.sql`).
   *
   * ⚠ **THE `applied` HALF OF A PAIR WHOSE OTHER HALF IS {@link LaunchDirectiveRow.runtime}**,
   * on the echo trio's argument and for a sharper reason: the two genuinely differ on the
   * ORDINARY launch, the one that asked for no runtime and got the channel's or the registry's.
   * An audit row carrying only the request cannot say what ran.
   * ⚠ `?` ON THE READ SIDE, like every column above, for the stale-cache rule (INVARIANTS): a
   * payload cached against an older PostgREST schema arrives without them.
   */
  applied_runtime?: string | null;
  applied_model?: string | null;
  /**
   * **THE SERVER'S RESOLVED POSTURE — the request clamped to the channel's
   * stored ceiling, decided at CREATION** (2026-09-02, A9 — G6/G7/G8).
   *
   * ⚠ **THREE GROUPS ON ONE TABLE AND THEY ARE NOT INTERCHANGEABLE**:
   * `start_*`/`chain` is what was ASKED, `applied_*` is what the MACHINE says it
   * did, and this is what the SERVER permitted. Reading one as another is the
   * defect the migration's section 3 exists to prevent.
   * ⚠ `?` for the same stale-cache reason as the two groups above.
   * ⚠ `resolved_model` is `null` for a model this server does not recognise, and
   * that is NOT a refusal — the requested value is carried to the machine
   * unchanged. See `lib/agent-models.ts › resolveAgentModelId`.
   */
  resolved_tool_mode?: string | null;
  resolved_message_mode?: string | null;
  resolved_chain?: boolean | null;
  resolved_model?: string | null;
  /**
   * **THE RUNTIME THE CALLER ASKED FOR — THE REQUEST, WRITTEN BY THE CREATE** (2026-09-21, U9).
   *
   * ⚠ **THERE IS NO `resolved_runtime`, AND THE ABSENCE IS THE DESIGN.** The posture's three
   * groups exist because the SERVER can clamp a posture against a column it holds. It holds no
   * runtime roster: the registry is `dopl-desktop-app/main/runtime/index.js`'s, on the
   * operator's machine, and a server-side "resolution" would be a guess about a list it cannot
   * see. So this lane has TWO groups — the request here, the machine's report in
   * {@link LaunchDirectiveRow.applied_runtime} — and nothing in between.
   * ⚠ `?` for the stale-cache reason the groups above state.
   */
  runtime?: string | null;
  status: string;
  refusal_reason: string | null;
  agent_id: string | null;
  claimed_at: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
  /**
   * THE CALLER'S IDEMPOTENCY KEY (2026-09-02, A10/G10).
   *
   * ⚠ `?` LIKE THE POSTURE COLUMNS ABOVE — a payload cached against an older
   * PostgREST schema arrives without the key at all, so every reader defaults
   * rather than reads (INVARIANTS: the stale-cache field rule).
   * ⚠ NOT ON THE DTO. It is the CALLER'S OWN string, echoed back to nobody: the
   * result reports WHETHER the row was already there (`existing`), which is the
   * fact a retry needs, not the key it just sent.
   */
  client_msg_id?: string | null;
};

/** What a create supplies. ⚠ `operator_user_id` is ABSENT ON PURPOSE — it is a
 *  separate argument so no caller can pass one inside an object it built from a
 *  request body. Same discipline as `SessionStateUpsert`. */
export type LaunchDirectiveInsert = {
  /** ⚠ OMITTED MEANS `launch`, by the column's DEFAULT — so the launch path did
   *  not have to learn a new field when the agent-management kinds landed. */
  kind?: "launch" | "end" | "rename" | "set_agent_mode";
  workspace_id: string;
  channel_id: string;
  task_id: string | null;
  goal: string | null;
  model: string | null;
  /**
   * ⚠ CALLER-SUPPLIED, UNLIKE `operator_user_id`, AND THE DIFFERENCE IS THE
   * WHOLE REASON ONE IS AN ARGUMENT AND THE OTHER IS A FIELD. An operator id
   * names WHOSE MACHINE runs the agent and is therefore the authorization story;
   * a template id names WHAT IT WEARS and grants nothing. It is still not raw
   * caller input: the service resolves the caller's `template` ref through the
   * agent-templates visibility matrix and puts the RESOLVED row's id here, so a
   * template the caller cannot see has no spelling that reaches this type.
   */
  template_id: string | null;
  /** The resolved row's name, snapshotted. ⚠ Written together with
   *  `template_id` or not at all — the pair is what makes a later deletion
   *  legible (E-4). */
  template_name: string | null;
  /** THE RESOLVED colour (2026-09-13) — what the caller named, or the FIRST FREE key
   *  when they named nothing.
   *  ⚠ **OPTIONAL SO THE THREE NON-LAUNCH KINDS DID NOT HAVE TO LEARN A FIELD**, the
   *  same courtesy `kind` itself takes above: an `end` / `rename` / `set_agent_mode`
   *  omits it and the column's NULL default is exactly right. ⚠ It is the SERVER's
   *  resolution and never raw caller input — `service-launch.ts` takes the free set
   *  from `repository-session-colors.ts` and 409s a taken key before reaching here. */
  color?: string | null;
  agent_name?: string | null; // ⚠ WHAT TO CALL THE NEW AGENT (2026-09-15) — OPTIONAL on `color`'s courtesy, refused on any kind but `launch` by the CHECK, safe on `template_id`'s rule (WHAT, never WHOSE)
  /**
   * **WHICH RUNTIME TO RUN THE NEW AGENT ON — CALLER-SUPPLIED AND GRANTING NOTHING**
   * (2026-09-21, U9).
   *
   * ⚠ SAFE ON `template_id`'s RULE: it names WHAT the session runs on, never WHOSE MACHINE runs
   * it. The authorization story is `operator_user_id`, a separate ARGUMENT precisely so no
   * caller can pass one inside an object built from a request body. ⚠ And picking a runtime
   * WIDENS NOTHING — `main/channel-runtime.js`'s header carries that argument in full: every
   * adapter re-derives the whole gate for itself and `main/runtime/contract.js` refuses to
   * register one that cannot.
   * ⚠ **VALIDATED AS A SHAPE HERE AND AS MEMBERSHIP ON THE MACHINE.** The roster is the
   * desktop's registry; an id this server has never heard of may be perfectly real on a newer
   * machine, and one that is real nowhere is REFUSED there (`no-sdk`) rather than swapped.
   * ⚠ Absent on every kind but `launch`; the column CHECK enforces that at rest.
   */
  runtime?: string | null;
  /**
   * ⚠ CALLER-SUPPLIED, LIKE `template_id` AND FOR THE SAME REASON THAT IS SAFE:
   * it names WHAT the verb acts on, never WHOSE MACHINE acts. The authorization
   * story is `operator_user_id`, which is a separate ARGUMENT precisely so no
   * caller can pass one inside an object built from a request body.
   * ⚠ Absent on a launch. The column CHECK requires it on every other kind, so
   * an end filed without one is refused AT REST rather than claimed and left
   * unanswerable.
   */
  target_agent_id?: string | null;
  /** The rename's new display name. ⚠ `''` is legal and means CLEAR; absent on
   *  every kind but `rename`, which the column CHECK enforces both ways. */
  target_name?: string | null;
  /**
   * THE POSTURE A LAUNCH **ASKS** ITS NEW SESSION TO START ON, and whether it may
   * launch workers (2026-09-01, T24).
   *
   * ⚠ CALLER-SUPPLIED, like `template_id` and safe for the same reason: they name
   * HOW MUCH ROOM the work gets, never WHOSE MACHINE runs it. The authorization
   * story is `operator_user_id`, which is a separate ARGUMENT precisely so no
   * caller can pass one inside an object built from a request body.
   * ⚠ **AND NEITHER GRANTS ANYTHING.** The operator's machine clamps both axes to
   * that operator's own stored ceiling and REFUSES a chain the channel forbids.
   * ⚠ Absent on every kind but `launch`; the column CHECK enforces that at rest.
   */
  start_tool_mode?: string | null;
  start_message_mode?: string | null;
  /**
   * ⚠ **A TRUE TRI-STATE, AND ALL THREE VALUES ARE HONOURED** (fixed
   * 2026-09-01). `true` ASKS IT ON and is REFUSED where the channel forbids it;
   * `false` ASKS IT OFF, is always granted, and WINS over a channel set to ON;
   * ABSENT/`null` did not ask and inherits the channel setting.
   * ⚠ This said `false` was indistinguishable from `null` on the desktop, which
   * was true while `main/launch-directive-wire.js › directiveFrom` flattened it.
   * It no longer does — see `types-launch.ts › LaunchDirective.chain`.
   */
  chain?: boolean | null;
  /**
   * THE POSTURE A `set_agent_mode` ASKS A **RUNNING** AGENT TO MOVE TO.
   *
   * ⚠ AT LEAST ONE OF THE TWO IS REQUIRED ON THAT KIND — the column CHECK, so a
   * directive asking for nothing is refused AT REST rather than claimed and left
   * unanswerable — and BOTH are absent on every other kind.
   * ⚠ **NOT MERGED WITH `start_*`.** A `set_agent_mode` answered by a launch's
   * fields is the confusion two column pairs exist to make impossible.
   */
  target_tool_mode?: string | null;
  target_message_mode?: string | null;
  expires_at: string;
  /**
   * THE CALLER'S IDEMPOTENCY KEY, VERBATIM (2026-09-02, A10/G10).
   *
   * ⚠ CALLER-SUPPLIED, like `template_id`, and safe for the same reason: it names
   * WHICH GESTURE this row is, never WHOSE MACHINE runs it. The authorization
   * story is `operator_user_id`, a separate ARGUMENT precisely so no caller can
   * pass one inside an object built from a request body — and that column is also
   * the SCOPE of the unique index, so one member's key cannot pre-claim another's
   * (`20260911120000_launch_direction_client_msg_id.sql`).
   * ⚠ ABSENT IS THE ORDINARY CASE and dedupes nothing: the index is partial.
   */
  client_msg_id?: string | null;
  /**
   * **THE SERVER'S RESOLVED POSTURE** (2026-09-02, A9 — G6/G7/G8), and it is the
   * one posture group on this table the CREATE writes.
   *
   * ⚠ **NOT CALLER-SUPPLIED, unlike `start_*` beside it.** `service-launch.ts`
   * computes these from the request AND `channels.agent_*_ceiling`; a caller that
   * could pass one would be writing its own clamp. The type cannot enforce that
   * (the object is built in one place), so the rule is stated where it is
   * computed and pinned by `service-launch-posture.test.ts`.
   * ⚠ **AND THEY ARE NOT `applied_*`.** That trio is the MACHINE's report and
   * still has no writer; this is what the SERVER permitted. See
   * `20260912120000_channel_delivery_verdict.sql` section 3, which states all
   * three groups together.
   */
  resolved_tool_mode?: string | null;
  resolved_message_mode?: string | null;
  resolved_chain?: boolean | null;
  resolved_model?: string | null;
  /**
   * ⚠ **THE ECHO TRIO IS DELIBERATELY NOT WRITABLE FROM HERE.** It is the
   * MACHINE's report of what it applied, so its writer is the DECIDE, not the
   * CREATE ({@link LaunchDecision} carries the three fields as of 2026-09-01). A
   * create that could stamp `applied_*` would let the requester write its own
   * confirmation, which is the one value on this row that must not come from the
   * asking side.
   */
};


/** What a terminal decision writes. */
export type LaunchDecision = {
  /** ⚠ `done` IS THE NON-LAUNCH KINDS' SUCCESS (2026-09-01) and carries no agent
   *  id: an end and a rename already NAME their target in the row. See
   *  `types-launch.ts › LaunchDirective.status` for why it is not `launched`. */
  status: "launched" | "done" | "refused";
  agent_id: string | null;
  refusal_reason: string | null;
  /**
   * **THE ECHO TRIO, AND THE DECIDE IS ITS ONLY WRITER** (2026-09-01).
   *
   * ⚠ **DELIBERATELY ABSENT FROM {@link LaunchDirectiveInsert} AND IT MUST STAY
   * SO.** These are the MACHINE's report of what it applied after its clamp, so
   * the writer is the DECIDE. A create that could stamp them would let the
   * requester write its own confirmation — the one value on this row that must
   * not come from the asking side.
   * ⚠ **`null` IS "NOT REPORTED", NOT "UNCLAMPED", AND NEVER THE REQUESTED VALUE
   * ECHOED BACK.** An older desktop sends no such fields
   * (`main/launch-directive-wire.js › decideBody` omits them), the service maps
   * absent to `null`, and the render says `not reported`.
   */
  applied_tool_mode: string | null;
  applied_message_mode: string | null;
  applied_chain: boolean | null;
  applied_agent_name: string | null; // the machine's own name for the launched agent; `null` on a non-launch kind, a refusal, and a desktop older than 2026-09-15
  /**
   * **WHICH RUNTIME AND MODEL THE MACHINE ACTUALLY STARTED ON** (2026-09-21, U9).
   *
   * ⚠ THE ECHO TRIO'S CONTRACT VERBATIM: written by the DECIDE and by nothing else, `null` on
   * `done` / `refused` so a retried decide cannot leave a stale runtime standing beside a
   * refusal, and `null` on a `launched` row from an older desktop meaning NOT REPORTED — never
   * "the default runtime".
   * ⚠ `applied_model: null` ALSO LEGITIMATELY MEANS "NO MODEL ARGUMENT AT ALL", i.e. the
   * resolved runtime's own default. That is what a cross-vendor model correctly becomes once
   * it is dropped rather than smuggled into another adapter.
   */
  applied_runtime: string | null;
  applied_model: string | null;
  decided_at: string;
};
