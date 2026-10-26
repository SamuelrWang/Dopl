"use client";

/**
 * /channels — the LANDING DEMO'S CHANNEL FACE (`marketing/components/banner-demo/`), fully
 * revealed and clickable, inside the staging window (`ui-staging/staging-frame.tsx`). Mounted
 * by `src/app/channels/page.tsx` and the public alias `src/app/playground/channels/page.tsx`.
 *
 * ⚠ CLIENT-ONLY CONTENT: the demo's clock is `Date.now()` at module load
 * (`demo-data.ts › minsAgo`), so a server pass would print different stamps than the client
 * and hydration would throw. The server paints the empty window; the column and pane mount
 * after hydration.
 */

import { useEffect, useRef, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { StagingChannelSwitcher } from "./home/channel-switcher";
import { StagingChannelScene } from "./home/channel-scene";
import { PendingLinkCard } from "@/features/popups-staging/pages/home/link-out-panel";
import {
  onStagingChannelCreated,
  onStagingLinkRevoked,
} from "@/features/popups-staging/stubs/home-writes";
import { rowFacts } from "./data/staging-rows";
import { seedChannel, stagingQueryClient } from "./data/staging-query-seed";
import { useStagingChannels } from "./store/use-staging-channels";
import { initialRows } from "./data/staging-rows";
import { useStagingTasks } from "./store/use-staging-tasks";

function Mounted() {
  const [qc] = useState(() =>
    stagingQueryClient(
      initialRows().flatMap((r) => (r.kind === "channel" ? [r.channel.id] : []))
    )
  );
  const store = useStagingChannels((id) => seedChannel(qc, id));
  const { selected, fixture, createChannel, revokeLink } = store;
  // STAGING (2026-10-26, channel tasks): the product Tasks tab and quick view read this.
  const tasksApi = useStagingTasks(store.rows);

  // The frame's "New channel" pill and a link card's Revoke are the shared popups-staging copies
  // (1:1 with desktop); their stubbed writes report here so the column gains / drops the row.
  const latest = useRef({ createChannel, revokeLink });
  useEffect(() => {
    latest.current = { createChannel, revokeLink };
  });
  useEffect(() => {
    const offCreate = onStagingChannelCreated(({ name, topic }) =>
      latest.current.createChannel({ name, topic })
    );
    const offRevoke = onStagingLinkRevoked((id) => latest.current.revokeLink(id));
    return () => {
      offCreate();
      offRevoke();
    };
  }, []);

  return (
    <QueryClientProvider client={qc}>
      <StagingFrame
        tab="channels"
        /* Channels-only surface swap (Samuel, 2026-10-24): white pane, tinted shell.
           `ui-staging/staging.css › .uis-ch-pane`. */
        recordClassName="uis-ch-pane"
        channelColumn={
          <StagingChannelSwitcher
            rows={store.rows.map(rowFacts)}
            selectedId={store.selectedId}
            onSelect={store.select}
          />
        }
      >
        {fixture ? (
          <StagingChannelScene
            fixture={fixture}
            thread={store.thread}
            openAgentKey={store.openAgentKey}
            infoOpen={store.infoOpen}
            scrollTarget={store.scrollTarget}
            actions={store.actions}
            agentsVersion={store.agentsVersion}
            tasks={{
              list: tasksApi.tasksFor(fixture.channel.id),
              onSetStatus: (id, status) => tasksApi.setStatus(fixture.channel.id, id, status),
              onToggleSubtask: (id, sub) => tasksApi.toggleSubtask(fixture.channel.id, id, sub),
              onAddNote: (id, body) => tasksApi.addNote(fixture.channel.id, id, body),
            }}
          />
        ) : selected?.kind === "link" ? (
          <PendingLinkCard key={selected.rowId} link={selected.link} />
        ) : null}
      </StagingFrame>
    </QueryClientProvider>
  );
}

export function StagingChannelsPage() {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag
  useEffect(() => setMounted(true), []);
  if (!mounted) return <StagingFrame tab="channels">{null}</StagingFrame>;
  return <Mounted />;
}
