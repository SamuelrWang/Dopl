"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NAME_NOT_APPLIED = void 0;
exports.launchName = launchName;
exports.isNameRefusal = isNameRefusal;
exports.launchedTag = launchedTag;
exports.launchedName = launchedName;
const agent_display_name_1 = require("./agent-display-name");
const channel_agent_id_1 = require("./channel-agent-id");
const respond_1 = require("./respond");
/**
 * **THE NAME A LAUNCH MUST CARRY, AND THE TWO REFUSALS THAT ENFORCE IT** (Samuel, 2026-09-15:
 * *"if agents are spinning up agents, they should be the ones that are naming the agent.
 * Shouldn't be a nameless agent. And certainly shouldn't be an agent with the id as the name."*).
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-ops-launch.ts` IS AT THE CAP** (§1's hard 500 over
 * `packages/`, a CI job) — the seam is `channel-ops-launch-color.ts`'s: ONE FIELD, its rule and
 * its refusal prose, beside the op rather than inside it.
 *
 * ⚠ **REQUIRED, NOT OPTIONAL**: adding the field as optional would leave the defect reachable by
 * omission, and the caller here is a model that omits whatever it can.
 * ⚠ **REFUSED HERE RATHER THAN AT THE ROUTE'S ZOD, BECAUSE ONLY THIS LAYER CAN SAY WHAT TO PASS.**
 * `schema-launch.ts › LaunchCreateSchema.agentName` is the fence; a zod message reaches an
 * orchestrator as a validation string it cannot act on, and that is a retry loop.
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
    // ⚠ **A SLUG IS REPAIRED RATHER THAN REFUSED, AND ONLY AFTER THE TWO REFUSALS ABOVE**
    // (Samuel, 2026-09-17): `agent-display-name.ts` explains why this arm normalizes, and why
    // casing an id-shaped string BEFORE `looksLikeAgentId` would walk it past its own check.
    return { name: (0, agent_display_name_1.agentDisplayName)(name) };
}
/**
 * **IS THIS STRING AN ADDRESS SOMEBODY PASTED RATHER THAN A NAME SOMEBODY CHOSE?**
 *
 * ⚠ **THE NAÏVE TEST — `isAgentId(bareAgentId(name))` — REFUSES REAL NAMES.** `AGENT_ID_RE` is
 * `^[a-z][a-z0-9]{7}$`, and so are `reviewer`, `deployer`, `auditors` and `verifier`. So the two
 * cases are separated:
 *   · A PASTED form — `@agent-<id>`, `agent-<id>`, `@<id>` — is refused outright; that string can
 *     only have come from a neighbouring op's output, which is the accident this exists for.
 *   · A BARE eight characters is refused only when it CARRIES A DIGIT (~91% of ids, and no
 *     English word).
 *
 * ⚠ **THE ~9% OF DIGIT-FREE IDS THAT SLIP THROUGH IS THE ACCEPTED TRADE**: they render as
 * gibberish an operator can rename — visible and recoverable — where the alternative refuses
 * `reviewer` forever.
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
 * ⚠ **THE SLUGGER IS RESTATED BECAUSE THIS PACKAGE CANNOT IMPORT `lib/mentions.ts ›
 * mentionSlug`** — the arrangement `channel-agent-id.ts` lives under for the id grammar. Pinned
 * against every other copy by `src/features/channels/agent-name-schema.test.ts`.
 * ⚠ **IT PRINTS WHAT THE CALLER WILL TYPE**: `Coder-1` is the stored NAME, `@coder-1` the
 * address, and publishing the first while the resolver accepts the second is how a caller writes
 * a token nothing tints.
 * ⚠ **THE CALLER MUST PASS THE MACHINE'S VALUE, NOT ITS OWN REQUEST** — echoing the ask would be
 * right whenever nothing collided and confidently wrong exactly when it mattered.
 */
function launchedTag(name) {
    return `@${name.trim().toLowerCase().replace(/\s+/g, "-")}`;
}
/**
 * What the launch result prints when the machine reported NO name (found reviewing
 * `4782677b`, 2026-09-16).
 *
 * ⚠ **NOT A TAG, AND DELIBERATELY UNTYPEABLE.** Every other value of `name=` is an address a
 * caller copies; this one says the address is not known, so it carries no `@` and no slug.
 * `channel-facts.ts › renderValue` quotes it for the space, which is what keeps the
 * `key=value` pairs parseable.
 */
exports.NAME_NOT_APPLIED = "(not applied)";
/**
 * **THE `name=` FIELD ON A LAUNCHED RESULT** — the machine's value, the older-desktop fallback,
 * and the third case that used to be silently folded into the second (found reviewing
 * `4782677b`, 2026-09-16).
 *
 * ⚠ **`null` AND `undefined` ARE DIFFERENT ANSWERS AND `??` COLLAPSED THEM.** The field is
 * OPTIONAL on the SDK's `LaunchDirective`, so:
 *   · `undefined` — the desktop/server predates the field. The name it stored IS the one that was
 *     asked for, and echoing the request is the honest answer. This is the only fallback.
 *   · `null` — the field IS carried and the machine reported no name. `4782677b` closed the two
 *     desktop arms that produced it, so it should now be unreachable; echoing the REQUEST here
 *     published a tag nothing answers to, on exactly the launch that went wrong.
 * ⚠ **AN UNREACHABLE CASE STILL GETS A SPELLING.** "Cannot happen" is what the previous version
 * relied on, and the six unnamed launches of 2026-09-16 are what it cost.
 */
function launchedName(applied, requested) {
    if (applied === undefined)
        return launchedTag(requested);
    if (applied === null)
        return exports.NAME_NOT_APPLIED;
    return launchedTag(applied);
}
