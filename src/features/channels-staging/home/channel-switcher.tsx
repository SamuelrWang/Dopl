"use client";

/**
 * `/channels`' channel column — the SHARED staging rail
 * (`ui-staging/staging-channel-rail.tsx`), given this page's store so a row selects in
 * place instead of linking to `/playground/channels`.
 *
 * The markup used to be copied here. It moved into the frame on 2026-10-22 when the
 * picker became frame-level on every face (Samuel: the picker and the New channel button
 * belong on all five pages), so there is ONE copy of
 * `marketing/components/banner-demo/demo-home-faces.tsx › DemoChannelSwitcher` in staging,
 * not two. Behaviour here is unchanged: rows select, well headings toggle.
 */

import {
  StagingChannelRail,
} from "@/features/ui-staging/staging-channel-rail";
import type { HomeRowMock } from "@/features/marketing/components/banner-demo/demo-home-rows";

export function StagingChannelSwitcher({
  rows,
  selectedId,
  onSelect,
}: {
  rows: HomeRowMock[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <StagingChannelRail rows={rows} selectedId={selectedId} onSelect={onSelect} />
  );
}
