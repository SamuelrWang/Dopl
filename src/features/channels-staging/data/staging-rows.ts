/**
 * The column's rows, in the landing demo's own order (`demo-home-rows.ts › HOME_ROWS`), each
 * backed by a full channel fixture (or the link fixture). Built fresh per page mount, so a
 * reload is a reset — everything the page does is in-memory.
 */

import type { HomeRowMock } from "@/features/marketing/components/banner-demo/demo-home-rows";
import { FACE } from "@/features/marketing/components/banner-demo/demo-data";
import { techDebtFixture } from "./tech-debt-fixture";
import {
  apiV2Fixture,
  deploysFixture,
  designReviewFixture,
  flakyTestsFixture,
  miraLinkFixture,
} from "./extra-fixtures";
import { CURRENT_USER_ID } from "./demo-imports";
import type { StagingRow } from "./staging-fixture-types";

export function initialRows(): StagingRow[] {
  return [
    deploysFixture(),
    techDebtFixture(),
    flakyTestsFixture(),
    apiV2Fixture(),
    designReviewFixture(),
    miraLinkFixture(),
  ];
}

/** The channel the page opens on: the demo's own. */
export const INITIAL_ROW_ID = "rel:demo-ws-debt";

/** A fixture → the column row's facts, derived as `demo-home-rows.ts` authors them. */
export function rowFacts(row: StagingRow): HomeRowMock {
  if (row.kind === "link") {
    return {
      id: row.rowId,
      well: row.well,
      name: row.name,
      faces: [],
      description: "",
      linkOut: false,
      invited: true,
      pending: true,
      pendingLine: "Not yet claimed",
      unread: false,
      mentions: 0,
      at: row.link.createdAt,
    };
  }
  const faces = row.members
    .filter((m) => m.userId !== CURRENT_USER_ID)
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName || m.email || "Member",
      avatarUrl: FACE[m.userId as keyof typeof FACE] ?? m.avatarUrl,
    }));
  const newest = row.messages[row.messages.length - 1]?.createdAt ?? row.channel.createdAt;
  return {
    id: row.rowId,
    well: row.favorited && row.well === "pinned" ? "pinned" : row.well,
    name: row.channel.name,
    faces,
    description: faces.length === 0 ? row.channel.topic : "",
    linkOut: false,
    invited: row.invited,
    pending: false,
    pendingLine: null,
    unread: row.unread,
    mentions: row.mentionsPill,
    at: newest,
  };
}
