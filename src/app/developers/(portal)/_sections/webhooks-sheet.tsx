"use client";

/** One event over the list: what was sent, every attempt, and sending it again. */
import { RotateCcw } from "lucide-react";
import { STATUS_LABEL, type Call } from "@/features/device-sdk/portal/view";
import { Badge, Button, ICON, TwoLine } from "../_design/ui";
import { CodeBlock, FigureGrid, GridFigure, Grow, ListRow, SideSheet, Stack, Text } from "../_design/ui-page";
import { since } from "../_components/format";
import { STATUS_TONE } from "./activity";

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
        <GridFigure label="Status" value={<Badge tone={STATUS_TONE[call.status] ?? "neutral"} dot>{STATUS_LABEL[call.status]}</Badge>} />
        <GridFigure label="Attempts" value={hook.attempts.length} />
        <GridFigure label="Sent" value={since(call.at)} />
      </FigureGrid>
      <Stack>
        <Text kind="strong" as="h3">
          Attempts
        </Text>
        <div>
          {hook.attempts.map((a, i) => (
            <ListRow key={a.at + i} line={i < hook.attempts.length - 1}>
              <Badge tone={a.status && a.status < 300 ? "ok" : "error"}>{a.status ?? "No reply"}</Badge>
              <TwoLine strong={false} title={a.note} />
              <Grow />
              <Text kind="smallMuted" nowrap>
                {since(a.at)}
              </Text>
            </ListRow>
          ))}
        </div>
      </Stack>
      {hook.payload != null && <CodeBlock title="Payload">{JSON.stringify(hook.payload, null, 2)}</CodeBlock>}
    </SideSheet>
  );
}
