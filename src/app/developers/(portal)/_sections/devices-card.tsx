"use client";

/** A model the project uses: identity, state, what it does, how it is doing. */
import { ChevronRight } from "lucide-react";
import { LOW_RATE, counted, dayOf, totalsOf, type MetricRow } from "@/features/device-sdk/portal/view";
import { Badge, Button, Card, ICON, Meter } from "../_design/ui";
import { CardFoot, CardHead, ChipRow, Figure, FigureWell, Mark, Spark, Text } from "../_design/ui-page";
import { CategoryGlyph } from "../_components/category-glyph";
import { BASE, fmt, portalNow } from "../_components/format";
import { attentionOf, type ModelRow } from "./devices-model";

const SHOWN_CHIPS = 4;

/** This model's seven days, tallest day full height. */
function weekBars(row: ModelRow, metrics: readonly MetricRow[]): number[] {
  const ids = new Set(row.devices.map((d) => d.id));
  const counts = Array.from({ length: 7 }, (_, i) => totalsOf(metrics.filter((m) => m.device !== null && ids.has(m.device) && m.day === dayOf(portalNow(), 6 - i))).deliveries);
  const top = Math.max(...counts, 1);
  return counts.map((c) => (c / top) * 100);
}

export function ModelCard({ row, metrics }: { row: ModelRow; metrics: readonly MetricRow[] }) {
  const { model, integration, category, figures, functions } = row;
  const attention = attentionOf(row);
  const delivered = figures.deliveries > 0;
  return (
    <Card href={`${BASE}/devices/${integration.id}?model=${model.id}`}>
      <CardHead
        mark={
          <Mark tone="ink">
            <CategoryGlyph id={category.id} size={ICON} />
          </Mark>
        }
        title={model.name}
        sub={<Text kind="smallMuted">{integration.name}</Text>}
        badges={attention > 0 && <Badge tone="error">{attention} need attention</Badge>}
      />
      <ChipRow>
        {functions.slice(0, SHOWN_CHIPS).map((fn) => (
          <Badge key={fn} tone="ring">
            {fn}
          </Badge>
        ))}
        {functions.length > SHOWN_CHIPS && <Badge>+{functions.length - SHOWN_CHIPS}</Badge>}
      </ChipRow>
      <FigureWell>
        <Figure label="Delivered, 7d" value={delivered ? `${figures.rate}%` : "None"}>
          {delivered && <Meter value={figures.rate} tone={figures.rate < LOW_RATE ? "error" : "ink"} />}
        </Figure>
        <Figure label="Users" value={fmt(figures.users)} />
        <Figure label="Online" value={`${fmt(figures.online)} of ${fmt(figures.devices)}`} />
      </FigureWell>
      <CardFoot
        main={
          <>
            <Spark bars={weekBars(row, metrics)} />
            <Text kind="small" num clip>
              {delivered ? counted(figures.deliveries, "delivery", "deliveries") : "No deliveries yet"}
            </Text>
          </>
        }
      >
        <Button inert size="sm" variant="secondary">
          {attention > 0 ? `Review ${attention}` : "Open"}
          <ChevronRight {...ICON} />
        </Button>
      </CardFoot>
    </Card>
  );
}
