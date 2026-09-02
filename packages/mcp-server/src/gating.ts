/**
 * gating.ts — THE GATES, and the tables they read.
 *
 * ⚠ THE TOPOLOGY IS THE INVARIANT. Gates run at REGISTRATION (the tool never
 * exists) or per CALL (the op is refused):
 *
 *   registration → {@link Gates.isSuppressedTool}: HIDDEN_TOOLS, plus the
 *                  role-scoped offer a `X-Dopl-Tool-Profile` header asks for.
 *   per call     → {@link Gates.opRefusal}: the app-only-deletion block FIRST
 *                  and unconditionally, then the write-scope gate.
 *
 * ⚠ They live HERE, outside the registration wrapper, because
 * `registerMetaTool` registers straight onto the SDK server — inline gating
 * published two tools that passed through none of them. Do NOT push these back
 * inside a wrapper; both registration helpers call them explicitly.
 *
 * ⚠ ORDERING INSIDE `opRefusal` IS LOAD-BEARING: the delete refusal fires
 * first and unconditionally, before workspace resolution and any client call,
 * so a refused delete costs zero round trips and can never half-happen. It must
 * never become reachable only after another gate lets the call through.
 *
 * ⚠ `READ_ONLY_BLOCKED_TOOLS` WAS DELETED WITH THE FIVE `_admin` TOOLS
 * (2026-09-02). It held exactly those five names — the purely destructive tools
 * a read-only session was not even offered — and nothing can join it: deletion
 * is app-only, so no destructive tool can be registered for it to name. A
 * read-only session's write refusal is {@link WRITE_OPS}, per op, which is where
 * it always was for every mixed tool.
 *
 * ⚠ `parity.test.ts` / `delete-block.test.ts` PARSE `WRITE_OPS` and
 * `HIDDEN_TOOLS` out of this file's SOURCE TEXT (`tools/parity-harness.ts`).
 * The parse follows the constant, not the filename.
 */

import { DELETE_REFUSAL, isBlockedDeleteOp } from "./delete-policy.js";
import type { ToolResponse } from "./tools/respond.js";
import { READ_ONLY_SESSION, refusal } from "./tools/tool-errors.js";

/**
 * THE HIDE-BEFORE-DELETE SEAM — a registered tool an agent no longer sees.
 * Empty is the current state, not a dead mechanism: retirement is two steps
 * (hide, then delete), and this is step one's whole implementation.
 *
 * ⚠ A tool that no longer EXISTS must not be listed here —
 * `delete-block.test.ts` asserts every HIDDEN name still has a registrar, and a
 * name with none is a claim about a gate that guards nothing.
 *
 * ⚠ At the REGISTRAR, not the route: the MCP server reaches the app's routes
 * over LOOPBACK HTTP through `DoplClient`, so gating a route 500s the tool while
 * the agent still SEES it in `tools/list`. Unregistered = absent = nothing to
 * call. Same choke point as `READ_ONLY_BLOCKED_TOOLS` below.
 */
export const HIDDEN_TOOLS = new Set<string>([]);

/**
 * ROLE-SCOPED TOOL OFFERS — which tools a session in a given role is offered.
 * The `X-Dopl-Tool-Profile` request header names the role; this table decides
 * what it means. EMPTY TODAY: the mechanism ships in wave A and the table is
 * filled in wave B, so every role currently serves the whole surface.
 *
 * ⚠ NARROWING-ONLY BY CONSTRUCTION, in three ways that must all stay true:
 *   1. a role's value is an ALLOW set INTERSECTED with what the registrars
 *      register, so a role can never name a tool into existence;
 *   2. an ABSENT header, and a role with no row here, both resolve to `null` =
 *      no narrowing = the whole surface. An unknown role can therefore never
 *      widen anything, and a desktop build newer than this server degrades to
 *      today's behaviour rather than to an empty tool list;
 *   3. it is a HINT AND NOT A FENCE. The header is caller-supplied, so anything
 *      holding the credential can pick any role — including none. Containment
 *      is the desktop's `disallowedTools` + `grantDecision`, and the credential
 *      itself. Nothing may be GRANTED on this value. Same discipline as
 *      `src/shared/auth/runtime-header.ts`.
 */
export const TOOL_PROFILE_TOOLS = new Map<string, ReadonlySet<string>>();

/**
 * The tools a role is offered, or `null` for "no narrowing". ⚠ The ONE place a
 * profile name becomes a set, so the fail-open direction is written once.
 *
 * ⚠ A `Map`, NOT AN OBJECT LITERAL — unlike every other table in this file, the
 * KEY here is caller-supplied. `TOOL_PROFILE_TOOLS["constructor"]` on a literal
 * answers `Object.prototype.constructor`: truthy, and then `.has` is not a
 * function. A Map has no inherited keys, so a role name off the wire can only
 * hit a row somebody wrote.
 */
export function offeredToolsFor(
  toolProfile: string | null | undefined,
): ReadonlySet<string> | null {
  return (toolProfile && TOOL_PROFILE_TOOLS.get(toolProfile)) || null;
}

/**
 * Per-op write gating for MIXED read+write tools — they stay registered for
 * read-only sessions so reads work, but write ops are refused. ⚠ Keep each set
 * in sync with the tool's `op` enum: a new write op MUST be added here, or a
 * `dopl.read`-only token can write through a non-admin tool.
 */
export const WRITE_OPS: Record<string, Set<string>> = {
  dopl_ontology: new Set([
    "create_cluster",
    "update_cluster",
    "create_column",
    "create_object",
    "update_object",
    "set_template_field",
    "remove_template_field",
    "set_attribute",
    "remove_attribute",
    "set_relationship",
    "remove_relationship",
    "set_action",
    "remove_action",
    "claim_anchor",
  ]),
  dopl_kb: new Set([
    "create_base",
    "update_base",
    "create_folder",
    "move_folder",
    "write_file",
    "move_file",
    "set_visibility",
    // ⚠ `pin` and `unpin` WRITE, and UNPIN is the one easiest to wave through:
    // both set a WORKSPACE-WIDE boolean deciding what every agent session
    // launched here is handed at startup, so a read-only token must be refused
    // both or a dopl.read session can silently empty its operator's launch
    // context through a non-admin tool.
    // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: the parity harness parses this set out
    // of the SOURCE TEXT, so a quoted phrase in a comment is read as an op name.
    "pin",
    "unpin",
    // ⚠ copy_base CREATES A BASE (plus its folders and entries) IN ANOTHER
    // TENANCY, so it is the widest write on this tool and a read-only token
    // must be refused it. ⚠ The refusal is the ONE that costs nothing: the
    // gate runs before the target resolves and before any tree is read.
    "copy_base",
  ]),
  dopl_skill: new Set([
    "create",
    "update",
    "write",
    "set_visibility",
  ]),
  // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: `tools/parity-harness.ts` parses this set
  // out of the SOURCE TEXT, so a quoted phrase in a comment is read as an op
  // name and fails the WRITE_OPS-subset-of-enum check.
  // ⚠ BOTH verbs write, and update is the one easiest to miss: it can raise a
  // template to workspace visibility, which is the SHARE act itself (a template
  // has no grant table). A read-only token must be refused it.
  // ⚠ copy CREATES A TEMPLATE IN ANOTHER TENANCY. It lands private, which keeps
  // it out of the confirm class, and that is a statement about AUDIENCE and not
  // about whether it writes.
  dopl_agent: new Set(["create", "update", "copy"]),
  // ⚠ `dopl_home` REGISTERS ON THE META PATH AND IS STILL GATED HERE, because
  // `opRefusal` is called explicitly on BOTH registration paths — which is the
  // whole reason the gates were hoisted out of the domain wrapper. A read-only
  // token lists home channels and creates none.
  dopl_home: new Set(["create_channel"]),
  dopl_chats: new Set(["export", "append", "update", "create_folder", "update_folder"]),
  dopl_channel: new Set([
    "open",
    "invite",
    "post",
    // `milestone` writes a message.
    // ⚠ `propose_close` and `close_thread` were here until thread closing was
    // removed (wiring plan Phase 4, 2026-08-18). `close_thread` was listed even
    // though the registrar answered it with a refusal, and the reason still
    // applies to any future teaching-refusal op: a read-only token must be
    // refused for the SCOPE reason FIRST, or the shape of the two errors tells a
    // read-only caller which threads exist.
    "milestone",
    "create_thread",
    "set_thread_mode",
    // ⚠ `escalate` WRITES. It is a post under the hood — a real message row in a
    // room every member reads — and a read-only token must be refused it for the
    // SCOPE reason like any other post, not merely because the payload is
    // structured.
    "escalate",
    // ⚠ `direct_agent` WRITES. It files a `channel_agent_directions` row and asks
    // a machine to start a TURN on a running agent — not merely a read that
    // happens to wait, and a read-only token must be refused it.
    // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: the parity harness parses this set out of
    // the SOURCE TEXT, so a quoted phrase in a comment is read as an op name.
    "direct_agent",
    // ⚠ `launch_agent` WRITES. It files a `channel_launch_directives` row and
    // asks a machine to start a process — it is not merely a read that happens
    // to wait, and a read-only token must be refused it or a `dopl.read` session
    // can spawn agents through a non-admin tool.
    // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: `tools/parity-harness.ts` parses this
    // set out of the SOURCE TEXT, so a quoted phrase in a comment is read as an
    // op name and fails the WRITE_OPS-subset-of-enum check.
    "launch_agent",
    // ⚠ `end_agent` AND `rename_agent` WRITE (2026-09-01). Each files a
    // `channel_launch_directives` row of a non-launch KIND and asks a machine to
    // act on a running agent; a read-only token must be refused both, or a
    // `dopl.read` session can STOP its operator agents through a non-admin tool.
    // ⚠ CLASSIFIED AS WRITES EVEN THOUGH NEITHER CHANGES ANY ROW A READ COULD
    // SEE — an end mutates a live process and a rename mutates a local store, and
    // neither is a read that happens to wait. `direct_agent` above carries the
    // same argument.
    // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: the parity harness parses this set out of
    // the SOURCE TEXT, so a quoted phrase in a comment is read as an op name.
    "end_agent",
    "rename_agent",
    // ⚠ `set_agent_mode` WRITES, AND IT IS THE WIDEST OF THE THREE (2026-09-01).
    // It files a directive row and asks a machine to RE-PERMISSION a running
    // agent; a read-only token must be refused it, or a dopl.read session can
    // widen its own agents through a non-admin tool.
    // ⚠ IT IS ALSO THE ONE NON-LAUNCH VERB THE MACHINE'S OWN LAUNCH-CONSENT
    // TOGGLE GATES, for the same reason it is classified here: more room can mean
    // more compute spent on the operator's hardware, which a stop verb and a
    // display label cannot cause.
    // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: the parity harness parses this set out of
    // the SOURCE TEXT, so a quoted phrase in a comment is read as an op name.
    "set_agent_mode",
    // ⚠ WRITES THE CHANNEL INFO CARD (Q12, 2026-08-28). It also READS when
    // `info_card` is omitted, and it is classified as a WRITE anyway: an op that
    // can write must be refused wholesale for a read-only token, or the read arm
    // becomes the door the write arm walks through.
    "update",
    // ⚠ `ping` WRITES. It files a `channel_pings` row addressed at a person or a
    // machine, and on the agent form it can WAKE a running session — a read-only
    // token must be refused it for the SCOPE reason like any other write, or a
    // dopl.read session can nudge agents through a non-admin tool.
    // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: the parity harness parses this set out
    // of the SOURCE TEXT, so a quoted phrase in a comment is read as an op name.
    "ping",
  ]),
};

/** The four gates, bound to one session's write capability. */
export interface Gates {
  /**
   * Suppressed at registration: absent from `tools/list`, nothing to call —
   * `HIDDEN_TOOLS` plus anything outside this session's role-scoped offer. The
   * honest way to remove a capability is for the tool not to exist.
   */
  isSuppressedTool(name: string): boolean;
  /** The `op` a call is asking for, or undefined for an op-less tool. */
  requestedOp(args: unknown): string | undefined;
  /**
   * ⚠ Per-call refusals in the order they must fire: app-only deletion
   * (unconditional — never reachable only after another gate lets the call
   * through), then the read-only write-scope gate. Null = proceed. Refusing
   * here means no workspace resolved and no backend request made.
   */
  opRefusal(name: string, op: string | undefined): ToolResponse | null;
}

/**
 * Build the gates for one session. ⚠ `canWrite` is the OAuth scope verdict and
 * FAILS CLOSED upstream — write only on an explicit `dopl.write`.
 *
 * ⚠ `offeredTools` is the RESOLVED set, not a role name, so a caller can hand in
 * any set it likes — which is what lets `meta-gate.test.ts` drive the
 * suppression leg with synthetic names instead of against a table that is empty
 * by design. `server.ts` resolves it through {@link offeredToolsFor}; `null` is
 * "serve everything" and is the only behaviour wave A ships.
 */
export function createGates(
  canWrite: boolean,
  offeredTools: ReadonlySet<string> | null = null,
): Gates {
  function isSuppressedTool(name: string): boolean {
    if (HIDDEN_TOOLS.has(name)) return true;
    return offeredTools !== null && !offeredTools.has(name);
  }

  function requestedOp(args: unknown): string | undefined {
    const op = (args as { op?: unknown } | null)?.op;
    return typeof op === "string" ? op : undefined;
  }

  function opRefusal(name: string, op: string | undefined): ToolResponse | null {
    if (op === undefined) return null;
    if (isBlockedDeleteOp(name, op)) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: DELETE_REFUSAL }],
      };
    }
    if (!canWrite && WRITE_OPS[name]?.has(op)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            // ⚠ Same shape as every other refusal on this surface: the code
            // first, so an agent has a literal to match, then the sentence that
            // says which call was refused. `meta-gate.test.ts` pins "read-only".
            text: refusal(
              READ_ONLY_SESSION,
              `\`${name}\` op="${op}" is a write operation. Reconnect with write access to perform it.`,
            ),
          },
        ],
      };
    }
    return null;
  }

  return { isSuppressedTool, requestedOp, opRefusal };
}
