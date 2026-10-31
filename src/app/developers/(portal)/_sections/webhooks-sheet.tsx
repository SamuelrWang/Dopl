"use client";

/** One event over the list: what was sent, every attempt, and sending it again. */
import { RotateCcw } from "lucide-react";
import type { Call } from "@/features/device-sdk/portal/view";
import { Button, ICON, TwoLine } from "../_design/ui";
import { SideSheet } from "../_design/ui-overlay";
import { CodeBlock, FigureGrid, GridFigure, Text } from "../_design/ui-page";
import { since } from "../_components/format";
import { AttemptList } from "./activity-detail";
import { CallStatusBadge } from "./activity-parts";

export function EventSheet({ call, canManage, busy, onClose, onRetry }: { call: Call; canManage: boolean; busy: boolean; onClose: () => void; onRetry: () => void }) {
  const hook = call.webhook!;
  return (
    <SideSheet
      label={hook.event}
      onClose={onClose}
      head={<TwoLine title={<Text kind="title" as="h2">{hook.event}</Text>} sub={hook.endpointName} />}
      foot={
        canManage && (
          <Button variant={call.status === "failed" ? "ink" : "secondary"} loading={busy} onClick={onRetry}>
            <RotateCcw {...ICON} aria-hidden="true" />
            Send again
          </Button>
        )
      }
    >
      <FigureGrid>
        <GridFigure label="Status" value={<CallStatusBadge status={call.status} />} />
        <GridFigure label="Attempts" value={hook.attempts.length} />
        <GridFigure label="Sent" value={since(call.at)} />
      </FigureGrid>
      <AttemptList attempts={hook.attempts} />
      {hook.payload != null && <CodeBlock title="Payload">{JSON.stringify(hook.payload, null, 2)}</CodeBlock>}
    </SideSheet>
  );
}
