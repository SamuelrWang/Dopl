import { ChannelError } from "./errors-base";

/** `to=` named nothing in this channel: a refusal, never a silent `delivery=none`. Carries room- and
 *  roster-scoped candidates. `members` are labels the caller already entitlement-scoped
 *  (`service-writes-metadata-recipient.ts › unresolved`, F-588); never widen them here. */
export class ChannelRecipientUnresolvedError extends ChannelError {
  constructor(
    public readonly to: string,
    public readonly liveHandles: readonly string[],
    public readonly members: readonly string[],
    /** The whole message when the refusal is not about a name (e.g. too many recipients). */
    detail?: string
  ) {
    const agents = liveHandles.map((h) => `@${h}`).join(", ") || "none";
    super(
      detail ??
        `No recipient in this channel matches "${to}". ` +
          `Live agents: ${agents}. Members: ${members.join(", ") || "none"}.`
    );
  }
}


/**
 * A body `@<name>` matches more than one live agent in this channel: refused, never picked. The
 * candidates are already readable via `read_sessions`. Answers on `CHANNEL_RECIPIENT_UNRESOLVED`'s
 * code (`http-mapping.ts`): the remedy is the same.
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
