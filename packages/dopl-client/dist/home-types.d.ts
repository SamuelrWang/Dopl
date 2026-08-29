/**
 * Domain types for the HOME surface — the account-level channels a user has
 * outside any standard workspace.
 *
 * ⚠ Mirrors `src/features/home/types.ts` — hand-synced, like `knowledge-types.ts`
 * and `agent-template-types.ts`. No drift gate covers this pair; both halves
 * move in ONE change.
 *
 * 🔒 **A HOME CHANNEL IS A `kind='link'` CONTAINER WORKSPACE, AND
 * {@link HomeChannel.workspaceId} IS THE HANDLE EVERY OTHER TOOL TAKES AS
 * `workspace=`.** That is the whole reason this type is on the SDK: containers
 * are excluded from `listWorkspaces`'s listing by `isStandardWorkspace` and are
 * therefore unlistable and unaddressable without it, while `resolveWorkspaceRef`
 * deliberately resolves against the UNFILTERED directory. That asymmetry is the
 * container door.
 *
 * ⚠ THIS IS NOT A WORKSPACE LISTING AND MUST NOT BE RENDERED AS ONE. INVARIANTS
 * §4A forbids advertising a container as a workspace; these are HOME CHANNELS to
 * the operator, and the surface that shows them says so.
 */
/** Another person in a home channel, resolved from their profile. */
export interface HomePeer {
    userId: string;
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
}
/**
 * A minted, not-yet-claimed invitation on a channel. ⚠ READ-ONLY HERE: minting
 * one is `POST /api/home/links`, which is `sessionOnly` — no SDK method binds
 * it, deliberately, the same omission `deleteAgentTemplate` makes.
 */
export interface HomePendingLink {
    id: string;
    url: string;
    label: string | null;
    createdAt: string;
    expiresAt: string | null;
    /** null = multi-use. */
    maxUses: number | null;
    useCount: number;
    revokedAt: string | null;
    /** ⚠ May be ABSENT on a row minted before the column existed; the fail-safe
     *  reading is the DB default, `"guest"`. */
    grantedRole?: string;
}
/** One home channel. */
export interface HomeChannel {
    /** 🔒 The `kind='link'` container workspace — the `workspace=` handle. */
    workspaceId: string;
    /** `{slug}-{publicId}` — what the channels client APIs address by. */
    workspaceSegment: string;
    /** The single channel inside the container. */
    channelId: string;
    name: string;
    /**
     * EVERY other member, oldest join first. Empty for a channel the caller is
     * alone in.
     *
     * ⚠ OPTIONAL ON THE WIRE even though the server type is not: the key is newer
     * than some cached payloads, and this package is consumed by readers that hold
     * one. Read it as `?? []` — `.length` on `undefined` throws.
     */
    peers?: HomePeer[];
    /** The FIRST other member, or null. Derived from `peers[0]` server-side. */
    peer?: HomePeer | null;
    createdAt: string;
    lastMessageAt: string | null;
    /** Pre-truncated server-side; null when the channel is empty. */
    lastMessagePreview: string | null;
    /** The open invitation on this channel, when there is one. */
    linkOut?: HomePendingLink | null;
}
/** Payload of `GET /api/home/channels`. */
export interface HomeChannelsPayload {
    channels: HomeChannel[];
    /** LEGACY unbound links only — a bound one rides its channel as `linkOut`. */
    pendingLinks?: HomePendingLink[];
}
/** Payload of `POST /api/home/channels`. */
export interface HomeChannelCreateResult {
    channel: HomeChannel;
}
