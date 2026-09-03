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
