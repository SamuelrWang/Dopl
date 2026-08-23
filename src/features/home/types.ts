/**
 * Home surface contracts — account-level (cross-org) channels.
 *
 * A relationship is a claimed link: a hidden `kind='link'` workspace holding
 * exactly one direct channel between the two people. A pending link is the
 * minted-but-unclaimed invite. `GET /api/home/relationships` returns both.
 */

/** The other person in a relationship, resolved from their profile. */
export interface HomePeer {
  userId: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/** One claimed relationship — addresses the container like any workspace. */
export interface HomeRelationship {
  /** The `kind='link'` container workspace. */
  workspaceId: string;
  /** `{slug}-{publicId}` — what the channels client APIs address by. */
  workspaceSegment: string;
  /** The single direct channel inside the container. */
  channelId: string;
  peer: HomePeer;
  connectedAt: string;
  lastMessageAt: string | null;
  /** Pre-truncated server-side; null when the channel is empty. */
  lastMessagePreview: string | null;
}

/** A minted, not-yet-claimed link. Only ever the caller's own. */
export interface HomePendingLink {
  id: string;
  /** Full claim URL, e.g. `https://dopl.link/c/<token>`. */
  url: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** null = multi-use. */
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
}

/** Payload of `GET /api/home/relationships`. */
export interface HomeRelationshipsPayload {
  relationships: HomeRelationship[];
  pendingLinks: HomePendingLink[];
}

/** Payload of `POST /api/home/links` and rows of `GET /api/home/links`. */
export interface HomeLinkMintResult {
  link: HomePendingLink;
}

/**
 * Public metadata a claim page may show before auth — never the token owner's
 * identity beyond a display name.
 */
export interface HomeLinkPublicInfo {
  creatorDisplayName: string | null;
  expired: boolean;
  revoked: boolean;
  exhausted: boolean;
}

/** Payload of `POST /api/home/links/[token]/claim`. */
export interface HomeLinkClaimResult {
  relationship: HomeRelationship;
  /** True when the pair already had a container and it was reused. */
  existing: boolean;
}
