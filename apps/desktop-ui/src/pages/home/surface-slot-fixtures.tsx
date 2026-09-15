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
import type { ChannelInfoTabContext } from "@/features/channels/components/channel-surface";
import type { MentionsBundle } from "@/features/channels/components/mentions-disclosure";
import type { AuthorIndex } from "@/features/channels/components/view-model";

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

/** The context the real surface hands its Info-tab slot, with test defaults. */
export function infoTabContext(
  over: Partial<ChannelInfoTabContext> = {}
): ChannelInfoTabContext {
  return {
    gate: { begin: () => {}, end: () => {} },
    mentions: EMPTY_MENTIONS,
    ...over,
  };
}

/** The `vi.mock` factory for `channel-surface-standalone`. */
export function standaloneSurfaceStub(ctx?: Partial<ChannelInfoTabContext>) {
  return {
    StandaloneChannelSurface: (props: {
      slots?: { infoTab?: (c: ChannelInfoTabContext) => ReactNode };
    }) => (
      <div data-testid="channel-surface">
        {props.slots?.infoTab?.(infoTabContext(ctx))}
      </div>
    ),
  };
}
