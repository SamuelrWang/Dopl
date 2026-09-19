"use strict";
/**
 * **THE TWO CREATE-TIME TEMPLATE REFUSALS** — `AGENT_TEMPLATE_AMBIGUOUS` and
 * `AGENT_TEMPLATE_NOT_FOUND`, as sentences a caller can act on.
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-ops-launch.ts` IS AT THE CAP** (§1's hard 500 over
 * `packages/`, a CI job) — the seam is the one `channel-ops-launch-color.ts` and
 * `channel-ops-launch-name.ts` already draw: ONE FIELD, its rule and its refusal prose,
 * beside the op rather than inside it. Here the field is `template`, and the two arms below
 * are everything the launch lane says about it that is not a pass-through.
 *
 * ⚠ **THE PROSE IS UNCHANGED BY THE MOVE.** Both sentences are pinned by
 * `channel-ops-launch-template.test.ts` through `opLaunchAgent`, which is what proves a file
 * split did not become a reword.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (`parity.test.ts`) and the
 * removed-vocabulary source scan (`channel-law.test.ts`, `law-scan.test.ts`) — both read every
 * non-test `channel-*.ts` in this directory.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.templateMatches = templateMatches;
exports.ambiguousTemplate = ambiguousTemplate;
exports.templateElsewhere = templateElsewhere;
exports.templateNotFound = templateNotFound;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
// ⚠ THE TENANCY SENTENCES LIVE WITH THE OTHER PROSE (T35), and the import
// direction is ops → description because the description imports nothing from
// here. FOUR surfaces state this one rule — this file's two create-time
// refusals, `channel-doctrine.ts`'s `no-template` entry, and the home-channel
// paragraph — and four hand-written copies is how two of them end up describing
// a system the other two do not.
const channel_doctrine_1 = require("./channel-doctrine");
const narration_1 = require("./narration");
function templateMatches(e) {
    const details = e?.details;
    const raw = details?.matches;
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((m) => !!m && typeof m === "object")
        .map((m) => ({
        id: typeof m.id === "string" ? m.id : "",
        name: (0, channel_shared_1.inlineOr)(typeof m.name === "string" ? m.name : "", narration_1.NO_NAME),
        visibility: typeof m.visibility === "string" ? m.visibility : "unknown",
    }))
        .filter((m) => m.id !== "");
}
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
function ambiguousTemplate(ref, matches) {
    const label = (0, channel_shared_1.inlineOr)(ref, narration_1.NO_NAME);
    if (matches.length === 0) {
        return (0, respond_1.err)(`No agent was requested — the template name \`${label}\` matches MORE THAN ONE template you can see, and nothing was started. Template names are deliberately not unique, so this call will not guess between them. List them with the agent-templates surface, then re-issue with the template's ID instead of its name.`);
    }
    return (0, respond_1.err)([
        `No agent was requested — the template name \`${label}\` matches ${matches.length} templates you can see, and **nothing was filed**. Template names are deliberately NOT unique (two members may each keep a "Researcher"), so this call refuses rather than picking one for you.`,
        `Re-issue with the ID of the one you meant:`,
        ...matches.map((m) => `- \`${m.id}\` — ${m.name} (${m.visibility})`),
        `⚠ Every template listed is one YOU can see. Whether the OPERATOR whose machine runs the agent can see it is a separate question, answered on their machine at start time.`,
    ].join("\n"));
}
function templateElsewhere(e) {
    const details = e?.details;
    const raw = details?.elsewhere;
    if (!raw || typeof raw !== "object")
        return null;
    const { name, label } = raw;
    if (typeof name !== "string" || typeof label !== "string")
        return null;
    if (name === "" || label === "")
        return null;
    return { name, label };
}
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
function templateNotFound(ref, elsewhere) {
    if (elsewhere) {
        return (0, respond_1.err)([
            // ⚠ `inlineOr` ALREADY RETURNS A CODE SPAN — no backticks of our own
            // around it. Both halves are peer-authored in principle (a template
            // name, a workspace name) and neither may pose as structure.
            `No agent was requested, and **nothing was filed** — template ${(0, channel_shared_1.inlineOr)(elsewhere.name, narration_1.NO_NAME)} lives in ${(0, channel_shared_1.inlineOr)(elsewhere.label, "another tenancy of yours")}, not in this channel's own container.`,
            `⚠ ${channel_doctrine_1.TENANCY_RULE} Owning it is not enough; it has to live here. ${channel_doctrine_1.TENANCY_FIX}`,
        ].join("\n"));
    }
    return (0, respond_1.err)([
        // ⚠ THE ID CLAUSE RIDES `TENANCY_RULE` BELOW (2026-09-18): this sentence
        // is true of a NAME and was never true of a UUID.
        `No agent was requested — no agent template ${(0, channel_shared_1.inlineOr)(ref, narration_1.NO_NAME)} resolves in THIS CHANNEL'S container, and **nothing was filed**. Either there is no such template, or it is not shared with you; those are ONE answer here on purpose, so ids cannot be probed.`,
        `⚠ CHECK THE TENANCY BEFORE THE SPELLING. ${channel_doctrine_1.TENANCY_RULE} If it really should resolve here, the NAME is the other suspect — matching is exact, not fuzzy. ${channel_doctrine_1.TENANCY_FIX}`,
    ].join("\n"));
}
