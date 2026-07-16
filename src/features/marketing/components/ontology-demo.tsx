"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Settings2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";

/**
 * Natural design size of the replica. The markup below is the real
 * ontology page's markup (same kit classes and type tokens), laid out at
 * this size and scaled down to whatever fits the deck-panel slot — so it
 * reads as a true miniature of the product, not a redrawn mock.
 */
const DESIGN_W = 912;
const DESIGN_H = 520;

interface DemoCard {
  name: string;
  subtitle: string;
  attrs: number;
  edges: number;
  actions: number;
  selected?: boolean;
  /** Rendered dropped-open with these attribute rows (the inline expand). */
  open?: readonly (readonly [string, string])[];
}

interface DemoColumn {
  name: string;
  subtitle: string;
  cards: readonly DemoCard[];
}

const CLUSTERS = [
  { name: "Outreach", count: 3, active: true },
  { name: "Research", count: 2, active: false },
] as const;

const CLUSTER_PURPOSE =
  "Every lead from first touch to close — agents triage, enrich, and draft here.";

const COLUMNS: readonly DemoColumn[] = [
  {
    name: "Leads",
    subtitle: "New companies to qualify",
    cards: [
      {
        name: "Acme Robotics",
        subtitle: "Series B · warehouse automation",
        attrs: 4,
        edges: 2,
        actions: 1,
      },
      {
        name: "Northwind Bio",
        subtitle: "Seed · lab operations",
        attrs: 4,
        edges: 1,
        actions: 1,
      },
    ],
  },
  {
    name: "Contacted",
    subtitle: "Waiting on a reply",
    cards: [
      {
        name: "Vantage Health",
        subtitle: "Intro sent by agent",
        attrs: 5,
        edges: 3,
        actions: 2,
        selected: true,
        open: [
          ["Stage", "Intro sent"],
          ["Owner", "Samuel"],
          ["Last touch", "Jul 14"],
          ["Next step", "Follow up Thu"],
        ],
      },
    ],
  },
  {
    name: "Won",
    subtitle: "Signed accounts",
    cards: [
      {
        name: "Meridian AI",
        subtitle: "Pilot → annual",
        attrs: 6,
        edges: 4,
        actions: 2,
      },
    ],
  },
];

/**
 * Static, non-interactive replica of the ontology page, anchored to the
 * deck panel's bottom edge (rounded top corners, open bottom) with
 * padding on the top and right. Scales itself to fit its slot.
 */
export function OntologyDemo() {
  const slotRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.min(r.width / DESIGN_W, r.height / DESIGN_H, 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={slotRef} className="lp-demo-slot" aria-hidden>
      <div
        className="lp-demo antialiased"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${scale ?? 0.8})`,
          opacity: scale === null ? 0 : 1,
        }}
      >
        {/* .page-float minus its shell margins; bottom edge runs off the panel */}
        <div className="page-float m-0 flex h-full w-full flex-col rounded-b-none border-b-0">
          {/* header — cluster switcher, name + purpose, add column */}
          <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
            <div className="concave-track flex items-center gap-1">
              {CLUSTERS.map((c) => (
                <span
                  key={c.name}
                  className={cn(
                    "flex h-6 items-center gap-1.5 rounded-[6px] px-2.5 text-caption font-medium",
                    c.active ? "raised-tab text-text-primary" : "text-text-secondary"
                  )}
                >
                  {c.name}
                  <span className="text-micro text-text-muted">{c.count}</span>
                </span>
              ))}
              <span className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-muted">
                <Plus size={12} />
              </span>
            </div>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="shrink-0 text-title font-semibold tracking-tight text-text-primary">
                Outreach
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-text-secondary">
                {CLUSTER_PURPOSE}
              </span>
            </div>
            <span className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary">
              <Plus size={12} /> Column
            </span>
          </div>

          {/* kanban board */}
          <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
            {COLUMNS.map((col) => (
              <div key={col.name} className="bento flex w-72 shrink-0 flex-col overflow-hidden">
                <div className="shrink-0">
                  <div className="flex items-center gap-2 px-3 pt-2.5">
                    <span className="min-w-0 flex-1 truncate text-body font-semibold tracking-tight text-text-primary">
                      {col.name}
                    </span>
                    <span className="rounded-full bg-surface-raised-4 px-1.5 py-px text-micro font-medium text-text-secondary">
                      {col.cards.length}
                    </span>
                    <span className="rounded-md p-1 text-text-muted">
                      <Settings2 size={13} />
                    </span>
                  </div>
                  <div className="px-3 pb-2 text-caption text-text-secondary">
                    {col.subtitle}
                  </div>
                </div>
                <div
                  className={`${SECTION_BOX_INSET} flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2 py-2`}
                >
                  {col.cards.map((card) => (
                    <Card key={card.name} card={card} />
                  ))}
                  <span className="btn-light flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-small font-medium text-text-primary">
                    <Plus size={12} /> Add new
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ card }: { card: DemoCard }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-bg-elevated",
        card.selected
          ? "border-border-highlight shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08)]"
          : "border-border-default shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
      )}
    >
      <div className="flex w-full items-start gap-2 px-3 pt-2.5 pb-1 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-semibold tracking-tight text-text-primary">
            {card.name}
          </div>
          <div className="mt-0.5 truncate text-caption text-text-secondary">
            {card.subtitle}
          </div>
        </div>
        <span className="rounded-md p-1 text-text-muted">
          <ChevronDown size={13} className={cn(card.open && "rotate-180")} />
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 pb-2 text-micro text-text-muted">
        <span>{card.attrs} attrs</span>
        <span aria-hidden>·</span>
        <span>{card.edges} edges</span>
        <span aria-hidden>·</span>
        <span>{card.actions} actions</span>
      </div>
      {card.open && (
        <div className="border-t border-border-subtle bg-bg-inset px-3 py-2 shadow-[inset_0_2px_4px_rgba(0,0,0,0.08),inset_0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="flex flex-col gap-1">
            {card.open.map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-2 text-caption">
                <span className="w-24 shrink-0 truncate text-text-muted">{label}</span>
                <span className="min-w-0 flex-1 truncate text-text-primary">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
