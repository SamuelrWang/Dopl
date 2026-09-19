/**
 * **THE TEMPLATE A LAUNCH NAMED, AND THE TWO REFUSALS IT CAN EARN** — the
 * ambiguous name and the one that resolves nowhere.
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-ops-launch.ts` IS AT THE CAP** (§1's hard
 * 500 over `packages/`, a CI job) — the seam is the one
 * `channel-ops-launch-color.ts` and `channel-ops-launch-name.ts` already draw:
 * ONE FIELD, its rule and its refusal prose, beside the op rather than inside
 * it. Nothing moved but text and the two duck-typed readers that feed it.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * ⚠ **THESE ARE PER-CALL ERROR TEXTS, NOT SERVED DESCRIPTIONS.** They are
 * budgeted by `write-result-budget.test.ts`, never by the served-description
 * ratchet, which is why they may say the whole sentence.
 */
import { type ToolResponse } from "./respond";
/** The `code` a DoplApiError carries, or null. ⚠ Duck-typed rather than imported
 *  — the same discipline `respond.ts`'s `isNotFound` follows across the
 *  @dopl/client boundary. */
export declare function apiErrorCode(e: unknown): string | null;
/** One row of the ambiguity refusal, as the server's `details.matches` carries
 *  it. ⚠ Every row already passed the CALLER's own `canSeeTemplate`, so nothing
 *  here is an oracle — it is what `GET /api/agent-templates` would have said. */
type TemplateMatch = {
    id: string;
    name: string;
    visibility: string;
};
export declare function templateMatches(e: unknown): TemplateMatch[];
/**
 * THE AMBIGUOUS-NAME REFUSAL — **it lists, and it does not pick.**
 *
 * ⚠ `agent_templates` HAS NO NAME UNIQUENESS, DELIBERATELY: a unique index
 * across a visibility boundary would leak the existence of somebody's private
 * row through a conflict error, and two people may each keep a "Researcher". So
 * two visible templates sharing a name is a LEGITIMATE state, and every natural
 * tie-break ("yours wins", "newest wins") silently starts an identity the caller
 * did not choose and reports success.
 *
 * ⚠ THE LIST IS THE WHOLE VALUE OF THE REFUSAL. "That name is ambiguous" alone
 * sends the agent to another tool to fetch ids it was already holding. Each row
 * carries the ID (what to re-issue with) and the VISIBILITY (what makes the
 * choice obvious — "the private one is mine").
 * ⚠ `isError`, because nothing was filed and there is nothing pending. An `ok`
 * result reading as a normal outcome would invite a poll for a directive that
 * does not exist.
 */
export declare function ambiguousTemplate(ref: string, matches: TemplateMatch[]): ToolResponse;
/** A template the caller holds in another tenancy of their own, as the server's
 *  `details.elsewhere` carries it. ⚠ Duck-typed across the @dopl/client
 *  boundary, the same discipline `templateMatches` and `apiErrorCode` follow. */
type TemplateElsewhere = {
    name: string;
    label: string;
};
export declare function templateElsewhere(e: unknown): TemplateElsewhere | null;
/**
 * THE UNRESOLVABLE-TEMPLATE REFUSAL, at CREATE time.
 *
 * ⚠ DISTINCT FROM `no-template`, WHICH IS THE SAME FACT ON THE OTHER MACHINE.
 * This one is YOUR visibility failing, before any row exists; `no-template` is
 * the OPERATOR's failing, after the request was filed. The next actions differ —
 * here you fix the name, there you share the template or drop it — so they are
 * two sentences and not one.
 * ⚠ IT DOES NOT SAY WHETHER THE TEMPLATE EXISTS. The whole read surface is
 * 404-never-403 so an id cannot be probed, and a sentence that guessed would
 * rebuild that oracle.
 *
 * ⚠ BUT IT NAMES THE TENANCY RULE, WHICH IS NOT AN ORACLE (T35). The server
 * resolves the ref against THE CHANNEL'S workspace — `ctx.workspaceId` is the
 * container (`channels/server/service-shared.ts`), and every template read is
 * keyed `(workspace_id, id)` (`agent-templates/server/repository.ts`), so
 * `canSeeTemplate` is never even reached: the row is filtered by tenancy BEFORE
 * visibility runs. That is a STANDING RULE OF THE SYSTEM, true before this call
 * and answerable from the caller's own knowledge — withholding it is what made
 * this the most-misread refusal on the surface, since an agent re-checks the
 * spelling forever for a name that was never wrong.
 *
 * ⚠ AND WHEN THE SERVER SAYS WHERE, IT SAYS WHERE. `details.elsewhere` arrives
 * ONLY for a template the caller could already list for themselves — their own
 * row, or a `workspace`-visible one, in a workspace they are a member of
 * (`agent-templates/server/service-resolve-ref.ts › classifyMissingTemplateRef`
 * is the fence and holds the argument). A stranger's private template produces
 * no `elsewhere` in any workspace, so the arm below cannot name one and the
 * bare arm still answers "no such template" and "not shared with you"
 * identically.
 */
export declare function templateNotFound(ref: string, elsewhere: TemplateElsewhere | null): ToolResponse;
export {};
