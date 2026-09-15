"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchName = launchName;
exports.isNameRefusal = isNameRefusal;
exports.launchedTag = launchedTag;
const channel_agent_id_1 = require("./channel-agent-id");
const respond_1 = require("./respond");
/**
 * **THE NAME A LAUNCH MUST CARRY, AND THE TWO REFUSALS THAT ENFORCE IT** (Samuel, 2026-09-15,
 * verbatim: *"if agents are spinning up agents, they should be the ones that are naming the
 * agent. Shouldn't be a nameless agent. And certainly shouldn't be an agent with the id as the
 * name."*).
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-ops-launch.ts` IS AT THE CAP** (§1's hard 500 over
 * `packages/`, a CI job), and the seam is `channel-ops-launch-color.ts`'s exactly — ONE FIELD,
 * its rule and its refusal prose, beside the op rather than inside it. That file's header calls
 * itself "the third such neighbour rather than a new pattern"; this is the fourth.
 *
 * ⚠ **THE CAPABILITY AND THE REQUIREMENT LANDED TOGETHER, AND THAT IS THE DESIGN.** Until this
 * wave the launch op had no `name` argument AT ALL, so every agent an agent launched was nameless
 * by construction and rendered on every human surface as its own instance id
 * (`docs/specs/agent-id-visibility.md`). Adding the field as OPTIONAL would have left the defect
 * reachable by omission, and the caller here is a model that omits whatever it can.
 *
 * ⚠ **REFUSED HERE RATHER THAN AT THE ROUTE'S ZOD, BECAUSE ONLY THIS LAYER CAN SAY WHAT TO PASS.**
 * `schema-launch.ts › LaunchCreateSchema.agentName` also requires it — that is the fence — but a
 * zod message reaches an orchestrator as a validation string it cannot act on, and a refusal an
 * orchestrator cannot act on is a retry loop.
 */
/**
 * The name this launch should file, or the refusal to return instead.
 *
 * ⚠ **IT ANSWERS A UNION RATHER THAN THROWING**, matching every other refusal on this lane: the
 * op returns `ToolResponse` on both arms and nothing here needs a try/catch.
 * ⚠ **THE TRIMMED VALUE IS WHAT COMES BACK**, so the caller files the string this function
 * actually measured — filing `opts.name` raw would send one the checks never looked at.
 */
function launchName(raw) {
    const name = String(raw ?? "").trim();
    if (name.length === 0) {
        return (0, respond_1.err)('op="manage" action="launch" is missing required param: name. Name the agent you are launching — a short role, 1-60 characters on one line ("Research", "Bug reviewer"). It is what every human surface shows and what other agents @-tag it by (`@bug-reviewer`).');
    }
    // ⚠ **AN ID-SHAPED NAME IS REFUSED, AND THIS IS THE HALF SAMUEL SAID OUT LOUD.** It is
    // reachable by accident rather than by perversity: `read_sessions` prints `@agent-<id>`, so a
    // caller copying the neighbouring op's output into this field files an id as a name and undoes
    // the whole ruling one launch at a time.
    if (looksLikeAgentId(name)) {
        return (0, respond_1.err)(`op="manage" action="launch": name="${name}" is an agent id, not a name. An id is internal plumbing and is never shown to a person; pass what the agent is FOR ("Research", "Bug reviewer").`);
    }
    return { name };
}
/**
 * **IS THIS STRING AN ADDRESS SOMEBODY PASTED RATHER THAN A NAME SOMEBODY CHOSE?**
 *
 * ⚠ **THE NAÏVE TEST — `isAgentId(bareAgentId(name))` — REFUSES REAL NAMES, AND IT WAS WRITTEN
 * THAT WAY FIRST.** `AGENT_ID_RE` is `^[a-z][a-z0-9]{7}$`, and so are `reviewer`, `deployer`,
 * `auditors` and `verifier`. **A refusal nobody can explain is worse than the leak it prevents**:
 * the caller has done exactly what the copy asked and is told its name is an id.
 *
 * ⚠ **SO THE TWO CASES ARE SEPARATED, AND THE FIRST IS THE ONE THAT MATTERS.**
 *   · A PASTED form — `@agent-<id>`, `agent-<id>`, `@<id>` — is refused outright. Nobody names an
 *     agent `@agent-x2sz1ztt`; that string can only have come from a neighbouring op's output,
 *     which is precisely the accident this check exists for.
 *   · A BARE eight characters is refused only when it CARRIES A DIGIT. An id is random over
 *     `[a-z0-9]`, so this catches ~91% of them, and no English word carries one.
 *
 * ⚠ **THE ~9% OF DIGIT-FREE IDS THAT SLIP THROUGH BARE IS THE ACCEPTED TRADE, STATED PLAINLY.**
 * They arrive as a stored name, render on a card, and read as gibberish an operator can rename —
 * visible and recoverable. The alternative refuses `reviewer` forever, which is neither.
 */
function looksLikeAgentId(name) {
    const bare = (0, channel_agent_id_1.bareAgentId)(name);
    if (!(0, channel_agent_id_1.isAgentId)(bare))
        return false;
    // The strip changed the string ⇒ it carried `@` or `agent-` ⇒ it was pasted as an address.
    if (bare !== name.trim().toLowerCase())
        return true;
    return /[0-9]/.test(bare);
}
/** TRUE for {@link launchName}'s refusal arm. ⚠ A PREDICATE RATHER THAN A CAST, so the op's
 *  narrowing is the compiler's rather than a reader's. */
function isNameRefusal(answer) {
    return !("name" in answer);
}
/**
 * **THE TAG A LAUNCHED AGENT ANSWERS TO** — its stored name, slugged (Samuel, 2026-09-15).
 *
 * ⚠ **IT LIVES BESIDE THE NAME RULE BECAUSE IT IS THE OTHER HALF OF ONE SUBJECT**: this module
 * decides what a launch may be CALLED, and this is how that name is SPELLED back to the caller.
 * (`channel-ops-launch.ts` is at the §1 cap, which is why both are here rather than there.)
 *
 * ⚠ **THE SLUGGER IS RESTATED BECAUSE THIS PACKAGE CANNOT IMPORT `lib/mentions.ts ›
 * mentionSlug`** — the arrangement `channel-agent-id.ts` lives under for the id grammar. Four
 * characters, one rule: trim, lowercase, whitespace runs to a single `-`.
 * ⚠ **IT PRINTS WHAT THE CALLER WILL TYPE.** `Coder-1` is the stored NAME; `@coder-1` is the
 * address, and publishing the first while the resolver accepts the second is how a caller writes
 * a token nothing tints.
 * ⚠ **THE CALLER MUST PASS THE MACHINE'S VALUE, NOT ITS OWN REQUEST.** The uniqueness rule may
 * have stored `Coder-1`; echoing the ask would be right whenever nothing collided and confidently
 * wrong exactly when it mattered.
 */
function launchedTag(name) {
    return `@${name.trim().toLowerCase().replace(/\s+/g, "-")}`;
}
