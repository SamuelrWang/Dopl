/**
 * /home's left column: the demo's channel rows and which well each sits in.
 * Pure data; the markup is `demo-home-faces.tsx › DemoChannelSwitcher`.
 *
 * Its own file because these rows are the one part of the demo's data that is NOT
 * a wire shape — everything in `demo-data.ts` is a real product shape, and these
 * are a flattened stand-in for what `GET /api/channels?scope=account` answers.
 *
 * The fields are `HomeChannelRowFacts` (`shared/ui/home-channel-row.tsx`) — the
 * OUTPUTS of /home's row derivations, not their input. The demo has no payload
 * behind it, so it authors those answers.
 *
 * The well is authored here too, the one honest difference:
 * `channel-wells.ts › channelWellOf` reads `myFavoritedAt` and a 24h cut, which
 * the demo has neither of. The well id SET is still the product's own, so a
 * fourth or renamed well reaches this scene without an edit.
 *
 * One clock: the stamps come from `demo-data.ts`'s `minsAgo`, anchored once per
 * load, or the list's timestamps would drift off the transcript's.
 */

import type { HomeChannelWellId } from "@/features/channels/components/home-channel-wells";
import type { HomeChannelRowFacts } from "@/shared/ui/home-channel-row";
import type { AvatarPerson } from "@/shared/ui/avatar";
import {
  CHANNEL_NAME,
  CURRENT_USER_ID,
  FACE,
  MEMBERS,
  minsAgo,
} from "./demo-data";
import {
  messagesAt,
} from "./demo-transcript";

/** One row of /home's channel list: what it says, and which well it is filed in. */
export type HomeRowMock = HomeChannelRowFacts & {
  id: string;
  well: HomeChannelWellId;
  /** Landing-only: an "Invited" pill at line two's far right, where the `@ N`
   *  pill sits (Samuel, 2026-10-15), in place of the product's "Link out" chip. */
  invited?: boolean;
};

/** The row the scene sits in — the channel the record pane plays.
 *  `rel:`-prefixed like the real ids (`home-rows.ts › channelRowId`). */
export const HOME_ROW_ID = "rel:demo-ws-debt";

/**
 * The operator: the agent view's viewer identity and the top bar's Profile pill.
 * `avatarUrl` is a bundled `public/` path, which `useBridgedImageSrc` returns
 * verbatim on the web.
 */
export const VIEWER: AvatarPerson = {
  userId: CURRENT_USER_ID,
  email: "daniel@vermillion.io",
  displayName: "Daniel Ortiz",
  avatarUrl: "/img/avatars/daniel.jpg",
};

/**
 * The active row's faces are the channel's own roster, read out of `MEMBERS`
 * rather than retyped, so the stack in the list and the avatars in the transcript
 * are the same two people by construction.
 *
 * (2026-09-17) Every face in this column is a photograph. No row carries more
 * faces than there are photographs, so neither the initials fallback nor the `+N`
 * overflow can appear.
 *
 * `displayName` is nullable on `ChannelMember` and non-nullable on the row's
 * face, so the resolution happens here as `relationship-list.tsx` does it.
 */
const PEERS = MEMBERS.filter((m) => m.userId !== CURRENT_USER_ID).map((m) => ({
  userId: m.userId,
  displayName: m.displayName || m.email || "Member",
  // Read off `FACE`, not the row, so a member that loses its photo fails the
  // lookup here instead of silently degrading to initials.
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
 * The list, one row per case the real column can draw: a pinned solo channel (its
 * description takes line two), the live one, a mention count, an unread dot beside
 * an open invitation, and an unclaimed link.
 *
 * Order is newest-first within a well, which is `homeRows`' own order — the
 * grouping pass in `WellsColumn` sorts nothing.
 */
const HOME_ROWS: ReadonlyArray<HomeRowMock> = [
  {
    ...QUIET,
    id: "rel:demo-ws-weekly",
    well: "pinned",
    name: "deploys",
    // (2026-09-15) A solo channel shows its description where a peopled one
    // shows faces — one slot, never both.
    faces: [],
    description: "Build and release notices",
    at: minsAgo(60 * 27),
  },
  {
    ...QUIET,
    id: HOME_ROW_ID,
    well: "recent",
    // ⚠ THE SAME NAME THE PANE'S HEADER AND EVERY SESSION ROW CARRY. It is spelled
    // once in `demo-data.ts`; a literal here is what left the column reading
    // `q4-outbound` beside a pane reading `tech-debt` after the v3 rewrite, which the
    // thread mount probe caught.
    name: CHANNEL_NAME,
    faces: PEERS,
    // Overwritten per step by `homeRowsAt` — see there.
    at: minsAgo(0),
  },
  {
    ...QUIET,
    id: "rel:demo-ws-flakes",
    well: "recent",
    name: "flaky-tests",
    faces: [PEERS[0]],
    // The `@ N` pill and the dot are EXCLUSIVE — this row takes the louder one.
    mentions: 2,
    at: minsAgo(52),
  },
  {
    ...QUIET,
    id: "rel:demo-ws-apiv2",
    well: "recent",
    name: "api-v2-migration",
    faces: [PEERS[1]],
    invited: true,
    unread: true,
    at: minsAgo(60 * 5),
  },
  {
    ...QUIET,
    id: "rel:demo-ws-design",
    well: "earlier",
    name: "design-review",
    faces: PEERS,
    at: minsAgo(60 * 50),
  },
  {
    ...QUIET,
    id: "link:demo-link-1",
    well: "earlier",
    name: "Mira Castellanos",
    faces: [],
    invited: true,
    pending: true,
    pendingLine: "Not yet claimed",
    at: minsAgo(60 * 74),
  },
];


/**
 * The list at this beat. Only the ACTIVE row moves, and only its stamp, so the
 * column tracks the conversation playing beside it rather than sitting frozen.
 *
 * (2026-09-13) The stamp rather than a message preview:
 * `HomeChannelRowFacts` has no slot for a preview, which is the fence working.
 */
export function homeRowsAt(step: number): HomeRowMock[] {
  const script = messagesAt(step);
  const newest = script[script.length - 1]?.createdAt;
  return HOME_ROWS.map((row) =>
    row.id === HOME_ROW_ID && newest ? { ...row, at: newest } : row,
  );
}
