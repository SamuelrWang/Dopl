/**
 * LAUNCH-OVER-MCP TYPES — an operator's external agent asking that operator's
 * OWN desktop to start an agent (Samuel's ruling, 2026-08-22).
 *
 * ⚠ SPLIT OUT OF `types.ts` at the 500-line cap; re-exported from there, so no
 * import path changed and there is no second path to a symbol.
 *
 * ⚠ **THE FOUR CLOSED SETS — the refusal vocabulary, the directive verb and the
 * TWO POSTURE AXES — ARE DECLARED IN `@dopl/contracts › directives.ts` AND
 * RE-EXPORTED HERE** (2026-09-02, v2 slice A13). All four had twins in
 * `packages/dopl-client/src/launch-types.ts` with no script between them. ⚠ The
 * ORDER of {@link LaunchToolMode} / {@link LaunchMessageMode} is part of the
 * contract (the desktop's clamp is an index comparison), and the arrays it
 * compares over live in `main/launch-directive-wire.js`, which imports neither
 * tree — so the ordering argument stays stated at the declaration.
 */
import type {
  AgentColorKey,
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchToolMode,
  LaunchMessageMode,
} from "@dopl/contracts";

export type {
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchToolMode,
  LaunchMessageMode,
};

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
   * **THE RUNTIME THIS LAUNCH ASKED FOR — THE REQUEST, AND ONLY THE REQUEST** (2026-09-21, U9).
   *
   * ⚠ **`null` IS "DID NOT ASK", WHICH IS NOT "CLAUDE" AND IS EMPHATICALLY NOT "CODEX".** It
   * means the documented default chain applies on the machine — the channel's stored runtime,
   * then the registry default — and the machine reports what that came to in
   * {@link LaunchDirective.appliedRuntime}. A reader that filled this in from
   * {@link LaunchDirective.model} would be re-creating the exact defect U9 closes.
   * ⚠ **READ IT BESIDE `appliedRuntime`, NEVER INSTEAD OF IT.** This one explains a REFUSAL
   * (an explicit runtime this machine cannot start answers `no-sdk` and never launches another
   * vendor); that one explains a LAUNCH.
   * ⚠ `null` on every kind but `launch`, which the column CHECK enforces at rest.
   */
  runtime: string | null;
  /**
   * The agent identity this directive asks the machine to run AS — resolved
   * server-side, under the ORCHESTRATOR's visibility, before the row was written
   * (2026-08-23). `null` when none was named, **or when the identity has since
   * been DELETED** (`ON DELETE SET NULL`).
   *
   * ⚠ **NEVER READ IT WITHOUT {@link LaunchDirective.identityName}.** Those two
   * nulls mean opposite things and the desktop acts on the difference: no
   * identity requested → launch blank; identity deleted → REFUSE `no-identity`,
   * because the orchestrator picked an IDENTITY and an agent silently wearing
   * none is not noticed for several turns. Spec E-4.
   */
  identityId: string | null;
  /** The identity's name as it stood AT CREATE. ⚠ A SNAPSHOT, deliberately not a
   *  join: it is the only thing that survives the FK's SET NULL, which is what
   *  makes a deletion distinguishable from "no identity was asked for". */
  identityName: string | null;
  /**
   * **THE COLOUR THIS LAUNCH ASKED THE NEW AGENT TO WEAR** (2026-09-13,
   * `20261005120000`).
   *
   * ⚠ **A REQUEST, NEVER A RESERVATION**, and the difference is visible to the
   * machine: by claim time another member's agent may hold the key, and the push that
   * follows the spawn resolves the collision to the next free one
   * (`server/session-colors.ts`). So the desktop applies this and does not verify it.
   * ⚠ `null` = the caller named none AND the bank was empty at create time; a caller
   * who names nothing ordinarily gets the FIRST FREE key here, not `null`.
   */
  color: AgentColorKey | null;
  /**
   * **WHAT THE NEW AGENT IS CALLED** (Samuel, 2026-09-15, verbatim: *"if agents are spinning
   * up agents, they should be the ones that are naming the agent. Shouldn't be a nameless
   * agent."*).
   *
   * ⚠ **REQUIRED BY THE TOOL, NULLABLE HERE, AND THE ASYMMETRY IS §13.** `schema-launch.ts ›
   * LaunchCreateSchema.agentName` refuses a launch without one and
   * `packages/mcp-server › channel-ops-launch.ts` is where a caller is told what to pass. An
   * OLDER `@dopl/mcp-server` build in the field files rows with no name at all, and those rows
   * must still land — so the type admits `null` and the CLAIMING MACHINE supplies the face
   * (`main/launch-directive-spawn.js`, `New Agent`).
   * ⚠ **IT IS AN INPUT, NOT AN ECHO.** It is what was ASKED for; the desktop's `sanitizeName`
   * is the authority on what is actually stored, and it refuses rather than strips.
   * ⚠ Absent on every kind but `launch`, which the column CHECK enforces at rest.
   */
  agentName: string | null;
  /**
   * **WHAT THE AGENT IS ACTUALLY CALLED** — the machine's own answer (Samuel, 2026-09-15).
   *
   * ⚠ **READ IT, NOT {@link LaunchDirective.agentName}, WHEN YOU MEAN "how do I address this
   * agent".** That field is the REQUEST; this is what was stored, and the two differ whenever the
   * uniqueness rule fired: *"If a user launches an agent with the same name, let's just have the
   * name auto-renamed to that name and -1."* An orchestrator that asked for "Coder", got
   * `Coder-1`, and went on tagging `@coder` would reach the other agent.
   * ⚠ `null` IS "NOT REPORTED" — a non-launch kind, a refusal, or a desktop older than the wave —
   * and never "unnamed".
   */
  appliedAgentName: string | null;
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
   * MAY THE LAUNCHED AGENT LAUNCH FURTHER AGENTS? **A TRUE TRI-STATE, AND ALL
   * THREE VALUES ARE LOAD-BEARING** (fixed 2026-09-01):
   *   `true`  — ASK IT ON. Granted only if the channel allows it; denied is a
   *             REFUSAL, not a clamp (below).
   *   `false` — ASK IT OFF. **Always granted, and it WINS over a channel set to
   *             ON.** It is strictly narrower than anything that setting would
   *             have given, so there is nothing for the operator's setting to
   *             protect, and NARROWING IS NEVER REFUSED.
   *   `null`  — DID NOT ASK. Inherits the channel setting silently, which is what
   *             every launch did before T24.
   *
   * ⚠ **THIS DOCBLOCK SAID `false` WAS INDISTINGUISHABLE FROM `null` UNTIL
   * 2026-09-01, AND IT WAS TRUE WHEN WRITTEN.** `main/launch-directive-wire.js ›
   * directiveFrom` narrowed the column as `r.chain === true || r.chain === 'true'
   * ? true : null` — a `false` arrived as "did not ask" and inherited a channel
   * setting that may be ON — and `main/launch-posture.js › resolveChain` had the
   * matching defect on the other side. Both are fixed and
   * `dopl-desktop-app/test/launch-chain.test.mjs` drives the two halves TOGETHER,
   * because testing them separately is what let each hide the other.
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
   * THE REQUESTED VALUE ECHOED BACK.** The writer landed on 2026-09-01 — the
   * desktop's `decideBody` puts the three on the `launched` body and
   * `service-launch.ts › decideLaunchDirective` maps them onto the columns — but
   * `null` is still the live value on every row written before that wave AND on
   * every row decided by a desktop older than it (INVARIANTS §13: an older peer
   * is supported, so a machine that reports nothing must still be able to
   * decide). A render that read `null` as agreement would tell an orchestrator
   * its posture landed on the strength of a column nobody filled in, and it would
   * then size the work for room the agent may not have. The one statement of that
   * render is `packages/mcp-server/src/tools/channel-ops-launch.ts › postureFacts`.
   * ⚠ `appliedChain: null` IS NOT `false` either — reading it as "no chaining"
   * is wrong in the direction that makes an orchestrator do the work itself for
   * no reason.
   */
  appliedToolMode: LaunchToolMode | null;
  appliedMessageMode: LaunchMessageMode | null;
  appliedChain: boolean | null;
  /**
   * **THE RUNTIME AND MODEL THE MACHINE ACTUALLY STARTED THIS SESSION ON** (2026-09-21, U9).
   *
   * ⚠ **THIS IS THE FIELD AN AUDIT READS, AND {@link LaunchDirective.runtime} IS THE ONE IT
   * READS BESIDE IT.** Requested and applied are two facts: they agree on an explicit,
   * honoured request; they differ on every launch that asked for nothing (the ordinary case,
   * where the channel or the registry default decided); and a request that could NOT be
   * honoured produces no `launched` row at all, because this lane refuses rather than
   * substituting a vendor.
   * ⚠ **`null` MEANS "NOT REPORTED"** — an older desktop, or a non-launch kind — and never
   * "Claude". The echo trio's rule, for the echo trio's reason: a render that read `null` as
   * the default runtime would tell an orchestrator which vendor ran on the strength of a
   * column nobody filled in.
   * ⚠ **`appliedModel` is what the MACHINE launched with inside the resolved runtime** (the
   * funnel's runtime default when no model was named); `null` is "not reported".
   */
  appliedRuntime: string | null;
  appliedModel: string | null;
  /**
   * ⚠ **RETIRED GROUP: `null` ON EVERY ROW FILED NOW (F7/F10).** The server clamps nothing and
   * resolves no model, so these carried a byte copy of the request and a Claude-table model id.
   * Kept on the DTO for rows filed before; read `start*` for the ask and `applied*` for the truth.
   */
  resolvedToolMode: LaunchToolMode | null;
  resolvedMessageMode: LaunchMessageMode | null;
  resolvedChain: boolean | null;
  resolvedModel: string | null;
  /** The agent instance the desktop started. Set iff `status` is `launched` —
   *  it is what the requester types as `@<agentId>` to direct it. */
  agentId: string | null;
  claimedAt: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
};
