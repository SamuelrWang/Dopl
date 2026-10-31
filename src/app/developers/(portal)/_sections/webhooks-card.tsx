"use client";

/** An endpoint: where it points, its health, what it listens to, what to do about it. */
import { Pause, Play, Webhook } from "lucide-react";
import { LOW_RATE, type EndpointView } from "@/features/device-sdk/portal/view";
import { Badge, Button, Card, ICON_SM, Meter, type Tone } from "../_design/ui";
import { CardFoot, CardHead, ChipRow, Figure, FigureWell, Mark, Spark, Text } from "../_design/ui-page";
import { fmt, since } from "../_components/format";

const STATE: Record<EndpointView["state"], [string, Tone]> = { healthy: ["Healthy", "ok"], failing: ["Failing", "error"], paused: ["Paused", "neutral"] };
const SHOWN_EVENTS = 3;

export function EndpointCard({ endpoint: e, canManage, onEvents, onToggle }: { endpoint: EndpointView; canManage: boolean; onEvents: () => void; onToggle: () => void }) {
  const [label, tone] = STATE[e.state];
  const events = e.events ?? ["All events"];
  const sent = e.sent7d > 0;
  return (
    <Card label={e.name}>
      <CardHead mark={<Mark icon={Webhook} tone={e.state === "paused" ? "ring" : "ink"} />} title={e.name} sub={<Text kind="token">{e.url}</Text>} badges={<Badge tone={tone} dot>{label}</Badge>} />
      <ChipRow>
        {events.slice(0, SHOWN_EVENTS).map((name) => (
          <Badge key={name} tone="ring">
            {name}
          </Badge>
        ))}
        {events.length > SHOWN_EVENTS && <Badge>+{events.length - SHOWN_EVENTS}</Badge>}
      </ChipRow>
      <FigureWell>
        <Figure label="Delivered" value={sent ? `${e.rate}%` : "None"}>
          {sent && <Meter value={e.rate} tone={e.rate < LOW_RATE ? "error" : "ink"} />}
        </Figure>
        <Figure label="Sent, 7d" value={fmt(e.sent7d)} />
        <Figure label="Last" value={since(e.lastAt)} />
      </FigureWell>
      <CardFoot
        main={
          <>
            <Spark bars={e.bars} />
            <Button size="sm" variant="ghost" onClick={onEvents}>
              {e.state === "failing" ? "See failures" : "See events"}
            </Button>
          </>
        }
      >
        {canManage && (
          <Button size="sm" square label={e.state === "paused" ? "Resume" : "Pause"} onClick={onToggle}>
            {e.state === "paused" ? <Play {...ICON_SM} aria-hidden="true" /> : <Pause {...ICON_SM} aria-hidden="true" />}
          </Button>
        )}
      </CardFoot>
    </Card>
  );
}
