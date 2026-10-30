"use client";

/** Activity: every delivery, request and webhook, with the timeline side panel for one call. */
import { useState } from "react";
import { CallList, CallPanel } from "../_components/calls";
import { useCalls } from "../_components/portal-store";
import { PortalPage } from "../_components/ui";

export function ActivitySection({ initial }: { initial: { call?: string; user?: string; device?: string; status?: string } }) {
  const calls = useCalls();
  const [open, setOpen] = useState<string | null>(initial.call ?? null);
  const call = open ? calls.find((c) => c.id === open || c.requestId === open) : null;
  return (
    <PortalPage title="Activity" meta={<span>{calls.length} recent calls</span>} aside={call ? <CallPanel call={call} onClose={() => setOpen(null)} /> : undefined}>
      <CallList calls={calls} selected={call?.id ?? null} onOpen={setOpen} kinds initial={initial} />
    </PortalPage>
  );
}
