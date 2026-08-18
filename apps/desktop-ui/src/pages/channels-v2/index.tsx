import { useState } from "react";
import { ChannelsV2Sidebar } from "./sidebar";
import { ChannelsV2MessagePane, type ScrollTarget } from "./message-pane";
import { ChannelsV2InfoPanel } from "./info-panel";
import { ChannelsV2AgentPanel } from "./agent-panel";
import { INITIALLY_READ_MENTIONS, MENTIONS, type MockMention } from "./mock-mentions";

/**
 * /:workspaceSegment/channels-v2 — a DESIGN-REVIEW page, not a feature.
 *
 * A parallel take on the channels surface as a three-column layout (channel
 * tree · transcript · channel info) so the proportions can be judged live in
 * the real shell. It is deliberately INERT:
 *
 * - **No data layer.** Every row comes from `mock-data.ts`. No `useApiQuery`,
 *   no mutations, no realtime, no `window.dopl`. Nothing here can fail, so
 *   there is no loading or error branch to render.
 * - **Four pieces of local state here, no more.** `openThread` (the center
 *   pane's channel-view ↔ thread-view switch), `openAgent` (the agent view
 *   sliding over the info panel), `readMentions` (the Tags inbox's read-state —
 *   the Info tab writes it, its badge derives from it) and `scrollTarget` (the
 *   transcript's scroll-to-message signal; NONCED so re-clicking the same
 *   mention re-scrolls instead of being swallowed by state equality).
 *   Everything else — the info panel's active tab, the thread filter, the
 *   composer's agent panel — stays local to the component that owns it.
 *   Nothing is fetched or persisted.
 * - **Nothing is wired to the shipping page.** `#/pages/channels` and the whole
 *   `@/features/channels` tree are untouched; if this design wins, the port is
 *   a separate change and this folder is deleted.
 *
 * `openThread` is the id of a `THREADS` row (null = channel view). It is lifted
 * here because all THREE columns share it: the right panel's Threads tab, the
 * sidebar's nested thread rows and the transcript's posted thread card all SET
 * it, the center pane READS it, and the sidebar reads it back to decide which
 * row is selected. The center column both reads and sets it — a thread card in
 * the channel view is how you walk INTO the thread view. See MAPPING.md for how
 * it maps onto `channel_tasks`.
 *
 * `openAgent` is the id of a `MY_AGENTS` row (null = closed). It is lifted for
 * the same reason: the right panel's Agents tab SETS it and reads it back to
 * mark a card "Viewing", while the agent view itself renders at PAGE level, as
 * an overlay over that column rather than inside it. The panel can also set
 * `openThread` — its header names the thread and walking there is one click.
 *
 * It has a TEMPORARY "Channels v2" nav row (`AppSidebarCore` NAV) so it can be
 * reviewed by click; that row, the routes.tsx row, the deep-link table row and
 * this folder all leave together when the design lands or dies.
 */
export default function ChannelsV2Page() {
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [readMentions, setReadMentions] = useState<ReadonlySet<string>>(
    INITIALLY_READ_MENTIONS
  );
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);

  // The Tags inbox's click: mark read, land the center pane on the right
  // transcript (thread or channel), then signal the scroll. The scroll effect
  // runs POST-render, so the swapped transcript is in the DOM before it looks
  // for the message row.
  const openMention = (mention: MockMention) => {
    setReadMentions((prev) => new Set(prev).add(mention.id));
    setOpenThread(mention.threadId);
    setScrollTarget((prev) => ({
      messageId: mention.messageId,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  };

  const markAllMentionsRead = () =>
    setReadMentions(new Set(MENTIONS.map((m) => m.id)));

  return (
    // `relative` is the agent view's containing block: it is absolutely
    // positioned against this surface, and `.page-float`'s `overflow: hidden`
    // clips it to the page card's radius on the way in and out.
    <div className="page-float relative flex antialiased">
      <ChannelsV2Sidebar openThread={openThread} onOpenThread={setOpenThread} />
      <ChannelsV2MessagePane
        openThread={openThread}
        onExitThread={() => setOpenThread(null)}
        onOpenThread={setOpenThread}
        scrollTarget={scrollTarget}
      />
      <ChannelsV2InfoPanel
        openThread={openThread}
        onOpenThread={setOpenThread}
        openAgent={openAgent}
        onOpenAgent={setOpenAgent}
        readMentions={readMentions}
        onOpenMention={openMention}
        onMarkAllMentionsRead={markAllMentionsRead}
      />
      <ChannelsV2AgentPanel
        openAgent={openAgent}
        onClose={() => setOpenAgent(null)}
        onOpenThread={setOpenThread}
      />
    </div>
  );
}
