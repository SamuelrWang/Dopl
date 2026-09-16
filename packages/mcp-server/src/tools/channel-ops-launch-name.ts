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
  return { name };
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
