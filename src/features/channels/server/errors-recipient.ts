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
 * An AGENT's message names people in `to=` but its body does not @-tag every one of them
 * (Samuel, 2026-10-08: no pill renders `to=`, so the tag is the only way a reader sees who it
 * is for). Refused before anything is written; the body is never edited for the caller. Answers
 * on `CHANNEL_RECIPIENT_UNRESOLVED`'s code: the remedy is the same, fix the message and resend.
 */
export class ChannelAddresseeUntaggedError extends ChannelError {
  constructor(public readonly handles: readonly string[]) {
    super(
      `Nothing was sent. This message is addressed to ${handles.length === 1 ? "a person" : "people"} ` +
        `its text never names. Add ${handles.map((h) => `@${h}`).join(", ")} where they belong in ` +
        `the message and send it again with the same client_msg_id. Readers see who a message ` +
        `is for only through that tag.`
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
