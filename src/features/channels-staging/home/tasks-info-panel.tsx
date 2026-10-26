"use client";

/**
 * STAGING (new 2026-10-26, channel tasks) — the channel's right column with a fifth tab, Tasks,
 * after Info / Threads / Agents / Settings: the FULL view (active + resolved). Round 2 (Samuel,
 * 2026-10-26: "have both") keeps it always on beside the composer's quick view
 * (`./tasks-popover.tsx`), whose rows switch here through `tasksSignal`.
 *
 * Not a copy of `channels/components/info-panel.tsx`: it draws its OWN tab row (the product's
 * `SegmentedControl`, same size, variant and counts via the product's exported
 * `channelPaneTabs` / `tabCount` / `activeAgentCount`) and mounts the product panel in its
 * single-column mode (`fullTab`) for the four product tabs, so their bodies stay the product's.
 * The Tasks body is `./task-list.tsx`. With `tasks` absent this is the product panel unchanged.
 *
 * Port = add `{ key: "tasks", label: "Tasks" }` to `info-panel-tabs.ts › TABS`, its count to
 * `tabCount`, and a tasks branch to `info-panel.tsx`'s body. ⚠ That file's own note says the
 * 380px row fits four tabs; this one squeezes five (`overflow-x-auto` scrolls if it must).
 * Known delta: the Threads tab keeps its label when the body flips to its Artifacts face here,
 * because that face's state lives inside the product panel.
 */

import { useState, type ComponentProps, type ReactNode } from "react";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { Crossfade } from "@/shared/ui/crossfade";
import { ChannelsInfoPanel } from "@/features/channels/components/info-panel";
import {
  channelPaneTabs,
  tabCount,
  type TabKey,
} from "@/features/channels/components/info-panel-tabs";
import { activeAgentCount } from "@/features/channels/components/agents-model";

type PanelProps = ComponentProps<typeof ChannelsInfoPanel>;
type StagingTab = TabKey | "tasks";

export function StagingInfoPanel({
  tasks,
  taskCount,
  tasksSignal = 0,
  ...panel
}: PanelProps & {
  /** The Tasks tab's body; absent draws the product panel as it is. */
  tasks?: ReactNode;
  /** Active (unresolved) tasks, the tab's badge. */
  taskCount?: number;
  /** Nonce (round 2): each change switches to Tasks — the quick view's row / "See all". */
  tasksSignal?: number;
}) {
  // Two pieces: the product tab last picked (it keeps rendering while Tasks fades in) and
  // whether Tasks is on. The product panel's own Crossfade fades between its four.
  const [productTab, setProductTab] = useState<TabKey>("info");
  const [onTasks, setOnTasks] = useState(false);
  // Render-time idiom, as the product's `infoTabSignal`: a nonce, so asking twice works twice.
  const [seenSignal, setSeenSignal] = useState(tasksSignal);
  if (tasksSignal !== seenSignal) {
    setSeenSignal(tasksSignal);
    setOnTasks(true);
  }
  if (tasks === undefined) return <ChannelsInfoPanel {...panel} />;

  const threadView = panel.openThread !== null;
  const options = [...channelPaneTabs(threadView), { key: "tasks" as const, label: "Tasks" }];
  // Opening a thread drops Threads; fall back to Info during render, as the product does.
  const shownProduct: TabKey = options.some((o) => o.key === productTab) ? productTab : "info";
  const active: StagingTab = onTasks ? "tasks" : shownProduct;
  const pick = (next: StagingTab) => {
    setOnTasks(next === "tasks");
    if (next !== "tasks") setProductTab(next);
  };
  const agentCount =
    panel.agentSessions === null
      ? undefined
      : activeAgentCount(
          panel.agentSessions,
          panel.peerSessions ?? [],
          panel.channel.id,
          panel.index.currentUserId,
          panel.openThread?.id ?? null
        );

  return (
    <aside
      aria-label="Channel info"
      className="flex w-[var(--info-w,380px)] shrink-0 flex-col border-l border-border-default"
    >
      <div className="flex h-[56px] shrink-0 items-center px-3">
        <SegmentedControl<StagingTab>
          options={options.map((o) => ({
            ...o,
            count:
              o.key === "tasks" ? taskCount : tabCount(o.key, panel.threads, agentCount),
          }))}
          value={active}
          onChange={pick}
          size="lg"
          variant="underline"
          className="min-w-0 flex-1 overflow-x-auto"
        />
      </div>
      <Crossfade token={onTasks ? "tasks" : "product"} className="flex min-h-0 flex-1 flex-col">
        {(shown) =>
          shown === "tasks" ? (
            <div className="uis-tk-tab">{tasks}</div>
          ) : (
            <ChannelsInfoPanel {...panel} fullTab={shownProduct} />
          )
        }
      </Crossfade>
    </aside>
  );
}
