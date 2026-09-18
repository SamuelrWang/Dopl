/**
 * THE SURFACE STUB EVERY home-channel Info-tab TEST MOUNTS, in one place.
 *
 * ⚠ **IT EXISTS BECAUSE FIVE FILES HAD THEIR OWN COPY** and the slot's contract
 * widened under all of them at once (2026-09-15: `ChannelInfoTabContext` gained
 * the Tags inbox, so the home tab could render the section the workspace tab has
 * had since Phase 6). Five hand-written fakes meant five places to teach, and a
 * fake that lags the real context is worse than no fake: it passes while the
 * shipped surface hands the tab something the tab cannot use.
 *
 * ⚠ **THE STUB'S JOB IS THE SLOT, NOT THE SURFACE.** It renders the injected tab
 * and nothing else — no transcript, no panel, no tabs — because these tests are
 * about what the TAB draws when the surface hands it a context.
 *
 * ⚠ **THE CONTEXT TYPE IS IMPORTED, NEVER RE-DECLARED.** Each copy used to spell
 * its own `{ gate: ... }` inline, which is exactly why they all silently went
 * stale: a structural type written by hand cannot fail when the real one grows a
 * required field. Importing it makes the compiler the thing that notices.
 */

import type { ReactNode } from "react";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import type { ChannelInfoTabContext } from "@/features/channels/components/channel-surface";
import type { MentionsBundle } from "@/features/channels/components/mentions-disclosure";
import {
  indexMembers,
  type AuthorIndex,
} from "@/features/channels/components/view-model";
import { useChannelHeaderWrite } from "@/features/channels/hooks/use-channel-header-writes";
import { useChannelMembers } from "@/features/channels/hooks/use-channel-members";
import { useOverviewSeries } from "@/features/workspaces/hooks/use-overview-series";
import type { Channel } from "@/features/channels/types";

/** An author index with nobody in it — enough for a list with no rows. */
const EMPTY_INDEX: AuthorIndex = {
  currentUserId: "u-me",
  byId: new Map(),
  // ⚠ Empty is the WEB tree's own value here, not a test shortcut: agent names
  // are machine-local and only a desktop feed fills this (`view-model.ts`).
  agents: new Map(),
};

/**
 * A Tags inbox with nothing in it: the ordinary case for these tests, which are
 * about the CARD. ⚠ Handlers are no-ops rather than spies — a test that cares
 * about the click passes its own bundle (see `person-info-tab.test.tsx`).
 */
export const EMPTY_MENTIONS: MentionsBundle = {
  mentions: [],
  truncated: false,
  loading: false,
  index: EMPTY_INDEX,
  onOpen: () => {},
  onMarkAllRead: () => {},
};

/**
 * The context the real surface hands its Info-tab slot, with test defaults.
 *
 * ⚠ **THE DEFAULT `headerEdit` IS THE DISPLAY FACE** — `canEdit: false` and two
 * no-ops. A fixture may not be the reason a line becomes editable; the surface
 * stub below mirrors the REAL permission from the channel it is handed, and a
 * suite that wants the other answer passes its own.
 */
export function infoTabContext(
  over: Partial<ChannelInfoTabContext> = {}
): ChannelInfoTabContext {
  return {
    gate: { begin: () => {}, end: () => {} },
    mentions: EMPTY_MENTIONS,
    headerEdit: {
      canEdit: false,
      onSaveName: () => {},
      onSaveTopic: () => {},
      busy: false,
    },
    // ⚠ **THE EMPTY DEFAULTS ARE THE HONEST ONES, AND THE STUB BELOW OVERRIDES
    // EVERY ONE OF THEM FROM A REAL READ (wave 1A).** A fixture that invented a
    // roster or a series here would let a suite pass while the surface handed the
    // tab nothing — which is the failure this whole file exists to prevent.
    members: [],
    index: EMPTY_INDEX,
    activity: { bins: [], loading: false },
    channelName: "",
    ...over,
  };
}

/**
 * The `vi.mock` factory for `channel-surface-standalone`.
 *
 * ⚠ **IT MINTS THE REAL HEADER WRITE, NOT A SPY (2026-09-17).** The click-to-edit
 * rows have to reach `PATCH /api/channels/[channelId]` and ITS cache patches, or
 * "the left column's title updates" is a sentence about a handler nobody wired —
 * the same argument `person-info-tab.test.tsx` makes for mounting through
 * `HomePage` instead of the component. ⚠ **AND IT MIRRORS THE REAL PERMISSION**
 * off the channel it was handed (`surface-info-panel.tsx`'s own expression), so a
 * suite changes the ANSWER by changing the fixture's `role`, not the stub.
 */
export function standaloneSurfaceStub(ctx?: Partial<ChannelInfoTabContext>) {
  return {
    StandaloneChannelSurface: (props: {
      channel: Channel;
      workspaceId: string;
      workspaceSlug?: string;
      currentUserId?: string;
      role?: Role;
      slots?: { infoTab?: (c: ChannelInfoTabContext) => ReactNode };
    }) => {
      const write = useChannelHeaderWrite({
        channelId: props.channel.id,
        workspaceId: props.workspaceId,
        // ⚠ The real surface hands its ONE `useRefetchGate`; these suites mount no
        // realtime loop, so the no-op gate `infoTabContext` already serves is the
        // honest stand-in.
        gate: { begin: () => {}, end: () => {} },
      });
      // 🔒 **THE STUB MAKES THE SURFACE'S READS, BECAUSE THE SLOT'S CONTRACT IS
      // NOW THAT IT HAS ALREADY MADE THEM (wave 1A, 2026-09-17).** `members`,
      // `index` and `activity` reach the tab from `channel-surface-data.ts` in the
      // shipped app; a stub that handed them fixtures would pass every /home case
      // while the real surface fetched nothing — and these suites drive a REAL
      // bridge, so making the calls here keeps them end to end.
      const { members } = useChannelMembers(props.channel.id, props.workspaceId);
      const series = useOverviewSeries({
        workspaceSegment: props.workspaceSlug ?? "",
        metric: "messages",
        channelId: props.channel.id,
        enabled: Boolean(props.workspaceSlug),
      });
      return (
        <div data-testid="channel-surface">
          {props.slots?.infoTab?.(
            infoTabContext({
              headerEdit: {
                canEdit:
                  props.channel.role === "owner" ||
                  meetsMinRole(props.role ?? "member", "admin"),
                onSaveName: write.saveName,
                onSaveTopic: write.saveTopic,
                busy: write.pending,
              },
              members,
              // ⚠ THE VIEWER IS THE HOST'S `currentUserId`, exactly as
              // `derivations.ts › indexMembers` resolves it on the real surface —
              // and it is what stops the roster reporting the operator offline in
              // their own channel (F-723).
              index: indexMembers(members, props.currentUserId ?? ""),
              activity: { bins: series.days, loading: series.loading },
              // 🔒 `peerNamedHeader: false` on every /home mount, so the surface's
              // derived name IS the channel's stored one.
              channelName: props.channel.name,
              ...ctx,
            })
          )}
        </div>
      );
    },
  };
}
