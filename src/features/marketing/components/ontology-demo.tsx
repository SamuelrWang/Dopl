"use client";

import { ChevronDown, Plus, Settings2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { DemoShell, useDemoTimeline } from "./demo-shell";

/**
 * Animated miniature of the real ontology page (same kit classes and type
 * tokens as the live board). Scenario over the panel's ~8s active window:
 * an agent files a new lead object, its attributes fill from the column
 * template, then the object advances a stage.
 */

const MARKS = [1.6, 3.6, 5.6] as const;

const CAPTIONS = [
  "One cluster of your ontology — every column and card is an object",
  "An agent files a new lead as an object",
  "Attributes fill in from the column's template",
  "The object advances as the work happens",
] as const;

interface DemoCard {
  name: string;
  subtitle: string;
  attrs: number;
  edges: number;
  actions: number;
  selected?: boolean;
  pop?: boolean;
  /** Rendered dropped-open with these attribute rows (the inline expand). */
  open?: readonly (readonly [string, string])[];
}

const ACME: DemoCard = {
  name: "Acme Robotics",
  subtitle: "Series B · warehouse automation",
  attrs: 4,
  edges: 2,
  actions: 1,
};

const NORTHWIND: DemoCard = {
  name: "Northwind Bio",
  subtitle: "Seed · lab operations",
  attrs: 4,
  edges: 1,
  actions: 1,
};

const JUNIPER: DemoCard = {
  name: "Juniper Ops",
  subtitle: "Inbound · fleet analytics",
  attrs: 4,
  edges: 1,
  actions: 1,
};

const VANTAGE_ROWS = [
  ["Stage", "Intro sent"],
  ["Owner", "Samuel"],
  ["Last touch", "Jul 14"],
  ["Next step", "Follow up Thu"],
] as const;

const MERIDIAN: DemoCard = {
  name: "Meridian AI",
  subtitle: "Pilot → annual",
  attrs: 6,
  edges: 4,
  actions: 2,
};

export function OntologyDemo({
  active = true,
  paused = false,
}: {
  active?: boolean;
  paused?: boolean;
}) {
  const step = useDemoTimeline(MARKS, active, paused);

  const vantage: DemoCard = {
    name: "Vantage Health",
    subtitle: "Intro sent by agent",
    attrs: 5,
    edges: 3,
    actions: 2,
    selected: step >= 2,
    open: step >= 2 ? VANTAGE_ROWS : undefined,
  };

  const columns = [
    {
      name: "Leads",
      subtitle: "New companies to qualify",
      cards: [
        ACME,
        NORTHWIND,
        // the agent's new object lives here until it advances a stage
        ...(step >= 1 && step < 3 ? [{ ...JUNIPER, pop: true }] : []),
      ],
    },
    {
      name: "Contacted",
      subtitle: "Waiting on a reply",
      cards: [
        vantage,
        ...(step >= 3
          ? [{ ...JUNIPER, subtitle: "Intro drafted · fleet analytics", pop: true }]
          : []),
      ],
    },
    {
      name: "Won",
      subtitle: "Signed accounts",
      cards: [MERIDIAN],
    },
  ];

  return (
    <DemoShell caption={CAPTIONS[step]}>
      {/* .page-float minus its shell margins; bottom edge runs off the panel */}
      <div className="page-float m-0 flex h-full w-full flex-col rounded-b-none border-b-0">
        {/* header — cluster switcher, name + purpose, add column */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
          <div className="concave-track flex items-center gap-1">
            <span className="raised-tab flex h-6 items-center gap-1.5 rounded-[6px] px-2.5 text-caption font-medium text-text-primary">
              Outreach
              <span className="text-micro text-text-muted">3</span>
            </span>
            <span className="flex h-6 items-center gap-1.5 rounded-[6px] px-2.5 text-caption font-medium text-text-secondary">
              Research
              <span className="text-micro text-text-muted">2</span>
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-muted">
              <Plus size={12} />
            </span>
          </div>
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 text-title font-semibold tracking-tight text-text-primary">
              Outreach
            </span>
            <span className="min-w-0 flex-1 truncate text-body text-text-secondary">
              Every lead from first touch to close — agents triage, enrich, and draft here.
            </span>
          </div>
          <span className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary">
            <Plus size={12} /> Column
          </span>
        </div>

        {/* kanban board */}
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
          {columns.map((col) => (
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
    </DemoShell>
  );
}

function Card({ card }: { card: DemoCard }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-bg-elevated",
        card.pop && "lp-demo-pop",
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
          <ChevronDown
            size={13}
            className={cn("transition-transform duration-300", card.open && "rotate-180")}
          />
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
            {card.open.map(([label, value], i) => (
              <div
                key={label}
                className="lp-demo-row-in flex items-baseline gap-2 text-caption"
                style={{ animationDelay: `${i * 0.22}s` }}
              >
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
