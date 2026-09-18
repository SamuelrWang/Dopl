/**
 * THE SURFACE STUB EVERY home-channel Info-tab TEST MOUNTS, in one place — five
 * files had their own copy, and the slot's contract widened under all of them at
 * once (2026-09-15). A fake that lags the real context is worse than no fake: it
 * passes while the shipped surface hands the tab something it cannot use, which
 * is why the context TYPE is imported here and never re-declared.
 *
 * 🔒 IT RENDERS THE REAL `info-tab.tsx › InfoTab` SINCE WAVE 1A (2026-09-17).
 * There is one Info body now and a host may only ADD to it, so the stub's job is
 * the real surface's: make the reads, mint the writes, pass the capabilities,
 * hand the host's region to the shared body.
 *
 * ⚠ THE READS ARE REAL, against the suites' own bridge — the exact calls
 * `channel-surface-data.ts` / `surface-info-panel.tsx` make with the exact same
 * arguments. A stub that handed fixtures down would pass while the shipped
 * surface fetched nothing.
 * ⚠ WHAT IT STILL DOES NOT MOUNT: the transcript, the tab row, the header, the
 * agent view. Those have their own suites (`channel-surface.test.tsx`).
 */

import type { Role } from "@/features/workspaces/types";
import { canManageChannelHere } from "@/features/channels/lib/channel-manage-gate";
import { InfoTab } from "@/features/channels/components/info-tab";
import type {
  ChannelInfoExtras,
  ChannelInfoTabContext,
  ChannelSurfaceCapabilities,
} from "@/features/channels/components/channel-surface-contract";
import type { MentionsBundle } from "@/features/channels/components/mentions-disclosure";
import {
  indexMembers,
  type AuthorIndex,
} from "@/features/channels/components/view-model";
import { useChannelHeaderWrite } from "@/features/channels/hooks/use-channel-header-writes";
import { useChannelInfoCardWrite } from "@/features/channels/hooks/use-channel-info-card-writes";
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

/** A Tags inbox with nothing in it — the ordinary case. Handlers are no-ops; a
 *  test that cares about the click passes its own bundle. */
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
 * ⚠ The default `headerEdit` is the DISPLAY face: a fixture may not be the
 * reason a line becomes editable. The stub below mirrors the REAL permission.
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
    // ⚠ Empty is the honest default, and the stub below overrides every one of
    // these from a REAL read: a fixture that invented a roster or a series would
    // let a suite pass while the surface handed the tab nothing.
    members: [],
    refetchMembers: () => {},
    index: EMPTY_INDEX,
    activity: { bins: [], loading: false },
    channelName: "",
    ...over,
  };
}

/**
 * The `vi.mock` factory for `channel-surface-standalone`.
 * ⚠ It mints the REAL header write, not a spy (2026-09-17): the click-to-edit
 * rows have to reach `PATCH /api/channels/[channelId]` and its cache patches, or
 * "the left column's title updates" is a sentence about a handler nobody wired.
 */
export function standaloneSurfaceStub(ctx?: Partial<ChannelInfoTabContext>) {
  return {
    StandaloneChannelSurface: (props: {
      channel: Channel;
      workspaceId: string;
      workspaceSlug?: string;
      currentUserId?: string;
      role?: Role;
      slots?: { infoExtras?: (c: ChannelInfoTabContext) => ChannelInfoExtras };
      capabilities?: ChannelSurfaceCapabilities;
    }) => {
      const write = useChannelHeaderWrite({
        channelId: props.channel.id,
        workspaceId: props.workspaceId,
        // These suites mount no realtime loop, so the no-op gate is honest.
        gate: { begin: () => {}, end: () => {} },
      });
      // ⚠ MEMBERSHIP-gated, not MANAGE-gated — `surface-info-panel.tsx` passes
      // this unconditionally, so the curated rows are drawn on every host.
      const card = useChannelInfoCardWrite({
        channelId: props.channel.id,
        workspaceId: props.workspaceId,
        gate: { begin: () => {}, end: () => {} },
      });
      const { members, refetch } = useChannelMembers(
        props.channel.id,
        props.workspaceId
      );
      const series = useOverviewSeries({
        workspaceSegment: props.workspaceSlug ?? "",
        metric: "messages",
        channelId: props.channel.id,
        enabled: Boolean(props.workspaceSlug),
      });
      const resolved = infoTabContext({
        headerEdit: {
          // ⚠ THE REAL PERMISSION, through the surface's own predicate, so a
          // suite changes the ANSWER by changing the fixture's `role`.
          canEdit: canManageChannelHere(props.channel, props.role ?? "member"),
          onSaveName: write.saveName,
          onSaveTopic: write.saveTopic,
          busy: write.pending,
        },
        members,
        // ⚠ THE REAL REFETCH, for the same reason the roster above is real: a
        // region's write (R-09's Remove) settles the surface's read, not one of
        // its own.
        refetchMembers: () => void refetch(),
        // ⚠ The viewer is the host's `currentUserId`, exactly as the real
        // surface resolves it — and it is what stops the roster reporting the
        // operator offline in their own channel (F-723).
        index: indexMembers(members, props.currentUserId ?? ""),
        activity: { bins: series.days, loading: series.loading },
        // 🔒 `peerNamedHeader: false` on every /home mount, so the derived name
        // IS the channel's stored one.
        channelName: props.channel.name,
        ...ctx,
      });
      return (
        // ⚠ The `data-*` attributes are `index.test.tsx`'s — it kept an inline
        // stub of its own until wave 1A, the sixth copy this module prevents.
        // They say what the HOST mounted the surface on, which is a different
        // question from what the tab draws.
        <div
          data-testid="channel-surface"
          data-workspace={props.workspaceId}
          data-slug={props.workspaceSlug}
          data-channel={props.channel.id}
          data-user={props.currentUserId}
          data-member-management={String(props.capabilities?.memberManagement)}
        >
          <InfoTab
            channel={props.channel}
            channelName={resolved.channelName}
            activityBins={resolved.activity.bins}
            activityLoading={resolved.activity.loading}
            members={resolved.members}
            mentions={resolved.mentions.mentions}
            mentionsTruncated={resolved.mentions.truncated}
            mentionsLoading={resolved.mentions.loading}
            mentionsLayout={props.capabilities?.mentionsLayout}
            index={resolved.index}
            onOpenMention={resolved.mentions.onOpen}
            onMarkAllMentionsRead={resolved.mentions.onMarkAllRead}
            headerEdit={resolved.headerEdit}
            infoCardEdit={{ onSave: card.save }}
            // The derivation `surface-info-panel.tsx` makes.
            rosterEmptyLine={props.capabilities?.memberManagement !== false}
            extras={props.slots?.infoExtras?.(resolved)}
          />
        </div>
      );
    },
  };
}
