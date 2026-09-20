import "server-only";
import type { ChannelMessageCreateInput } from "../schema";

/**
 * **A RECORD — A POST FOR NOBODY, ON PURPOSE** (2026-09-18, Samuel: *"there are
 * cases where maybe the agent … needs to post something to channel to have a
 * record of it, but it's like really not meant for agents and it might not be
 * meant for like users"*).
 *
 * ⚠ **ITS OWN FILE SINCE 2026-09-20, AT §1's CAP.** `service-wake-verdict.ts`
 * crossed 500 lines carrying this term's argument, and the argument is the part
 * that must not be lost: the term reads ONE caller-supplied field and turns off
 * every repair the product has, so the next person to touch it needs the whole
 * history in front of them. The verdict file keeps PRECEDENCE, which is its
 * subject; this keeps what a record IS.
 *
 * ⚠ **IT IS `intent:"chat"`, THE FIELD THAT ALREADY MEANT THIS**, rather than a
 * fourth `kind` and a second stored shape. `MessageIntentSchema`'s own contract
 * is *"it STATES that this post is not work for anybody"*, `chat` + an address is
 * already a 400 (`ChannelChatAddressedError`), and the row stays an ordinary
 * `message` — same seq, same realtime, same transcript, no migration and no
 * renderer arm. The MCP surface spells it `kind="record"`.
 *
 * ⚠ **WHAT IT ADDS IS THE ARMS.** Before it, a `chat` post was still REPAIRED:
 * the arms read only "nobody was addressed", which a record satisfies for a
 * reason opposite to a forgotten `@`. Repairing one aims a wake at a post whose
 * author said it was for nobody.
 *
 * 🔒 **AND IT IS AN AGENT'S CLAIM ONLY — A PERSON'S COMPOSER MESSAGE IS NOT A
 * RECORD** (Samuel, 2026-09-20: *"the auto-resolving to the most recent agent
 * address is not working right now … I see it say Decision Card Coder as the most
 * recent but then when I send a message, it is not properly sending to you … I
 * have to tag you again"*).
 *
 * ⚠ **ONE WIRE VALUE, TWO MEANINGS, FROM TWO CLIENTS — THAT IS THE WHOLE BUG.**
 * `components/composer.tsx` has stamped `intent:"chat"` on EVERY message a person
 * types since long before this term existed; there it means *plain chat, not a
 * thread request*, and it is the ONLY value a human message can carry, because
 * absence reads as `request`. On 2026-09-18 the same value gained its second
 * meaning. From that commit every untagged message typed into the channel
 * composer was read as a deliberate record: `repairable` went false, **RR3 never
 * ran**, and the post landed on `none` with no recipients. An explicit `@` still
 * worked, because a named agent is decided ABOVE the arms — which is why it
 * presented as the default *wandering off* rather than as a feature switched off,
 * and why re-tagging always fixed it.
 *
 * ⚠ **THE PREDICTION NEVER MOVED WITH IT.** `lib/draft-recipients.ts ›
 * draftReach` has no record term at all, so the composer's recipient line went on
 * naming the responder for a send the server would give to nobody. A line that
 * says one thing while the write does another is the single failure that module
 * exists to prevent, and it is the symptom Samuel actually saw.
 *
 * ⚠ **`authorKind` IS THE HONEST DISCRIMINATOR, NOT A PROXY FOR THE CLIENT.** The
 * ruling above is about an AGENT filing something nobody must act on, and MCP
 * sets this value for `kind="record"` ALONE (`packages/mcp-server/src/tools/
 * channel-ops-write.ts`) — a surface only an agent writes through. A person has
 * no affordance anywhere that claims "this is for nobody".
 *
 * ⚠ **AND IT TAKES NOTHING FROM THE RECORD.** For an AGENT author the term is
 * unchanged, which is the whole of what the 2026-09-18 wave bought: RR2 is
 * deleted and RR3 is already gated `authorKind !== "agent"`, so an agent's record
 * still short-circuits RR1 and still lands on `none`.
 *
 * ⚠ **THE SUITE MISSED IT BECAUSE IT NEVER DROVE THE REAL WIRE SHAPE.** The person
 * arms in `service-wake-verdict-addressing.test.ts` passed no `intent` at all, so
 * they proved RR3 against a message no client sends — every case green while the
 * feature was off for four days. One case there now passes `intent:"chat"`, and a
 * mutation of this predicate fails it.
 *
 * ⚠ **THE REAL FIX IS A THIRD ENUM VALUE AND THIS IS NOT IT.** `MessageIntent`
 * should name the record outright rather than overloading `chat`; that is a
 * schema change across the route, the MCP package and installed desktops, and it
 * is not this session's to make. Filed as a finding — until then, the two
 * meanings are told apart by the one field that can tell them apart.
 */
export function isRecordPost(
  intent: ChannelMessageCreateInput["intent"],
  /** ⚠ FROM THE CREDENTIAL (`service-writes.ts`), never from the body — the same
   *  value RR3's own gate reads, so the two cannot disagree about who wrote. */
  authorKind: string
): boolean {
  return intent === "chat" && authorKind === "agent";
}
