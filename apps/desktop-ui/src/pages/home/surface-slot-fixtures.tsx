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
 * 🔒 **IT RENDERS THE REAL `info-tab.tsx › InfoTab` SINCE WAVE 1A (2026-09-17),
 * AND THAT IS THE WHOLE CHANGE.** It used to render whatever body the host
 * injected, because /home injected one; there is one Info body now and a host
 * may only ADD to it (`ChannelInfoExtras`). So the stub's job is what the real
 * surface's job is: **make the reads, mint the writes, pass the capabilities,
 * and hand the host's region to the shared body.** Every /home case below it
 * therefore asserts what the SHARED body puts on screen when the /home host
 * mounts it — which is the property those cases were always meant to be about.
 *
 * ⚠ **THE READS ARE REAL, AGAINST THE SUITES' OWN BRIDGE.** `useChannelMembers`,
 * `useOverviewSeries` and the two writes are the exact calls
 * `channel-surface-data.ts` / `surface-info-panel.tsx` make with the exact same
 * arguments. A stub that handed fixtures down would pass every case while the
 * shipped surface fetched nothing.
 *
 * ⚠ **WHAT IT STILL DOES NOT MOUNT: the transcript, the tab row, the header, the
 * agent view.** Those have their own suites (`channel-surface.test.tsx`), and a
 * stub that grew into the surface would make these files about the surface.
 *
 * ⚠ **THE CONTEXT TYPE IS IMPORTED, NEVER RE-DECLARED.** Each copy used to spell
 * its own `{ gate: ... }` inline, which is exactly why they all silently went
 * stale: a structural type written by hand cannot fail when the real one grows a
 * required field. Importing it makes the compiler the thing that notices.
 */

import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { InfoTab } from "@/features/channels/components/info-tab";
import type {
  ChannelInfoExtras,
  ChannelInfoTabContext,
  ChannelSurfaceCapabilities,
} from "@/features/channels/components/channel-surface";
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

/**
 * A Tags inbox with nothing in it: the ordinary case for these tests, which are
 * about the CARD. ⚠ Handlers are no-ops rather than spies — a test that cares
 * about the click passes its own bundle (see `home-info-tab.test.tsx`).
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
 * the same argument `home-info-tab.test.tsx` makes for mounting through
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
      slots?: { infoExtras?: (c: ChannelInfoTabContext) => ChannelInfoExtras };
      capabilities?: ChannelSurfaceCapabilities;
    }) => {
      const write = useChannelHeaderWrite({
        channelId: props.channel.id,
        workspaceId: props.workspaceId,
        // ⚠ The real surface hands its ONE `useRefetchGate`; these suites mount no
        // realtime loop, so the no-op gate `infoTabContext` already serves is the
        // honest stand-in.
        gate: { begin: () => {}, end: () => {} },
      });
      // ⚠ **MEMBERSHIP-GATED, NOT MANAGE-GATED** — `surface-info-panel.tsx` mints
      // this from the same gate and passes it unconditionally, so the curated
      // rows and their hover × are drawn on every product host.
      const card = useChannelInfoCardWrite({
        channelId: props.channel.id,
        workspaceId: props.workspaceId,
        gate: { begin: () => {}, end: () => {} },
      });
      const { members } = useChannelMembers(props.channel.id, props.workspaceId);
      const series = useOverviewSeries({
        workspaceSegment: props.workspaceSlug ?? "",
        metric: "messages",
        channelId: props.channel.id,
        enabled: Boolean(props.workspaceSlug),
      });
      const resolved = infoTabContext({
        headerEdit: {
          // ⚠ THE REAL PERMISSION, off the channel this stub was handed
          // (`surface-info-panel.tsx`'s own expression), so a suite changes the
          // ANSWER by changing the fixture's `role`, not the stub.
          canEdit:
            props.channel.role === "owner" ||
            meetsMinRole(props.role ?? "member", "admin"),
          onSaveName: write.saveName,
          onSaveTopic: write.saveTopic,
          busy: write.pending,
        },
        members,
        // ⚠ THE VIEWER IS THE HOST'S `currentUserId`, exactly as
        // `derivations.ts › indexMembers` resolves it on the real surface — and
        // it is what stops the roster reporting the operator offline in their
        // own channel (F-723).
        index: indexMembers(members, props.currentUserId ?? ""),
        activity: { bins: series.days, loading: series.loading },
        // 🔒 `peerNamedHeader: false` on every /home mount, so the surface's
        // derived name IS the channel's stored one.
        channelName: props.channel.name,
        ...ctx,
      });
      return (
        // ⚠ **THE `data-*` ATTRIBUTES ARE `index.test.tsx`'s** — that file kept
        // an inline stub of its own until wave 1A, which is the sixth copy this
        // module exists to prevent. They say WHAT THE HOST MOUNTED THE SURFACE
        // ON, which is a different question from what the tab draws, and the two
        // are answered by one stub rather than two.
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
            // The derivation `surface-info-panel.tsx` makes — /home passes
            // `memberManagement: false`, so "No members in this channel." is a
            // sentence that could only ever flash falsely here.
            rosterEmptyLine={props.capabilities?.memberManagement !== false}
            extras={props.slots?.infoExtras?.(resolved)}
          />
        </div>
      );
    },
  };
}
