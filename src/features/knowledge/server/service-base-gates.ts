import "server-only";
import type { KnowledgeContext } from "../types";
import { AgentWriteDisabledError } from "./errors";
import { resolveAgentAudience } from "./service-audience";

/**
 * 🔒 THE GATE A KNOWLEDGE-BASE **CREATE** PASSES, and nothing else.
 *
 * ⚠ **IT HELD TWO UNTIL 2026-09-02 (slice B15).** `resolveHomeScope` — the
 * three-condition home-shelf fence — is DELETED with the `home_scoped` column it
 * answered for; what replaces it is `shared/tenancy/personal-container.ts ›
 * personalWriteWorkspaceId`, which fences ONE condition (a credential that
 * stands for a person, with a container) because the other two died with the
 * `default workspace` and with the shelf-inside-a-shared-workspace it protected.
 * That module's docblock retires each condition by name.
 *
 * ⚠ **SPLIT OUT OF `service-base-writes.ts` ON 2026-09-02 AT THE §1 CAP** (it
 * measured 498 of 500). The seam is not arbitrary: both functions below are
 * PRE-WRITE REFUSALS that answer a question about the CALLER — may this person
 * put a row on their home shelf, and will this caller be able to read back what
 * it is about to write — while everything left in that module composes a row and
 * persists it. A gate that lives beside the insert is a gate a later edit
 * reorders past it.
 *
 * ⚠ NOT EXPORTED ANY FURTHER THAN THAT MODULE. This is not a general "knowledge
 * gate" surface: {@link assertCreatorCanReadItBack} is meaningful only before an
 * insert that has not happened yet.
 */

/**
 * 🔒 **A CREATE MUST NOT PRODUCE A ROW ITS OWN CREATOR CANNOT READ BACK** — the
 * authoring half of **F-323**, which that entry predicted in as many words:
 * *"an agent can now write a base it will not be able to read back."* It could,
 * and it did.
 *
 * THE SHAPE OF THE BUG. `resolveAgentAudience` answers `granted` for an agent
 * inside a `kind='link'` container that has a PEER in it: the only bases it may
 * reach are the ones carrying a channel GRANT. Every read composes that filter
 * (`service-bases.ts › listBases`/`getBaseById`/`getBaseBySlug`,
 * `service-entries.ts › resolveEntryRefs`). `createBase` composed NOTHING — the
 * comment where this guard now stands said "No agent gate on CREATE … the base
 * doesn't exist yet", which is true about the per-base agent-write toggle and
 * silently untrue about the ceiling.
 *
 * A NEW BASE HAS NO GRANT BY CONSTRUCTION, so under a `granted` audience the
 * insert succeeded, the tool answered "Created knowledge base … Private to
 * you", and the row was invisible to its creator from the very next call:
 * absent from `list_bases`, unresolvable by slug, unwritable. An agent that
 * cannot see the failure retries, so the observed report was two identical
 * successes and two orphaned rows.
 *
 * ⚠ **REFUSAL IS THE ONLY AVAILABLE ANSWER, NOT THE CAUTIOUS ONE.** The other
 * repair would be to grant the new base into the container's channel — but
 * `service-channel-grants.ts › setChannelKnowledgeGrant` refuses
 * `ctx.source === "agent"` outright (2026-08-27), because a grant decides what
 * the PEER standing in that room can read and that is a human's decision. So
 * the create-and-share path (`input.shareToChannelId`) is ALSO always a refusal
 * for an agent, and it already rolls the row back. This guard makes the plain
 * create behave the way the sharing create has behaved all along, one call
 * earlier and without writing a row first.
 *
 * ⚠ **IT CANNOT NARROW A HUMAN, A STANDARD WORKSPACE, OR A SOLO CONTAINER.**
 * Those are `resolveAgentAudience`'s three `unrestricted` branches, and the
 * ceiling "only ever closes" — so this refusal reaches exactly the population
 * for which the write was already useless. ⚠ It is deliberately NOT keyed on
 * `ctx.source === "agent"` alone: an agent in the operator's own workspace
 * creates bases it reads back perfectly well, and refusing there would delete a
 * working daily path to fix one that never worked.
 *
 * ⚠ The message names the ROOM and the REMEDY, because "forbidden" with no
 * cause is what sends an agent to grep the repo: the operator creates the base
 * (or shares an existing one into the channel) and the agent then reaches it.
 */
export async function assertCreatorCanReadItBack(
  ctx: KnowledgeContext,
): Promise<void> {
  const audience = await resolveAgentAudience(ctx);
  if (audience.kind === "unrestricted") return;
  throw new AgentWriteDisabledError(
    "(new)",
    "An agent cannot create a knowledge base inside a shared home channel. " +
      "In a container with another member in it, an agent reaches only the bases " +
      "the operator has SHARED into one of that channel's knowledge grants — and a " +
      "base you just created carries no grant, so it would be invisible to you from " +
      "your very next call. Sharing one into a channel is a human-only setting. " +
      "Ask your operator to create the base here and share it into the channel, or " +
      "create it in a workspace of your own instead.",
  );
}
