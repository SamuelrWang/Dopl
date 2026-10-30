"use client";

/**
 * Devices: which models this project supports and how each is doing. A heading per category, a card
 * per added model, an add card closing each section. Physical devices only appear on a user's page.
 */
import { Plus, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import b from "../_design/base.module.css";
import c from "../_design/catalog.module.css";
import { cx, ICON_100 } from "../_design/components";
import d from "../_design/data.module.css";
import p from "../_design/page.module.css";
import o from "../_design/surfaces.module.css";
import tokens from "../_design/tokens.module.css";
import { CATEGORIES, type CategoryId } from "../_data/catalog";
import { CategoryGlyph } from "../_components/category-glyph";
import { usePortal, useUsers } from "../_components/portal-store";
import { figuresOfDevices } from "../_components/stats";
import { fmt } from "../_components/ui";
import { AddDeviceDialog } from "./add-device-dialog";
import { AddCard, ModelCard } from "./devices-card";
import { NO_DEVICE_FILTERS, attentionOf, availableModels, keeps, modelRows, type DeviceFilters } from "./devices-model";
import { DevicesToolbar } from "./devices-toolbar";

export function DevicesSection() {
  const { state } = usePortal();
  const users = useUsers();
  const [filters, setFilters] = useState<DeviceFilters>(NO_DEVICE_FILTERS);
  const [adding, setAdding] = useState<CategoryId | "any" | null>(null);

  const all = useMemo(() => modelRows(state, users), [state, users]);
  const rows = useMemo(() => all.filter((r) => keeps(r, filters)), [all, filters]);
  const patch = (next: Partial<DeviceFilters>) => setFilters((f) => ({ ...f, ...next }));

  const figures = figuresOfDevices(rows.flatMap((r) => r.devices));
  const live = rows.filter((r) => r.added.status === "live").length;
  const relink = rows.reduce((n, r) => n + r.relink, 0);
  const stale = rows.reduce((n, r) => n + r.stale, 0);
  // Add cards belong to browsing; a search answers with what matched.
  const browsing = filters.q === "" && filters.quick === "all" && filters.integration === "all" && filters.fn === "all";
  const categories = CATEGORIES.filter((category) => (filters.category === "all" || filters.category === category.id) && (browsing || rows.some((r) => r.category.id === category.id)));

  return (
    <div className={cx(p.root, tokens.scope, tokens.u100)}>
      <div className={p.scroller}>
        <div className={p.inner}>
          <header className={b.between}>
            <div className={b.row}>
              <h1 className={b.title}>Devices</h1>
              {state.env === "test" && <span className={cx(b.badge, b.badgeWarn)}>Test data</span>}
            </div>
            <button type="button" className={cx(b.btn, b.ink)} onClick={() => setAdding("any")}>
              <Plus {...ICON_100} />
              Add device
            </button>
          </header>

          <div className={p.stats}>
            <div className={b.card}>
              <div className={d.stat}>
                <span className={b.muted}>Models</span>
                <span className={b.big}>{fmt(rows.length)}</span>
                <span className={b.smallMuted}>
                  {live} live{rows.length > live ? `, ${rows.length - live} testing` : ""}
                </span>
              </div>
            </div>
            <div className={b.card}>
              <div className={d.stat}>
                <span className={b.muted}>Connected devices</span>
                <span className={b.big}>{fmt(figures.devices)}</span>
                <span className={b.smallMuted}>
                  {fmt(figures.online)} online, {fmt(figures.users)} users
                </span>
              </div>
            </div>
            <div className={b.card}>
              <div className={d.stat}>
                <span className={b.muted}>Shown, 7d</span>
                <span className={b.big}>{figures.deliveries ? `${figures.rate}%` : "None"}</span>
                <span className={b.smallMuted}>{fmt(figures.deliveries)} calls</span>
              </div>
            </div>
            <button type="button" aria-pressed={filters.quick === "attention"} className={cx(b.card, p.statBtn, filters.quick === "attention" && p.statOn)} onClick={() => patch({ quick: filters.quick === "attention" ? "all" : "attention" })}>
              <span className={d.stat}>
                <span className={b.muted}>Devices with issues</span>
                <span className={b.big}>{fmt(rows.reduce((n, r) => n + attentionOf(r), 0))}</span>
                <span className={b.smallMuted}>
                  {relink} relink, {stale} stale
                </span>
              </span>
            </button>
          </div>

          <DevicesToolbar rows={all} filters={filters} onChange={patch} />

          {categories.length === 0 ? (
            <div className={b.card}>
              <div className={o.empty}>
                <span className={b.tile}>
                  <SearchX {...ICON_100} />
                </span>
                <span className={b.h3}>No models match</span>
                <button type="button" className={b.btn} onClick={() => setFilters(NO_DEVICE_FILTERS)}>
                  Clear filters
                </button>
              </div>
            </div>
          ) : (
            categories.map((category) => {
              const inSection = rows.filter((r) => r.category.id === category.id);
              const devices = inSection.reduce((n, r) => n + r.figures.devices, 0);
              return (
                <section key={category.id} className={c.section} aria-label={category.name}>
                  <h2 className={c.sectionHead}>
                    <span className={c.sectionMark}>
                      <CategoryGlyph id={category.id} size={ICON_100} />
                    </span>
                    <span className={b.h3}>{category.name}</span>
                    {devices > 0 && <span className={cx(b.smallMuted, c.sectionMeta)}>{fmt(devices)} devices</span>}
                  </h2>
                  <div className={c.grid}>
                    {inSection.map((row) => (
                      <ModelCard key={row.model.id} row={row} />
                    ))}
                    {browsing && <AddCard category={category} available={availableModels(state, category.id)} wide={inSection.length === 0} onClick={() => setAdding(category.id)} />}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
      {adding && <AddDeviceDialog initialCategory={adding === "any" ? null : adding} onClose={() => setAdding(null)} />}
    </div>
  );
}
