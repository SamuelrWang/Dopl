import "server-only";
import { randomBytes } from "crypto";
import { HttpError } from "@/shared/lib/http-error";
import {
  buildChannelContext,
  createChannel,
} from "@/features/channels/server/service";
import {
  deleteWorkspace,
  findMembership,
  listProfileSummaries,
  type ProfileSummary,
} from "@/features/workspaces/server/repository";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { slugifyWorkspaceName } from "@/features/workspaces/slug";
import type {
  HomeChannelCreateResult,
  HomeLinkClaimResult,
  HomeLinkMintResult,
} from "../types";
import {
  isClaimable,
  mapLinkRow,
  type ChannelLinkRow,
  type LinkContainerRow,
} from "./dto";
import * as repo from "./repository";
import type { HomeChannelCreateInput, HomeLinkMintInput } from "../schema";
import { claimBoundLink } from "./service-claim-bound";
import { hydrateOneChannel } from "./service-reads";

/**
 * Write side of home channels: create a channel, mint the link that adds a
 * person to one, revoke, claim.
 *
 * ⚠ THE MODEL INVERTED 2026-08-24. Creating a channel and gaining a peer are
 * now two separate acts: `createHomeChannel` mints a SOLO container the operator
 * works in alone, and `mintContainerLink` binds an invitation to a container
 * that already exists. `claimLink` is the FRONT DOOR for both claim shapes: it
 * judges the token, then dispatches on `link.workspace_id` — the legacy unbound
 * branch stays here, the bound one is `service-claim-bound.ts`.
 */

/**
 * ⚠ base64url, CASE-SENSITIVE, like `workspace_invitations.token` and NOT like
 * `workspace_join_links` (lowercase hex, normalized on lookup). A home link is
 * shared as a whole URL and clicked; the hex form exists for tokens that get
 * RETYPED through apps that case-fold, which this one is not. 32 bytes → 43
 * chars.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 23505. ⚠ Read locally rather than imported from the channels feature: this is
 * one PostgREST error code, and reaching across a feature boundary for it would
 * make the home surface depend on a channels internal to spell a constant.
 */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

/**
 * "New channel" — a container with ONE member and one private channel in it.
 *
 * ⚠ THE CHANNEL IS PRIVATE AND NOT DIRECT. `direct: true` would ask
 * `createDirectChannel` for a self-DM (refused) and would bind the channel to a
 * peer that does not exist yet; the whole point of the inversion is that a home
 * channel is usable with nobody else in it, as the place the operator's own
 * agents work. When a person is added later they JOIN this channel — the
 * transcript that is already there is the relationship's history.
 *
 * ⚠ NOT `sessionOnly` at the route, so an agent token may call this — the same
 * posture `POST /api/workspaces` takes (Samuel's ruling, 2026-08-24). Creating a
 * container mints nothing an agent could use to reach a human; the link that
 * does is `mintContainerLink`, and that one is session-gated.
 */
export async function createHomeChannel(
  userId: string,
  input: HomeChannelCreateInput
): Promise<HomeChannelCreateResult> {
  const container = await repo.insertSoloContainer({
    ownerUserId: userId,
    name: input.name,
    slug: slugifyWorkspaceName(input.name),
  });

  // ⚠ THE CHANNELS SERVICE, not a second copy of it: slug collision handling,
  // the owner member row and the visibility default all live in
  // `createChannel`. The context is built for the CREATOR — they own the
  // container, so they own its channel.
  try {
    await createChannel(
      buildChannelContext({
        userId,
        workspaceId: container.id,
        role: "owner",
      }),
      { name: input.name, visibility: "private" }
    );
  } catch (err) {
    // ⚠ Roll the container back. A container with no channel is a BRICK:
    // `hydrateChannels` drops it, so the operator never sees it, and it still
    // counts as a workspace everywhere that enumerates memberships.
    await deleteWorkspace(container.id);
    throw err;
  }
  return { channel: await hydrateOneChannel(container, userId) };
}

/**
 * Mint the ADD-A-PERSON link for a container that already exists.
 *
 * ⚠ ANY MEMBER MAY MINT IT, not the owner only (Samuel's ruling, 2026-08-24).
 * A home channel is a relationship, not a tenancy — the second person is as
 * entitled to hand it to somebody as the first. The cap, not the role, is what
 * bounds the outcome.
 *
 * The order is the correctness argument:
 *  1. `findMemberContainer` is the FENCE. A non-member — or a standard
 *     workspace — reads as absent, so this 404s and never 403s (no oracle).
 *  2. The MINT FLOOR and GRANT-ABOVE-SELF are judged BEFORE anything is
 *     inserted — see below. ⚠ **THERE IS NO CAPACITY GATE ANY MORE
 *     (2026-08-26, Samuel's ruling).** A container held two members and this
 *     step 409'd `LINK_CONTAINER_FULL` past that; a home channel may now hold as
 *     many people as it is given, so there is no number left to compare against
 *     and nothing here to refuse. The gates that remain are about WHO is asking,
 *     not HOW MANY are already in.
 *  3. An OPEN link is RETURNED, not replaced — the `getOrCreateJoinLink`
 *     precedent. Pressing "Add person" twice must hand back one URL; rotating
 *     silently would kill a link already pasted into an email. ⚠ BUT "open"
 *     (the index predicate, un-revoked) is NOT "claimable": an expired or
 *     exhausted-yet-unrevoked row matches `channel_links_one_open_per_workspace`
 *     (so it BLOCKS a replacement mint) while `hydrateChannels` drops its
 *     `linkOut` (so no Revoke button) — the channel is permanently un-invitable.
 *     So judge `isClaimable` on the row: claimable → hand it back; dead →
 *     REVOKE it (freeing the index) and fall through to mint fresh.
 *     ⚠ **AND "CLAIMABLE" IS NOT ENOUGH EITHER — AN EXPLICITLY REQUESTED GRANT
 *     HAS TO MATCH (2026-08-26).** M3 put a ROLE PICKER on that button and the
 *     reuse branch returned the open row VERBATIM, without comparing
 *     `granted_role`. The popover renders "Create another", so reuse is the
 *     NORMAL second click: an operator picking "Member — full channel" over an
 *     open GUEST link got a 200 carrying the guest link back, and the peer
 *     landed as a guest. **And the reverse — picking Guest over an open MEMBER
 *     link — pointed the same silence at PRIVILEGE.** So a claimable link whose
 *     requested grant differs is REVOKED and re-minted, reusing the dead-link
 *     path: the operator's explicit choice wins over a URL they may have pasted
 *     somewhere, because the alternative is a link that grants something they
 *     did not choose.
 *     🔒 ⚠ **"REQUESTED" IS THE LOAD-BEARING WORD, AND THE FIRST CUT DID NOT
 *     HAVE IT (2026-08-26, second pass).** `grantedRole` used to carry
 *     `.default("guest")` in the schema, so an ABSENT field was indistinguishable
 *     from a chosen `guest` — and a pre-M2 client (or any body omitting it)
 *     pressing "Add person" against an open **member** link therefore took this
 *     mismatch branch: it revoked the operator's outstanding invitation, minted a
 *     guest one, answered 200, and said nothing. That is a silent ROTATION and a
 *     silent DOWNGRADE of a URL already in somebody's inbox. The field is
 *     `optional()` now: **absent = "reuse whatever is open"** (the pre-M3
 *     semantics), and only an explicit pick can revoke. A FRESH mint with no pick
 *     still lands at `guest` — the fail-closed default now lives HERE, at
 *     `roleToMint`, where it applies to minting and not to matching.
 *  4. The insert can still lose a race, and `channel_links_one_open_per_workspace`
 *     is what makes that CONVERGE: a 23505 means somebody else's mint won, so
 *     re-read and return theirs.
 *
 * `maxUses: 1` always, and the cap's retirement did NOT loosen it. ONE TOKEN
 * ADMITS ONE NAMED PERSON: adding a second, third and fourth member is a fresh
 * mint each time, so an operator who pastes a link into the wrong window has let
 * in one stranger rather than opened the room. Single-use is the shape, not a
 * default, and it is now the ONLY thing bounding how a container grows.
 *
 * ⚠ GRANT-ABOVE-SELF (2026-08-25, M2): the link carries `input.grantedRole` (the
 * role the claimer lands at, default `guest`) and a minter cannot hand out a role
 * ABOVE their own — `meetsMinRole(minterRole, grantedRole)` or 403. In a
 * container the minter is the owner, so this always passes today; the DB CHECK
 * (`granted_role ∈ {guest,viewer,member}`) is the real ceiling. The guard exists
 * so the invariant survives a future where a non-owner can mint.
 */
export async function mintContainerLink(
  userId: string,
  workspaceId: string,
  input: HomeLinkMintInput
): Promise<HomeLinkMintResult> {
  const container = await repo.findMemberContainer(workspaceId, userId);
  if (!container) {
    throw new HttpError(404, "CHANNEL_NOT_FOUND", "This channel is not available");
  }

  // ⚠ TWO VALUES, NOT ONE, AND THAT IS THE WHOLE FIX. `requestedRole` is what
  // the body ASKED FOR — `null` when it said nothing — and it is the only thing
  // the reuse branch is allowed to compare against. `roleToMint` is what a FRESH
  // link gets, fail-closed at the floor. Collapsing them (a schema `.default()`)
  // makes "absent" revoke somebody's open invitation.
  const requestedRole = input.grantedRole ?? null;
  const roleToMint: Role = requestedRole ?? "guest";

  // ⚠ Grant-above-self, BEFORE the insert. `findMemberContainer` already proved
  // active membership of this link container; read the minter's ROLE in it (the
  // fence returns the container, not the role) and refuse a grant above it.
  const minter = await findMembership(workspaceId, userId);
  // 🔒 A GUEST MAY NOT MINT, AND SINCE THE CAP CAME OFF IT IS THE ONLY THING
  // STANDING HERE (2026-08-26). `meetsMinRole("guest","guest")` is TRUE, so a
  // guest passes grant-above-self; the two-member cap used to refuse them
  // anyway whenever the container was full, and that accident is gone. ⚠ **THE
  // FLOOR NOW CARRIES THE WHOLE CASE ON ITS OWN**: without it a guest — a person
  // somebody else let in — could hand strangers links into the operator's
  // transcript, one after another, with nothing counting. "Any MEMBER of a
  // container may mint it" (Samuel, 2026-08-24) was written when `member` was
  // the floor role, and that is the reading that survives.
  if (!minter || !meetsMinRole(minter.role, "member")) {
    throw new HttpError(
      403,
      "LINK_MINT_FORBIDDEN",
      "You cannot add somebody to this channel"
    );
  }
  if (!meetsMinRole(minter.role, roleToMint)) {
    throw new HttpError(
      403,
      "GRANT_ABOVE_SELF",
      "You cannot grant a role above your own"
    );
  }

  const open = await repo.findOpenLinkForWorkspace(workspaceId);
  if (open) {
    // ⚠ TWO CONDITIONS, ONE BRANCH. A link is handed back if it is still
    // CLAIMABLE *and* nothing contradicts it — either the body asked for no
    // particular role (`requestedRole === null` → reuse whatever is open, the
    // pre-M3 semantics) or it asked for exactly what this link grants. Any other
    // combination takes the revoke-and-remint path below. See gate 3: the
    // second condition is the role picker's, and without it the picker no-ops —
    // but reading an ABSENT field as a pick is how a silent rotation happens.
    if (
      isClaimable(open) &&
      (requestedRole === null || open.granted_role === requestedRole)
    ) {
      return { link: mapLinkRow(open) };
    }
    // ⚠ Un-revoked but DEAD (expired/exhausted), or alive but granting a role
    // the caller EXPLICITLY did not ask for. Returning a dead one would hand out
    // a URL that 410s at claim, and leaving it un-revoked bricks the channel —
    // the one-open index blocks a replacement and hydrateChannels hides the
    // Revoke button. Returning a mismatched one silently overrides the
    // operator's pick. Revoke it (scoped to its OWN creator, since any member
    // may mint and the link may be the other member's) then mint fresh below.
    await repo.markLinkRevoked(open.id, open.creator_user_id);
  }

  try {
    const row = await repo.insertLink({
      creatorUserId: userId,
      token: generateToken(),
      label: input.label ?? null,
      expiresAt: input.expiresAt ?? null,
      maxUses: 1,
      workspaceId,
      grantedRole: roleToMint,
    });
    return { link: mapLinkRow(row) };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await repo.findOpenLinkForWorkspace(workspaceId);
    if (!winner) throw err;
    return { link: mapLinkRow(winner) };
  }
}

/**
 * Soft-revoke. Creator only, and 404 for anybody else's link so the endpoint
 * cannot confirm a link id. Idempotent: an already-revoked link is not an error
 * — the caller asked for it to be dead and it is.
 */
export async function revokeLink(
  userId: string,
  linkId: string
): Promise<void> {
  if (await repo.markLinkRevoked(linkId, userId)) return;
  const existing = await repo.findLinkById(linkId, userId);
  if (!existing) {
    throw new HttpError(404, "LINK_NOT_FOUND", "This link is not valid");
  }
}

/** Display name for the container's name. Email local part is the fallback,
 *  because a workspace called "&" tells nobody anything. */
function shortName(profile: ProfileSummary | undefined): string {
  return profile?.displayName || profile?.email?.split("@")[0] || "Member";
}

/**
 * THE FRONT DOOR for every claim, and the ONE place the two branches are told
 * apart.
 *
 * ⚠ THE PROLOGUE IS SHARED AND THE BODIES ARE NOT. Unknown token 404 (never an
 * oracle) and a dead link 410 are properties of the TOKEN, so they are judged
 * once, here, before anything knows which shape of claim this is. Everything
 * after depends on what the link is bound to:
 *
 *  - `workspace_id === null` → the LEGACY UNBOUND branch below, which MINTS a
 *    container for the pair.
 *  - otherwise → `service-claim-bound.ts › claimBoundLink`, which JOINS the
 *    container the link names.
 *
 * Their rollback stories are opposites — one may delete the workspace it just
 * created, the other must never delete the workspace it was handed — which is
 * why they are two functions and not one with a flag.
 */
export async function claimLink(
  token: string,
  userId: string
): Promise<HomeLinkClaimResult> {
  const link = await repo.findLinkByToken(token);
  if (!link) {
    throw new HttpError(404, "LINK_NOT_FOUND", "This link is not valid");
  }
  if (!isClaimable(link)) {
    throw new HttpError(410, "LINK_UNAVAILABLE", "This link is no longer available");
  }
  if (link.workspace_id !== null) {
    return claimBoundLink(link, userId);
  }
  return claimUnboundLink(link, userId);
}

/**
 * The LEGACY UNBOUND branch — a token minted before the 2026-08-24 inversion,
 * with no container behind it, whose claim mints one for the pair.
 *
 * ⚠ NOT DEAD CODE. Measured 2026-08-24 against the live project, open claimable
 * tokens exist with `workspace_id IS NULL`; those URLs are in somebody's chat
 * history. Nothing can PRODUCE another one — `HomeLinkMintSchema` requires a
 * `workspaceId` — so this branch only ever shrinks, and it may not be deleted
 * until that count reaches zero.
 *
 * ⚠ THE ORDER IS THE CORRECTNESS ARGUMENT.
 *  1. Own link → 400: a self-claim would ask `createDirectChannel` for a
 *     self-DM. (The token's own validity was judged by `claimLink`.)
 *  2. Dedup the PAIR before spending anything. A second open of the same link
 *     between the same two people is a no-op that returns the existing channel,
 *     and it must not burn a use to do it.
 *  3. Spend one use ATOMICALLY (`consumeLinkUse`). This is the only thing
 *     standing between a single-use link and two claimers, so it happens before
 *     any row is created and its `false` is a 410, not a retry — after ONE
 *     re-check of the pair, which is the same account racing itself.
 *  4. Mint the container + the direct channel.
 *     ⚠ ACCEPTED WINDOW: the use is spent before the container exists, so a
 *     failure here burns one. Step 4 rolls its own workspace back, which
 *     narrows the window to a rollback that itself failed — and a burned use on
 *     a multi-use link is a smaller harm than a container nobody can see.
 *  5. Record the claim. Its unique `(link_id, claimed_by)` is what makes a
 *     concurrent double-claim by ONE account converge instead of minting two
 *     containers — the loser drops the container it just made and re-reads the
 *     winner's.
 */
async function claimUnboundLink(
  link: ChannelLinkRow,
  userId: string
): Promise<HomeLinkClaimResult> {
  const creatorId = link.creator_user_id;
  if (creatorId === userId) {
    throw new HttpError(400, "LINK_SELF_CLAIM", "You cannot claim your own link");
  }

  const existing = await repo.findPairContainer(creatorId, userId);
  if (existing) {
    return { channel: await hydrateOneChannel(existing, userId), existing: true, bound: false };
  }

  if (!(await repo.consumeLinkUse(link.id))) {
    // ⚠ ONE re-read, and NOT of the link row (`consumeLinkUse` forbids that) —
    // of the PAIR. Two tabs of the SAME account opening a single-use link race
    // past the dedup above together; one wins the use and the other reads
    // exhausted. The loser is looking at a channel that now exists, so
    // answering 410 would 410 the claimer on their own successful claim.
    const winner = await repo.findPairContainer(creatorId, userId);
    if (winner) {
      return { channel: await hydrateOneChannel(winner, userId), existing: true, bound: false };
    }
    throw new HttpError(410, "LINK_UNAVAILABLE", "This link is no longer available");
  }

  const container = await createContainer(creatorId, userId);
  const claimed = await repo.insertClaim({
    linkId: link.id,
    claimedBy: userId,
    workspaceId: container.id,
  });
  if (!claimed) {
    await deleteWorkspace(container.id);
    const winner = await repo.findPairContainer(creatorId, userId);
    if (!winner) throw new HttpError(409, "LINK_CLAIM_RACE", "Try again");
    return { channel: await hydrateOneChannel(winner, userId), existing: true, bound: false };
  }
  return { channel: await hydrateOneChannel(container, userId), existing: false, bound: false };
}

/** The container plus its one direct channel — the legacy unbound shape. */
async function createContainer(
  creatorId: string,
  claimerId: string
): Promise<LinkContainerRow> {
  const profiles = await listProfileSummaries([creatorId, claimerId]);
  const name = `${shortName(profiles.get(creatorId))} & ${shortName(profiles.get(claimerId))}`;
  const container = await repo.insertLinkContainer({
    creatorUserId: creatorId,
    claimerUserId: claimerId,
    name,
    slug: slugifyWorkspaceName(name),
  });

  // ⚠ THE CHANNELS SERVICE, not a second copy of it: `direct_key` dedup,
  // membership-of-2 and the self-target refusal all live in
  // `createDirectChannel` and must not be mirrored here. The context is built
  // for the CREATOR — they own the container, so they own its channel.
  try {
    await createChannel(
      buildChannelContext({
        userId: creatorId,
        workspaceId: container.id,
        role: "owner",
      }),
      { direct: true, memberUserId: claimerId }
    );
  } catch (err) {
    // ⚠ Roll the container back, exactly as the `insertClaim` loser does. A
    // container with no channel is a BRICK: `hydrateChannels` drops it, so
    // neither side ever sees it, and `findPairContainer` still finds it — which
    // would dedup every future claim between this pair onto a channel that can
    // never render.
    await deleteWorkspace(container.id);
    throw err;
  }
  return container;
}
