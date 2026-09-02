/**
 * registrar.ts — the two registration helpers every tool goes through. Owns
 * what happens to a tool between "a registrar declared it" and "the SDK
 * publishes it"; `server.ts` boots the session.
 *
 * ⚠ Gates live in `gating.ts` and BOTH helpers call them EXPLICITLY, because
 * `registerMetaTool` registers straight onto the SDK server and never goes
 * through `registerTool`'s wrapper. Do not fold the gate calls into one wrapper.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DoplClient } from "@dopl/client";
import { type RegisterMetaTool, type RegisterTool, type ToolResponse } from "./tools/respond.js";
import type { CallerIdentity } from "./tools/identity.js";
import type { Gates } from "./gating.js";
import type { ActiveWorkspaceState, EffectiveWorkspace, WorkspaceDirectory } from "./workspace-directory.js";
/**
 * THE PER-CALL `workspace` ARG'S DESCRIPTION — ONE SHORT CONTRACT, PUSHED ONCE
 * PER DOMAIN TOOL (C9, 2026-09-02).
 *
 * ⚠ EVERY CHARACTER HERE IS PAID FOR FOURTEEN TIMES, ON EVERY CONNECTION.
 * `registerTool` injects this arg into all 14 domain schemas, so the 717-char
 * paragraph this replaced spent ~10,000 served chars stating one rule fourteen
 * times — thirteen of them pure repetition, and the same rule the instructions
 * already owe the agent before its first tool call.
 *
 * ⚠ THE FULL RULE IS STATED ONCE, IN `instructions.ts` (slice A1, which this
 * one lands after): which callers MUST pass it (0 / 2+ standard memberships),
 * that the membership count IGNORES home-channel containers, and how to
 * discover each kind of id — `list_workspaces` for workspace slugs,
 * `dopl_home(op="list_channels")` for home-channel container ids, and the first
 * does not list the second. ⚠ DO NOT RESTATE ANY OF IT HERE. A rule an agent
 * needs before it calls anything belongs in the instructions, which are pushed
 * once; the refusals in `registerTool` below name the discovery surfaces again
 * at the only moment an agent is actually stuck.
 *
 * Pinned by `server.test.ts` — the length, and that every domain tool carries
 * this exact string rather than a per-tool copy.
 */
export declare const WORKSPACE_ARG_DESCRIPTION = "Workspace or home-channel container id/slug for this call; omit to use the session default.";
/**
 * THE BILLING SEAM FOR ONE TOOL CALL — charge, then run. ⚠ Must stay ONE helper
 * called at exactly the two terminal paths of `registerTool`'s wrapper; that is
 * what makes the per-tool-call charge exactly-once. A separate charge helper
 * means two call sites per path and a future path that remembers one of them.
 *
 * ⚠ ORDERING, non-negotiable: AFTER `gates.opRefusal` (delete refusal stays
 * first and unconditional — a refused delete costs zero round trips), AFTER
 * workspace resolution (credits are per-workspace), BEFORE the handler.
 *
 * ⚠ NOT in `withWorkspaceAuth` beside `logMcpToolCall` — that fires per
 * LOOPBACK request, and one tool call makes 0..N of them.
 */
/**
 * Spend one credit for `workspaceId`. Returns the refusal, or null to proceed.
 *
 * ⚠ FAIL OPEN on anything that is not an honest "out of credits" — refusing on a
 * transient loopback blip bricks every agent and reads to the operator as "out
 * of credits" for a workspace that is not.
 *
 * ⚠ ONLY `allowed === false` REFUSES, not "not truthy". A 200 missing `allowed`
 * (proxy error page, shape change, partial response) leaves it undefined, and a
 * truthiness test reads that as a refusal — fail-open for a THROWN error,
 * silently inverted for a malformed answer, which is the more likely of the two.
 * A body that does not say "no" is not a no.
 *
 * ⚠ **ONE CHARGE FUNCTION, THREE EXPLICIT CALL SITES** (2026-08-28). It was
 * private to `createCreditedRunner` while the domain wrapper was the only meter;
 * two more seams now call it BY NAME — `registerMetaTool`'s opt-in charge
 * (`dopl_home`, ruling Q2) and `dopl_search`'s PER-LEG charge (ruling Q3). That
 * is the shape `opRefusal` already has and the shape this module's header
 * demands: explicit at every path, never folded into a wrapper only one of them
 * passes through.
 */
export type ChargeCredit = (workspaceId: string) => Promise<ToolResponse | null>;
/** Everything one session's registration helpers need to close over. */
export interface RegistrarDeps {
    /** The SDK server both helpers publish onto. */
    server: McpServer;
    /** The loopback client — used HERE only to charge MCP credits. */
    client: DoplClient;
    /** The four gates for this session (see `gating.ts`). */
    gates: Gates;
    /** Membership cache + `workspace=` resolution + the M-3 refusal. */
    directory: WorkspaceDirectory;
    /** Session default workspace resolved at boot, or null (0/2+ memberships). */
    activeWorkspace: ActiveWorkspaceState | null;
    /** That default rendered footer-ready, or null when there is none. */
    sessionEffective: () => EffectiveWorkspace | null;
    /** The caller identity every footer renders from. */
    caller: CallerIdentity;
}
export interface ToolRegistrars {
    /** The domain-tool path: workspace arg, ALS routing, footer, gates. */
    registerTool: RegisterTool;
    /**
     * The meta-tool path: no workspace arg, session footer, same gates — and an
     * OPT-IN charge (`MetaToolOptions.charged`), which only `dopl_home` takes.
     */
    registerMetaTool: RegisterMetaTool;
    /**
     * ⚠ THE CHARGE, EXPOSED BY NAME so a handler that does N workspaces' work on
     * one call can pay for N (`dopl_search(scope="everywhere")`, ruling Q3). The
     * wrapper has already charged for the RESOLVED workspace by the time a handler
     * runs, so a fan-out charges the ADDITIONAL legs and the totals agree with the
     * work. ⚠ Do not call this from a single-scope handler — that double-charges.
     */
    chargeCredit: ChargeCredit;
}
export declare function createToolRegistrars(deps: RegistrarDeps): ToolRegistrars;
