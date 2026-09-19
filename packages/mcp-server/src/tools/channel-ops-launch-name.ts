import { agentDisplayName } from "./agent-display-name";
import { bareAgentId, isAgentId } from "./channel-agent-id";
import { err, type ToolResponse } from "./respond";

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
 * **HAND-MIRRORED FROM `schema-launch.ts › LaunchCreateSchema.agentName`'s `.max(60)`** — and
 * from `main/agent-names.js › MAX_NAME`, the store at the far end that would bounce a longer
 * one with `bad-name` even if the route took it (S50, 2026-09-18).
 *
 * ⚠ **IT WAS UNPUBLISHED UNTIL 2026-09-18.** `name` carries no `.max()` in the published shape
 * — it serves four actions and the other three have no such bound — so a 61-character name
 * reached the route and came back as a bare `VALIDATION_FAILED` naming no field. The number is
 * in `name`'s own `.describe()` ("1-60 visible characters") and in `channel-errors.ts ›
 * FIELD_CAPS_NOTE`; this is the third statement of it, and the only one that can refuse.
 */
export const LAUNCH_NAME_MAX_CHARS = 60;

/**
 * The name this launch should file, or the refusal to return instead.
 *
 * ⚠ **IT ANSWERS A UNION RATHER THAN THROWING**, matching every other refusal on this lane: the
 * op returns `ToolResponse` on both arms and nothing here needs a try/catch.
 * ⚠ **THE TRIMMED VALUE IS WHAT COMES BACK**, so the caller files the string this function
 * actually measured — filing `opts.name` raw would send one the checks never looked at.
 */
export function launchName(raw: string | undefined): { name: string } | ToolResponse {
  const name = String(raw ?? "").trim();
  if (name.length === 0) {
    return err(
      'op="manage" action="launch" is missing required param: name. Name the agent you are launching — a short role, 1-60 characters on one line ("Research", "Bug reviewer"). It is what every human surface shows and what other agents @-tag it by (`@bug-reviewer`).',
    );
  }
  // ⚠ **AN ID-SHAPED NAME IS REFUSED, AND THIS IS THE HALF SAMUEL SAID OUT LOUD.** It is
  // reachable by accident rather than by perversity: `read_sessions` prints `@agent-<id>`, so a
  // caller copying the neighbouring op's output into this field files an id as a name and undoes
  // the whole ruling one launch at a time.
  if (looksLikeAgentId(name)) {
    return err(
      `op="manage" action="launch": name="${name}" is an agent id, not a name. An id is internal plumbing and is never shown to a person; pass what the agent is FOR ("Research", "Bug reviewer").`,
    );
  }
  // ⚠ **A SLUG IS REPAIRED RATHER THAN REFUSED, AND ONLY AFTER THE TWO REFUSALS ABOVE**
  // (Samuel, 2026-09-17): `agent-display-name.ts` explains why this arm normalizes, and why
  // casing an id-shaped string BEFORE `looksLikeAgentId` would walk it past its own check.
  const display = agentDisplayName(name);
  // ⚠ **THE LENGTH IS MEASURED ON THE NORMALIZED VALUE, WHICH IS THE ONE THAT GETS FILED**
  // (S50, 2026-09-18). `agentDisplayName` cannot LENGTHEN a string (its own docblock argues
  // why), so this can never refuse a name the route would have taken — and measuring the raw
  // argument instead would refuse on characters that were about to collapse.
  if (display.length > LAUNCH_NAME_MAX_CHARS) {
    return err(
      [
        // ⚠ THE SAME TOKEN GRAMMAR THE GOAL CAP USES (`channel-ops-launch-goal.ts`), and the
        // same reason: a caller branches on the line, and two neighbours of one op spelling
        // one verdict two ways is how a caller learns to parse prose instead.
        `No agent was requested — field=name limit=${LAUNCH_NAME_MAX_CHARS} reason=name_too_long retry=no`,
        `**Nothing was filed**: that name is ${display.length} characters. A name is a short ROLE a person reads on a card and other agents @-tag ("Research", "Bug reviewer") — what the agent is FOR goes in \`body\`, which is the opening instruction.`,
      ].join("\n"),
    );
  }
  return { name: display };
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
function looksLikeAgentId(name: string): boolean {
  const bare = bareAgentId(name);
  if (!isAgentId(bare)) return false;
  // The strip changed the string ⇒ it carried `@` or `agent-` ⇒ it was pasted as an address.
  if (bare !== name.trim().toLowerCase()) return true;
  return /[0-9]/.test(bare);
}

/** TRUE for {@link launchName}'s refusal arm. ⚠ A PREDICATE RATHER THAN A CAST, so the op's
 *  narrowing is the compiler's rather than a reader's. */
export function isNameRefusal(
  answer: { name: string } | ToolResponse,
): answer is ToolResponse {
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
export function launchedTag(name: string): string {
  return `@${name.trim().toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * What the launch result prints when the machine reported NO name (found reviewing
 * `4782677b`, 2026-09-16; re-worded for F-736, 2026-09-18).
 *
 * ⚠ **NOT A TAG, AND DELIBERATELY UNTYPEABLE.** Every other value of `name=` is an address a
 * caller copies; this one says the address is not known, so it carries no `@` and no slug.
 * `channel-facts.ts › renderValue` quotes it for the space, which is what keeps the
 * `key=value` pairs parseable.
 *
 * ⚠ **"NOT REPORTED", NOT "NOT APPLIED", AND THE DIFFERENCE IS THE WHOLE OF F-736.** The name
 * very likely WAS applied — the desktop stores it before it answers — and what is missing is the
 * REPORT of it. `(not applied)` stated the stronger of the two as if this process had observed
 * it, on exactly the launch where it had observed least. ⚠ **IT IS ALSO THE WORD `postureFacts`
 * ALREADY USES** for the same shape of silence on the same result line, so one line no longer
 * carries two vocabularies for one fact.
 */
export const NAME_NOT_REPORTED = "(not reported)";

/**
 * **THE `name=` FIELD ON A LAUNCHED RESULT** — the machine's value, or the one spelling of
 * "the machine did not say" (F-736, resolved 2026-09-18).
 *
 * ⚠ **IT USED TO SPLIT `undefined` FROM `null` AND ONE HALF WAS UNREACHABLE.** The `undefined`
 * arm meant *"this peer predates the field, so the name it stored IS the one that was asked for"*
 * and echoed the request. But the DTO never produces `undefined`:
 * `src/features/channels/server/service-launch-dto.ts` maps `applied_agent_name ?? null`, and the
 * column is `null` for a refusal, for a non-launch kind AND for every desktop older than
 * 2026-09-15 — so all three crossed the wire as `null` and a launch whose name was applied but
 * not reported rendered `(not applied)`. **Two halves each pretending the other existed**, which
 * is F-736's own phrasing of it.
 *
 * ⚠ **THE FIX IS TO DROP THE ARM, NOT TO RE-CARRY THE DISTINCTION.** The alternative on the
 * finding was an absent KEY for a directive predating the field — which needs this process to
 * date another machine's build from a row, and would buy one echo of a request this process
 * cannot confirm. `undefined` and `null` therefore land on the same honest answer, and no caller
 * is handed a tag nothing answers to.
 *
 * ⚠ **THE REQUEST IS NO LONGER AN ARGUMENT.** Echoing it was the only reason to pass it, and a
 * parameter that can only produce the wrong answer is worse than no parameter.
 */
export function launchedName(applied: string | null | undefined): string {
  return applied === null || applied === undefined
    ? NAME_NOT_REPORTED
    : launchedTag(applied);
}
