/**
 * /home's LEFT COLUMN — the demo's channel rows, and which gray well each sits
 * in. Pure data; the markup is `demo-home-chrome.tsx`, and the ROW's face is the
 * product's own (`shared/ui/home-channel-row.tsx`).
 *
 * ⚠ ITS OWN FILE, and not a preference: `demo-data.ts` is at the 500-line cap
 * the root lint enforces (`max-lines`), and these rows are the one part of the
 * demo's data that is NOT a wire shape. Everything in that file is a real
 * `Channel` / `ChannelMessage` / session row the product's own components are
 * fed; everything here is a flattened stand-in for the rows
 * `GET /api/channels?scope=account` answers with, which the marketing tree has
 * nothing to call.
 *
 * ⚠ **THE FIELDS ARE `HomeChannelRowFacts` — THE OUTPUTS OF /home's ROW
 * DERIVATIONS, NOT THEIR INPUT.** The real list feeds a `Channel` through
 * `channelTitle` / `channelPeople` / `hasLinkOut` and hands the answers to
 * `HomeChannelRow`; the demo has no payload behind it, so it authors those
 * answers and the SAME component renders them. The derivations are what the
 * demo cannot host — the FACE is what it must not fork.
 *
 * ⚠ **THE WELL IS AUTHORED HERE TOO, AND THAT IS THE ONE HONEST DIFFERENCE.**
 * `channel-wells.ts › channelWellOf` reads a `HomeRow`'s `myFavoritedAt` and its
 * stamp against `wellFor`'s 24h cut; the demo has neither, so each row names its
 * well. The SET those ids belong to is the product's own
 * (`channels/components/home-channel-wells.ts`), so a fourth well or a renamed
 * one reaches this scene without an edit.
 *
 * ⚠ ONE CLOCK. The stamps come from `demo-data.ts`'s `minsAgo`, anchored once
 * per load — a second `Date.now()` here would drift the list's timestamps off
 * the transcript's by however long the module graph took to evaluate.
 */

import type { HomeChannelWellId } from "@/features/channels/components/home-channel-wells";
import type { HomeChannelRowFacts } from "@/shared/ui/home-channel-row";
import type { AvatarPerson } from "@/shared/ui/avatar";
import { CURRENT_USER_ID, FACE, MEMBERS, messagesAt, minsAgo } from "./demo-data";

/** ONE row of /home's channel list: what it says, and which well it is filed in. */
export type HomeRowMock = HomeChannelRowFacts & {
  id: string;
  well: HomeChannelWellId;
};

/** The row the scene sits in — `q4-outbound`, the channel the record pane
 *  plays. ⚠ `rel:`-prefixed like the real ids (`home-rows.ts › channelRowId`). */
export const HOME_ROW_ID = "rel:demo-ws-q4";

/**
 * The operator, as the agent view's VIEWER identity.
 *
 * ⚠ **ITS SECOND MOUNT IS GONE (2026-09-17)** — it fed the header's settings FACE
 * until /home's operator control became a bare black pill reading "Profile"
 * (Samuel, 2026-09-15: *"remove the profile icon"*), so the header takes no
 * viewer now.
 * ⚠ `avatarUrl` is a bundled `public/` path, which `useBridgedImageSrc` returns
 * verbatim on the web — no bridge, no request beyond the asset.
 */
export const VIEWER: AvatarPerson = {
  userId: CURRENT_USER_ID,
  email: "srwang@usc.edu",
  displayName: "Samuel Wang",
  avatarUrl: "/img/avatars/sam.jpg",
};

/**
 * ⚠ THE ACTIVE ROW'S FACES ARE THE CHANNEL'S OWN ROSTER, read out of `MEMBERS`
 * rather than retyped: the stack in the list and the avatars in the transcript
 * beside it are then the same two people by construction.
 *
 * 🔒 **EVERY FACE IN THIS COLUMN IS A PHOTOGRAPH (Samuel, 2026-09-17:** *"use
 * bundled placeholder avatar images for the fictional people; initials chips are
 * not the product's face"*). The rejected scene drew `DW OH LZ +1` — an
 * `AvatarStack` of four nameless people, initialled and then overflowed. **No row
 * below carries more faces than there are photographs**, so neither the initial
 * fallback nor the `+N` bite can appear.
 *
 * ⚠ `displayName` is nullable on `ChannelMember` and NON-nullable on the row's
 * face — it feeds both the title and the fallback — so the resolution happens
 * here, exactly as `relationship-list.tsx` does it.
 */
const PEERS = MEMBERS.filter((m) => m.userId !== CURRENT_USER_ID).map((m) => ({
  userId: m.userId,
  displayName: m.displayName || m.email || "Member",
  // ⚠ READ OFF `FACE`, NOT OFF THE ROW, so a member that ever loses its photo
  // fails the lookup here instead of silently degrading to initials.
  avatarUrl: FACE[m.userId as keyof typeof FACE] ?? m.avatarUrl,
}));

/** A row with nothing to say on either mark. Spelled once so a row states only
 *  what makes it different. */
const QUIET = {
  description: "",
  linkOut: false,
  pending: false,
  pendingLine: null,
  unread: false,
  mentions: 0,
} as const;

/**
 * THE LIST, one row per case the real column can draw — a pinned SOLO channel
 * (its description takes line two), the live one, a mention count, an unread dot
 * beside an open invitation, and an unclaimed link.
 *
 * ⚠ ORDER IS NEWEST-FIRST WITHIN A WELL, which is `homeRows`' own order: the
 * grouping pass in `WellsColumn` sorts nothing.
 */
const HOME_ROWS: ReadonlyArray<HomeRowMock> = [
  {
    ...QUIET,
    id: "rel:demo-ws-weekly",
    well: "pinned",
    name: "weekly-review",
    // 🔒 A SOLO channel shows its DESCRIPTION where a peopled one shows faces
    // (Samuel, 2026-09-15) — one slot, never both.
    faces: [],
    description: "Friday sweep of the pipeline with the Analyst",
    at: minsAgo(60 * 27),
  },
  {
    ...QUIET,
    id: HOME_ROW_ID,
    well: "recent",
    name: "q4-outbound",
    faces: PEERS,
    // Overwritten per step by `homeRowsAt` — see there.
    at: minsAgo(0),
  },
  {
    ...QUIET,
    id: "rel:demo-ws-renewals",
    well: "recent",
    name: "renewals-q3",
    faces: [PEERS[0]],
    // The `@ N` pill and the dot are EXCLUSIVE — this row takes the louder one.
    mentions: 2,
    at: minsAgo(52),
  },
  {
    ...QUIET,
    id: "rel:demo-ws-acme",
    well: "recent",
    name: "acme-migration",
    faces: [PEERS[1]],
    linkOut: true,
    unread: true,
    at: minsAgo(60 * 5),
  },
  {
    ...QUIET,
    id: "rel:demo-ws-design",
    well: "earlier",
    name: "design-partners",
    faces: PEERS,
    at: minsAgo(60 * 50),
  },
  {
    ...QUIET,
    id: "link:demo-link-1",
    well: "earlier",
    name: "Mira Castellanos",
    faces: [],
    linkOut: true,
    pending: true,
    pendingLine: "Not yet claimed",
    at: minsAgo(60 * 74),
  },
];


/**
 * The list at this beat. ⚠ ONLY the ACTIVE row moves, and only its STAMP: the
 * column visibly tracks the conversation playing in the record pane beside it
 * rather than sitting frozen under a scene that is clearly live.
 *
 * 🔒 **AND IT IS THE STAMP RATHER THAN A PREVIEW, WHICH IS THE PRODUCT'S OWN
 * RULING (Samuel, 2026-09-13: *"having the most recent message being in there
 * just doesn't make sense imo"*).** The row carried the newest message's body
 * until this scene was rebuilt on the real row; `HomeChannelRowFacts` has no slot
 * for it, which is the fence working.
 */
export function homeRowsAt(step: number): HomeRowMock[] {
  const script = messagesAt(step);
  const newest = script[script.length - 1]?.createdAt;
  return HOME_ROWS.map((row) =>
    row.id === HOME_ROW_ID && newest ? { ...row, at: newest } : row,
  );
}
