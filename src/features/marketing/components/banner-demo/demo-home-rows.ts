/**
 * /home's left column — the demo's channel rows. Pure data; the markup is
 * `demo-home-chrome.tsx`.
 *
 * ⚠ ITS OWN FILE, and not a preference: `demo-data.ts` is at the 500-line cap
 * the root lint enforces (`max-lines`), and these rows are the one part of the
 * demo's data that is NOT a product shape. Everything in that file is a real
 * `Channel` / `ChannelMessage` / session row the product's own components are
 * fed; everything here is a flattened mock, because /home's list lives in
 * `apps/desktop-ui/src/pages/home/relationship-list.tsx` — a separate app the
 * Next tree has no import path to (root `tsconfig.json` excludes `apps`). The
 * split is that line, so nobody has to read a docblock to know which half of
 * the scene is honest.
 *
 * ⚠ ONE CLOCK. The stamps come from `demo-data.ts`'s `minsAgo`, anchored once
 * per load — a second `Date.now()` here would drift the list's timestamps off
 * the transcript's by however long the module graph took to evaluate.
 */

import type { AvatarPerson } from "@/shared/ui/avatar";
import { CURRENT_USER_ID, MEMBERS, messagesAt, minsAgo } from "./demo-data";

/**
 * ONE row of /home's channel list, flattened.
 *
 * ⚠ THE FIELDS ARE THE OUTPUTS OF `home-rows.ts`, NOT ITS INPUT. The real list
 * feeds a `HomeChannel` through `channelPeople` / `channelTitle` /
 * `channelSubline` and renders what comes out; the demo has no payload behind
 * it, so it authors the ANSWERS those three give and the row markup consumes
 * them identically. The derivations are what the demo cannot host — the FACE
 * is what it has to be honest about.
 */
export type HomeRowMock = {
  id: string;
  /** Everybody else in the channel. ⚠ EMPTY ⇒ a SOLO channel, which gets a
   *  `Bot` glyph and never invented initials (`relationship-list.tsx`). */
  people: ReadonlyArray<{
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  }>;
  title: string;
  subline: string;
  lastLine: string;
  /** ISO — run through `formatChannelTimestamp`, same as the real row. */
  at: string;
  /** An invitation is out — the row's "Link out" chip. */
  linkOut?: boolean;
  /** An unclaimed LINK row: faded face, secondary title. */
  pending?: boolean;
};

/** The row the scene sits in — `q4-outbound`, the channel the record pane
 *  plays. ⚠ `rel:`-prefixed like the real ids (`home-rows.ts › channelRowId`). */
export const HOME_ROW_ID = "rel:demo-ws-q4";

/**
 * The operator. ONE definition, two mounts: the header's settings face
 * (`home-settings-control.tsx`'s entry) and the agent view's viewer identity.
 * ⚠ `avatarUrl` is a bundled `public/` path, which `useBridgedImageSrc` returns
 * verbatim on the web — no bridge, no request beyond the asset.
 */
export const VIEWER: AvatarPerson = {
  userId: CURRENT_USER_ID,
  email: "srwang@usc.edu",
  displayName: "Samuel Wang",
  avatarUrl: "/img/avatars/sam.jpg",
};

/** ⚠ THE ACTIVE ROW'S FACES ARE THE CHANNEL'S OWN ROSTER, read out of
 *  `MEMBERS` rather than retyped: the stack in the list and the avatars in the
 *  transcript beside it are then the same two people by construction. */
const PEERS = MEMBERS.filter((m) => m.userId !== CURRENT_USER_ID).map((m) => ({
  userId: m.userId,
  // ⚠ `displayName` is nullable on `ChannelMember` and NON-nullable on the
  // avatar stack's user — it feeds both the initials and the hover title — so
  // the fallback happens here, exactly as `relationship-list.tsx` does it.
  displayName: m.displayName || m.email || "Member",
  avatarUrl: m.avatarUrl,
}));

const HOME_ROWS: ReadonlyArray<HomeRowMock> = [
  {
    id: HOME_ROW_ID,
    people: PEERS,
    title: "Priya Shah, Marcus Lee",
    subline: "2 people",
    // Overwritten per step by `homeRowsAt` — see there.
    lastLine: "Fresh list from the conference just landed.",
    at: minsAgo(0),
  },
  {
    id: "rel:demo-ws-grace",
    people: [
      {
        userId: "demo-u-grace",
        displayName: "Grace Okafor",
        avatarUrl: "/img/avatars/grace.jpg",
      },
    ],
    title: "Grace Okafor",
    subline: "grace@vermillion.io",
    lastLine: "Countersigned SOW is in the thread.",
    at: minsAgo(48),
  },
  {
    id: "rel:demo-ws-anthony",
    people: [
      {
        userId: "demo-u-anthony",
        displayName: "Anthony Reyes",
        avatarUrl: "/img/avatars/anthony.jpg",
      },
    ],
    title: "Anthony Reyes",
    subline: "anthony@lattice.build",
    lastLine: "My agent pushed the migration plan.",
    at: minsAgo(60 * 5),
    linkOut: true,
  },
  {
    id: "rel:demo-ws-solo",
    people: [],
    title: "weekly-review",
    subline: "Just you",
    lastLine: "Pipeline Analyst cut the segment.",
    at: minsAgo(60 * 27),
  },
  {
    id: "rel:demo-ws-northwind",
    people: [
      { userId: "demo-u-dana", displayName: "Dana Whitfield", avatarUrl: null },
      { userId: "demo-u-omar", displayName: "Omar Haddad", avatarUrl: null },
      { userId: "demo-u-lin", displayName: "Lin Zhou", avatarUrl: null },
      { userId: "demo-u-rae", displayName: "Rae Duarte", avatarUrl: null },
    ],
    // ⚠ TWO NAMES THEN A COUNT, which is `channelTitle`'s own form — a row is
    // 290px wide and ends in a timestamp, so a third name deletes the first
    // behind an ellipsis instead of shrinking anything.
    title: "Dana Whitfield, Omar Haddad +2",
    subline: "4 people",
    lastLine: "Renewal deck ready for Thursday.",
    at: minsAgo(60 * 50),
  },
  {
    id: "link:demo-link-1",
    people: [],
    title: "Mira Castellanos",
    subline: "dopl.app/c/8f2a…",
    lastLine: "Not yet claimed",
    at: minsAgo(60 * 74),
    linkOut: true,
    pending: true,
  },
];

/**
 * The list at this beat. ⚠ ONLY the ACTIVE row moves: its last line is the
 * transcript's newest message, so the column visibly tracks the conversation
 * playing in the record pane beside it rather than sitting frozen under a
 * scene that is clearly live. Every other row is static — they are other
 * conversations, and nothing is happening in them.
 */
export function homeRowsAt(step: number): HomeRowMock[] {
  const script = messagesAt(step);
  const newest = script[script.length - 1]?.body;
  return HOME_ROWS.map((row) =>
    row.id === HOME_ROW_ID && newest ? { ...row, lastLine: newest } : row,
  );
}
