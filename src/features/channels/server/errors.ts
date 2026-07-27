export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ChannelNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Channel not found: ${ref}`);
  }
}

/** Caller lacks the channel-scoped permission for the attempted action. */
export class ChannelForbiddenError extends ChannelError {
  constructor(action: string) {
    super(`Not allowed to ${action}`);
  }
}

/** A channel with the same (workspace, slug) already exists. */
export class ChannelSlugConflictError extends ChannelError {
  constructor(slug: string) {
    super(`A channel with the slug "${slug}" already exists`);
  }
}

/** The invitee is not an active member of the workspace. */
export class ChannelInviteeNotMemberError extends ChannelError {
  constructor(userId: string) {
    super(`User is not an active workspace member: ${userId}`);
  }
}

/** The target is already a member of the channel. */
export class ChannelMemberExistsError extends ChannelError {
  constructor() {
    super("User is already a member of this channel");
  }
}

/**
 * A posted message was addressed (`toUserId`) to someone who is not a
 * member of the channel. Mapped to a 400 so the caller fixes the address.
 */
export class ChannelAddresseeNotMemberError extends ChannelError {
  constructor(public readonly userId: string) {
    super(`Addressed user is not a member of this channel: ${userId}`);
  }
}

/**
 * Removing this member would leave the channel with no owner. Blocks a last
 * owner leaving / being removed — transfer ownership first.
 */
export class ChannelLastOwnerError extends ChannelError {
  constructor() {
    super("Cannot remove the last owner of this channel");
  }
}

/**
 * A consent request the caller can't act on — either it doesn't exist or it
 * isn't addressed to the caller (operator). Collapsed to one not-found so a
 * caller can't probe another operator's request ids.
 */
export class ConsentNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Consent request not found: ${ref}`);
  }
}

/** The consent request has already been decided (or expired) — no re-decide. */
export class ConsentAlreadyDecidedError extends ChannelError {
  constructor(public readonly status: string) {
    super(`Consent request already ${status}`);
  }
}

/** A trust rule would name the operator themselves — meaningless, refused. */
export class TrustSelfError extends ChannelError {
  constructor() {
    super("You cannot add a trust rule for yourself");
  }
}

/** The trusted target is not an active member of the workspace. */
export class TrustedNotMemberError extends ChannelError {
  constructor(public readonly userId: string) {
    super(`User is not an active workspace member: ${userId}`);
  }
}
