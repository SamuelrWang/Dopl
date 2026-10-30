"use client";

/** A model the project supports: identity, state, what it does, how it is doing, what to do next. */
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import b from "../_design/base.module.css";
import c from "../_design/catalog.module.css";
import { cx, ICON_100 } from "../_design/components";
import o from "../_design/surfaces.module.css";
import type { Category, Model } from "../_data/catalog";
import { CategoryGlyph } from "../_components/category-glyph";
import { BASE, fmt } from "../_components/ui";
import { LOW_SHOWN, attentionOf, weekBars, type ModelRow } from "./devices-model";

const SHOWN_CHIPS = 4;

function Figure({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <span className={c.figure}>
      <span className={b.smallMuted}>{label}</span>
      <span className={cx(b.h3, b.num)}>{value}</span>
      {children}
    </span>
  );
}

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
    <Link href={`${BASE}/devices/${integration.id}?model=${model.id}`} className={cx(b.card, c.model)}>
      <span className={c.head}>
        <span className={c.glyph}>
          <CategoryGlyph id={category.id} size={ICON_100} />
        </span>
        <span className={b.tight}>
          <span className={b.h3}>{model.name}</span>
          <span className={b.smallMuted}>{integration.name}</span>
        </span>
        <span className={c.headBadges}>
          <span className={cx(b.badge, !testing && b.badgeOk)}>
            <span className={b.dot} />
            {testing ? "Testing" : "Live"}
          </span>
          {attention > 0 && <span className={cx(b.badge, b.badgeError)}>{attention} need attention</span>}
        </span>
      </span>
      <span className={c.chips}>
        {functions.slice(0, SHOWN_CHIPS).map((fn) => (
          <span key={fn} className={cx(b.badge, b.badgeRing)}>
            {fn}
          </span>
        ))}
        {functions.length > SHOWN_CHIPS && <span className={b.badge}>+{functions.length - SHOWN_CHIPS}</span>}
      </span>
      <span className={c.well}>
        <Figure label="Shown, 7d" value={delivered ? `${figures.rate}%` : "None"}>
          {delivered && (
            <span className={o.bar}>
              <span className={cx(o.barFill, low && c.meterLow)} style={{ width: `${figures.rate}%` }} />
            </span>
          )}
        </Figure>
        <Figure label="Users" value={fmt(figures.users)} />
        <Figure label="Online" value={`${fmt(figures.online)} of ${fmt(figures.devices)}`} />
      </span>
      <span className={c.foot}>
        <span className={c.footMain}>
          {testing ? (
            <span className={cx(b.small, c.footText)}>
              {added.testsPassed} of {tests} tests passed
            </span>
          ) : (
            <>
              <span className={c.spark} aria-hidden="true">
                {weekBars(model.id).map((h, i) => (
                  <i key={i} className={cx(c.sparkBar, i === 6 && c.sparkOn)} style={{ height: `${h}%` }} />
                ))}
              </span>
              <span className={cx(b.small, b.num, c.footText)}>{delivered ? `${fmt(figures.deliveries)} calls` : "No calls yet"}</span>
            </>
          )}
        </span>
        <span className={cx(b.btn, b.sm, action.ink && b.ink)}>
          {action.label}
          <ChevronRight {...ICON_100} />
        </span>
      </span>
    </Link>
  );
}

/** Closes each section, and says what the category can still add. */
export function AddCard({ category, available, wide, onClick }: { category: Category; available: Model[]; wide: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cx(c.add, wide && c.addWide)} onClick={onClick}>
      <span className={c.addHead}>
        <span className={b.tile}>
          <Plus {...ICON_100} />
        </span>
        <span className={b.tight}>
          <span className={b.strong}>Add new device</span>
          <span className={b.smallMuted}>{category.name}</span>
        </span>
      </span>
      <span className={c.chips}>
        {available.length === 0 && <span className={b.smallMuted}>None available</span>}
        {available.slice(0, 3).map((m) => (
          <span key={m.id} className={cx(b.badge, b.badgeRing)}>
            {m.name}
          </span>
        ))}
        {available.length > 3 && <span className={b.badge}>+{available.length - 3}</span>}
      </span>
    </button>
  );
}
