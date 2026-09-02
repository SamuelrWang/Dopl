import { ChannelError } from "./errors-base";

/** **`to=` NAMED SOMETHING THIS CHANNEL DOES NOT HAVE** (2026-09-02, B4 — ruling
 *  B1). ⚠ A REFUSAL RATHER THAN A `delivery=none`: with the fan-out narrowed, a
 *  `to` that resolves to nobody reaches nobody, and answering `ok` about it is
 *  the invisible-delivery failure in its purest form. ⚠ It carries the
 *  CANDIDATES, because a refusal that does not is a second guess — both lists
 *  ROOM- and ROSTER-scoped, so this cannot probe for an arbitrary address. */
export class ChannelRecipientUnresolvedError extends ChannelError {
  constructor(
    public readonly to: string,
    public readonly liveHandles: readonly string[],
    public readonly members: readonly string[]
  ) {
    const agents = liveHandles.map((h) => `@${h}`).join(", ") || "none";
    super(
      `No recipient in this channel matches "${to}". ` +
        `Live agents: ${agents}. Members: ${members.join(", ") || "none"}.`
    );
  }
}
