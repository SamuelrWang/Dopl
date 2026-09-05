import { ChannelError } from "./errors-base";

/** **`to=` NAMED SOMETHING THIS CHANNEL DOES NOT HAVE** (2026-09-02, B4 — ruling
 *  B1). ⚠ A REFUSAL RATHER THAN A `delivery=none`: with the fan-out narrowed, a
 *  `to` that resolves to nobody reaches nobody, and answering `ok` about it is
 *  the invisible-delivery failure in its purest form. ⚠ It carries the
 *  CANDIDATES, because a refusal that does not is a second guess — both lists
 *  ROOM- and ROSTER-scoped, so this cannot probe for an arbitrary address.
 *
 *  🔒 ⚠ **`members` IS A LIST OF LABELS, NOT OF EMAILS (2026-09-02, F-588).**
 *  It carried every member's EMAIL, to any caller including an agent token, and
 *  a mistyped `to=` was therefore the cheapest roster dump on the surface. The
 *  caller (`service-writes-metadata-recipient.ts › unresolved`) now applies the
 *  entitlement rule `channel-render.ts › formatMemberLine` already states —
 *  display name, else email for an admin or the caller's own row, else the user
 *  id. ⚠ Nothing here may re-widen that: this class formats what it is handed,
 *  and the scoping lives at the ONE place that can see the caller. */
export class ChannelRecipientUnresolvedError extends ChannelError {
  constructor(
    public readonly to: string,
    public readonly liveHandles: readonly string[],
    /** Member LABELS, already entitlement-scoped by the caller. */
    public readonly members: readonly string[]
  ) {
    const agents = liveHandles.map((h) => `@${h}`).join(", ") || "none";
    super(
      `No recipient in this channel matches "${to}". ` +
        `Live agents: ${agents}. Members: ${members.join(", ") || "none"}.`
    );
  }
}


/**
 * **A HANDLE IN THE BODY NAMES MORE THAN ONE LIVE AGENT IN THIS CHANNEL**
 * (2026-09-04, the peer-tag slice).
 *
 * ⚠ **IT EXISTS BECAUSE THE AGENT NAMESPACE STOPPED BEING ONE OPERATOR'S.** A
 * human's `@<name>` now resolves against every machine's fresh sessions in the
 * room, and two operators may each have renamed an agent `Main`. `agent-<id>` is
 * unique by construction and cannot reach this; only a slugged DISPLAY NAME can.
 *
 * ⚠ **A REFUSAL, AND NEVER A PICK** — `lib/agent-mentions.ts ›
 * buildAgentMentionIndex` already fails closed for the TINT, and any collision
 * rule (mine wins, newest wins) wakes an identity the author did not choose and
 * says nothing about it. Same ruling `LaunchTemplateAmbiguousError` carries.
 *
 * ⚠ **IT CARRIES THE CANDIDATES, AND THEY DISCLOSE NOTHING NEW.** Every handle
 * listed is already readable through `op="read_sessions"` for any member of this
 * channel, and the list is what makes the remedy — address one by its id form —
 * something the caller can act on without a second call.
 *
 * ⚠ **IT ANSWERS ON `CHANNEL_RECIPIENT_UNRESOLVED`'s CODE** (`http-mapping.ts`),
 * because the caller-visible fact is the same one: nothing was written, and the
 * address has to be fixed. A second 400 code would be a second thing every
 * client has to learn for one remedy.
 */
export class ChannelAgentHandleAmbiguousError extends ChannelError {
  constructor(
    public readonly handle: string,
    public readonly candidates: readonly string[]
  ) {
    const listed = candidates.map((h) => `@${h}`).join(", ") || "none";
    super(
      `"@${handle}" names more than one live agent in this channel. ` +
        `Address one by its id handle: ${listed}.`
    );
  }
}
