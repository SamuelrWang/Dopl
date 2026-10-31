"use client";

/** One event over the list: what was sent, every attempt, and sending it again. */
import { RotateCcw } from "lucide-react";
import { Badge, Button, ICON, TwoLine, type Tone } from "../_design/ui";
import { CodeBlock, FigureGrid, GridFigure, Grow, ListRow, SideSheet, Stack, Text } from "../_design/ui-page";
import { STATUS_LABEL, type Call, type CallStatus } from "../_data/activity";
import { since } from "../_components/ui";

export const CALL_TONE: Partial<Record<CallStatus, Tone>> = { ok: "ok", failed: "error", retrying: "warn", expired: "warn" };

export function EventSheet({ call, endpoint, onClose, onRetry }: { call: Call; endpoint: string; onClose: () => void; onRetry: () => void }) {
  const hook = call.webhook!;
  const payload = JSON.stringify({ id: call.id, type: hook.event, created_at: call.at, data: { user_id: call.userId, device_id: call.deviceId } }, null, 2);
  return (
    <SideSheet
      label={hook.event}
      onClose={onClose}
      head={<TwoLine title={<Text kind="title" as="h2">{hook.event}</Text>} sub={endpoint} />}
      foot={
        <Button variant={call.status === "failed" ? "ink" : "secondary"} onClick={onRetry}>
          <RotateCcw {...ICON} aria-hidden="true" />
          Send again
        </Button>
      }
    >
      <FigureGrid>
        <GridFigure label="Status" value={<Badge tone={CALL_TONE[call.status] ?? "neutral"} dot>{STATUS_LABEL[call.status]}</Badge>} />
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
      <CodeBlock title="Payload">{payload}</CodeBlock>
    </SideSheet>
  );
}
