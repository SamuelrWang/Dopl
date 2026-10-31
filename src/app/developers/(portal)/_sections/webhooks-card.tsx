"use client";

/** An endpoint: where it points, its health, what it listens to, what to do about it. */
import { Pause, Play, Send, Webhook } from "lucide-react";
import { Badge, Button, Card, ICON_SM, Meter, type Tone } from "../_design/ui";
import { CardFoot, CardHead, ChipRow, Figure, FigureWell, Mark, Spark, Text } from "../_design/ui-page";
import type { EndpointRow } from "../_data/misc";
import { fmt, since } from "../_components/ui";

const STATE: Record<EndpointRow["state"], [string, Tone]> = { healthy: ["Healthy", "ok"], failing: ["Failing", "error"], paused: ["Paused", "neutral"] };
const SHOWN_EVENTS = 3;
const LOW = 90;

/** A steady week with this endpoint's own shape. */
const barsOf = (id: string) => Array.from({ length: 7 }, (_, i) => 35 + ((id.charCodeAt(i % id.length) * (i + 3) * 13) % 60));

export function EndpointCard({ endpoint: e, onEvents, onTest, onToggle }: { endpoint: EndpointRow; onEvents: () => void; onTest: () => void; onToggle: () => void }) {
  const [label, tone] = STATE[e.state];
  return (
    <Card label={e.description}>
      <CardHead mark={<Mark icon={Webhook} tone={e.state === "paused" ? "ring" : "ink"} />} title={e.description} sub={<Text kind="token">{e.url}</Text>} badges={<Badge tone={tone} dot>{label}</Badge>} />
      <ChipRow>
        {e.events.slice(0, SHOWN_EVENTS).map((name) => (
          <Badge key={name} tone="ring">
            {name}
          </Badge>
        ))}
        {e.events.length > SHOWN_EVENTS && <Badge>+{e.events.length - SHOWN_EVENTS}</Badge>}
      </ChipRow>
      <FigureWell>
        <Figure label="Delivered" value={`${e.successRate}%`}>
          <Meter value={e.successRate} tone={e.successRate < LOW ? "error" : "ink"} />
        </Figure>
        <Figure label="Sent, 7d" value={fmt(e.sent7d)} />
        <Figure label="Last" value={since(e.lastAt)} />
      </FigureWell>
      <CardFoot
        main={
          <>
            <Spark bars={barsOf(e.id)} />
            <Button size="sm" variant="ghost" onClick={onEvents}>
              {e.state === "failing" ? "See failures" : "See events"}
            </Button>
          </>
        }
      >
        <Button size="sm" onClick={onTest}>
          <Send {...ICON_SM} aria-hidden="true" />
          Test
        </Button>
        <Button size="sm" square label={e.state === "paused" ? "Resume" : "Pause"} onClick={onToggle}>
          {e.state === "paused" ? <Play {...ICON_SM} aria-hidden="true" /> : <Pause {...ICON_SM} aria-hidden="true" />}
        </Button>
      </CardFoot>
    </Card>
  );
}
