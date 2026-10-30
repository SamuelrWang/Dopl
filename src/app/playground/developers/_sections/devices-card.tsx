"use client";

/** A model the project supports: identity, state, what it does, how it is doing, what to do next. */
import { ChevronRight } from "lucide-react";
import { Badge, Button, Card, ICON, Meter } from "../_design/ui";
import { AddCard, CardFoot, CardHead, ChipRow, Figure, FigureWell, Mark, Spark, Text } from "../_design/ui-page";
import type { Category, Model } from "../_data/catalog";
import { CategoryGlyph } from "../_components/category-glyph";
import { BASE, fmt } from "../_components/ui";
import { LOW_SHOWN, attentionOf, weekBars, type ModelRow } from "./devices-model";

const SHOWN_CHIPS = 4;

function nextAction(row: ModelRow): { label: string; ink: boolean } {
  if (row.added.status === "testing") return { label: "Continue testing", ink: true };
  const n = attentionOf(row);
  return n > 0 ? { label: `Review ${n}`, ink: false } : { label: "Open", ink: false };
}

export function ModelCard({ row }: { row: ModelRow }) {
  const { model, integration, category, added, figures, functions } = row;
  const attention = attentionOf(row);
  const testing = added.status === "testing";
  const delivered = figures.deliveries > 0;
  const low = delivered && figures.rate < LOW_SHOWN;
  const action = nextAction(row);
  const tests = model.capabilities.length;
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
        badges={
          <>
            <Badge tone={testing ? "neutral" : "ok"} dot>
              {testing ? "Testing" : "Live"}
            </Badge>
            {attention > 0 && <Badge tone="error">{attention} need attention</Badge>}
          </>
        }
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
        <Figure label="Shown, 7d" value={delivered ? `${figures.rate}%` : "None"}>
          {delivered && <Meter value={figures.rate} tone={low ? "error" : "ink"} />}
        </Figure>
        <Figure label="Users" value={fmt(figures.users)} />
        <Figure label="Online" value={`${fmt(figures.online)} of ${fmt(figures.devices)}`} />
      </FigureWell>
      <CardFoot
        main={
          testing ? (
            <Text kind="small" clip>
              {added.testsPassed} of {tests} tests passed
            </Text>
          ) : (
            <>
              <Spark bars={weekBars(model.id)} />
              <Text kind="small" num clip>
                {delivered ? `${fmt(figures.deliveries)} calls` : "No calls yet"}
              </Text>
            </>
          )
        }
      >
        <Button inert size="sm" variant={action.ink ? "ink" : "secondary"}>
          {action.label}
          <ChevronRight {...ICON} />
        </Button>
      </CardFoot>
    </Card>
  );
}

/** Closes each section, and says what the category can still add. */
export function AddModelCard({ category, available, wide, onClick }: { category: Category; available: Model[]; wide: boolean; onClick: () => void }) {
  return (
    <AddCard title="Add new device" sub={category.name} wide={wide} onClick={onClick}>
      {available.length === 0 && <Text kind="smallMuted">None available</Text>}
      {available.slice(0, 3).map((m) => (
        <Badge key={m.id} tone="ring">
          {m.name}
        </Badge>
      ))}
      {available.length > 3 && <Badge>+{available.length - 3}</Badge>}
    </AddCard>
  );
}
