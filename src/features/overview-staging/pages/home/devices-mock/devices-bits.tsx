// STAGING COPY of apps/desktop-ui/src/pages/home/devices-mock/devices-bits.tsx @ branch devices-dashboard-mock. Only import paths differ from the source
// (desktop `#/` modules → staging copies, data hooks → ./stubs). See src/features/overview-staging/PORTING.md.
import type { ReactNode } from "react";
import { Bell, GitFork, HelpCircle, MessageSquare, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Img } from "@/features/onboarding/components/paired-avatar";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import type { MockRoute, MockStatus } from "@/features/overview-staging/overview-mock-data";
import {
  DEV_FIGURE,
  DEV_LABEL,
  DEV_MONO,
  DEV_PROSE,
  STATUS_DOT,
  STATUS_LABEL,
  deviceRef,
  runtimeLogo,
  type DeviceRef,
} from "./devices-ui";

/**
 * THE DEVICES SECTION'S ELEMENTS — round 4c.
 *
 * ⚠ **4b PUT A PILL ON EVERY FACT AND SAMUEL REJECTED IT**: *"what the agent did was just do a
 * bunch of pills. The custom UI components were just a bunch of pills, which doesn't look any
 * better … all it did was just change types into pills, which is not helpful whatsoever."* A host
 * card carried about fifteen of them. Converting a wall of text into a wall of pills is the same
 * wall.
 *
 * So the question for each fact is no longer "text or chip", it is **what kind of thing is this
 * fact**, and there is a different element per answer:
 *
 * | The fact is… | It is drawn as | Examples |
 * |---|---|---|
 * | a STATE | a 6px dot, plus a word when the word is not obvious. No box. | online / away / offline, working / waiting, a log's severity |
 * | a QUANTITY | a figure in mono beside its unit, or a `Meter` / `Pips` picture | "2/5 online", battery, routed today |
 * | a KIND | an ICON, because four categories read faster as four shapes | Question / Decision / Message / Notice |
 * | a BRAND | its own logo at 14px, falling back to its NAME | Claude, Codex |
 * | a QUALIFIER on a name | small muted type beside it | the channel an agent works in, a device's model |
 * | a CLAIM that needs to interrupt | a chip, and this is the ONLY thing left that gets one | "In use" |
 *
 * ⚠ **THE CHIP COUNT ON SCREEN WENT FROM ~30 TO 2.** That is the measure of this round.
 * ⚠ GREYSCALE. The only colour is the state dot (`DESIGN-LANGUAGE.md` §5).
 */

/* --------------------------------- figure --------------------------------- */

/**
 * A FIGURE AND ITS UNIT, dense and inline — the replacement for 4b's `StatTile`.
 *
 * ⚠ **THE STAT TILES ARE GONE AND THIS IS WHY.** Three numbers in three 300px cards is what
 * Samuel measured as *"80% of the right side … blank white space"*. A figure does not need a
 * container; it needs a neighbour. Three of these in a header row are dense, fill the row's dead
 * middle, and sit next to the thing they summarise instead of above it.
 */
export function Figure({
  value,
  unit,
  className,
}: {
  value: ReactNode;
  unit: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-baseline gap-1", className)}>
      <span className={DEV_FIGURE}>{value}</span>
      <span className={DEV_LABEL}>{unit}</span>
    </span>
  );
}

/* ---------------------------------- state --------------------------------- */

/**
 * A STATE AS A DOT. ⚠ **NOT A CHIP** — 4b boxed every status and the boxes became the noise. A
 * dot plus a word is the identity card's own bottom line (`identity-section.tsx`: a `bg-success`
 * dot then "1 running"), which is the agreed quality bar.
 */
export function Dot({
  status,
  label,
  seen,
  className,
}: {
  status: MockStatus;
  /** Draw the word. Off for a dot that sits beside a name it clearly belongs to. */
  label?: boolean;
  /** "now", "12m ago" — the stamp belongs to the state, never to a line of its own. */
  seen?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status])}
        aria-hidden
        title={STATUS_LABEL[status]}
      />
      {label && (
        <span className="text-label font-medium text-text-primary">{STATUS_LABEL[status]}</span>
      )}
      {seen && <span className={DEV_MONO}>{seen}</span>}
    </span>
  );
}

/* ---------------------------------- chip ---------------------------------- */

/**
 * THE CHIP — and after 4c there are two on screen.
 *
 * ⚠ **GEOMETRY COPIED FROM THE QUALITY BAR**: `identities-staging/.../identity-section.tsx ›
 * IDENTITY_ROW` — h-6, hairline, near-white well, 7px radius, a 14px mark then the text, *"width
 * is natural, never stretched: a chip is as wide as its fact"*. Copied rather than imported
 * because that file is another worker's and is mid-edit; the port target is ONE recipe in
 * `src/shared/ui` once both rounds land (PORTING.md).
 *
 * ⚠ **USE IT ONLY FOR A CLAIM THAT MUST INTERRUPT.** If the fact is a state, a quantity, a kind,
 * a brand or a qualifier, there is an element above for it. The rule exists because 4b failed by
 * reaching for this first.
 */
export function Chip({
  children,
  mark,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  /** The 14px mark. A chip without one is usually a fact that wanted typography instead. */
  mark?: ReactNode;
  tone?: "neutral" | "ink";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-0 max-w-full shrink-0 items-center gap-1 rounded-[7px] px-1.5 text-label font-medium",
        tone === "ink"
          ? "bg-surface-cta text-text-on-cta"
          : "border border-border-default bg-bg-elevated text-text-secondary",
        className
      )}
    >
      {mark && <span className="grid h-3.5 w-3.5 flex-none place-items-center">{mark}</span>}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/* ---------------------------------- marks --------------------------------- */

/** A device's glyph at row scale — `DeviceGlyph`'s raised 28px tile is a card mark, not a row one. */
export function MiniGlyph({
  kind,
  size = 14,
  className,
}: {
  kind: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid flex-none place-items-center text-text-muted", className)}
      style={{ width: size + 2, height: size + 2 }}
    >
      <DeviceKindIcon kind={kind} size={size} strokeWidth={1.9} />
    </span>
  );
}

/**
 * WHAT AN AGENT RUNS ON — its logo at 14px, or its name in small muted type when there is no
 * logo. ⚠ A brand is the one fact that already HAS a mark the reader knows; spending a pill on it
 * (4b did) is strictly worse than showing the mark.
 */
export function RuntimeMark({ runtime }: { runtime: string }) {
  const logo = runtimeLogo(runtime);
  if (!logo) return <span className={cn("shrink-0", DEV_PROSE)}>{runtime}</span>;
  return (
    <span className="flex-none" title={runtime}>
      <Img src={logo} px={14} radius={3} />
    </span>
  );
}

/**
 * WHAT KIND OF MESSAGE IT WAS — four categories, four shapes.
 *
 * ⚠ An icon beats a chip here on the only metric that matters at five rows: a column of four
 * distinct glyphs is scannable, a column of four same-shaped pills is not.
 */
const KIND_ICON: Record<MockRoute["kind"], typeof Bell> = {
  Question: HelpCircle,
  Decision: GitFork,
  Message: MessageSquare,
  Notice: Bell,
};

export function KindMark({ kind }: { kind: MockRoute["kind"] }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="grid h-4 w-4 flex-none place-items-center text-text-muted" title={kind}>
      <Icon size={13} strokeWidth={1.9} aria-hidden />
      <span className="sr-only">{kind}</span>
    </span>
  );
}

/* --------------------------------- pictures -------------------------------- */

/**
 * THE METER — `"64% battery"` was a string to compare by arithmetic. The bar is pre-compared, and
 * it is the agent card's own recipe (`DESIGN-LANGUAGE.md` §4, `.lp-demo-ac-track`).
 */
export function Meter({
  value,
  label,
  className,
}: {
  /** 0–100. */
  value: number;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <span
        className="block h-1 w-8 overflow-hidden rounded-full bg-bg-inset"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Battery"}
      >
        <span
          className="block h-full rounded-full bg-text-primary"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      {label && <span className={DEV_MONO}>{label}</span>}
    </span>
  );
}

/*
 * ⚠ `Pips` AND `SplitBar` WERE HERE AFTER 4b AND ARE DELETED. Both existed to decorate a stat
 * tile, and the stat tiles are gone (`./devices-overview.tsx`). `docs/DESIGN-SYSTEM.md`'s rule:
 * *"a recipe with no user in EITHER tree is dead code and gets deleted, not mirrored."* The
 * "2/5 online" figure in the header says the ratio without a picture beside it.
 */

/* -------------------------------- hop trail ------------------------------- */

/**
 * WHERE A MESSAGE WENT — ✕ over each device that was tried and did not answer, then the one that
 * did, named.
 *
 * ⚠ **IT DELETED A SENTENCE PER ROW** (4b): every `why` in the mock ("Glasses didn't answer in 30
 * seconds, so it moved to your phone") narrates `tried` + `landedOn`, so the picture carries it.
 * ⚠ **AND IN 4c IT LOST ITS FILLED PILL.** The landing device was an inked chip, which made five
 * black pills down the right edge of the feed. It is a glyph plus the name in ink type now: the
 * row's answer still reads loudest, without five filled boxes competing with it.
 */
export function HopTrail({
  tried,
  devices,
  className,
}: {
  /** Endpoint ids in order; the LAST one is where it landed. */
  tried: readonly string[];
  devices: Map<string, DeviceRef>;
  className?: string;
}) {
  const passed = tried.slice(0, -1);
  const landed = deviceRef(devices, tried[tried.length - 1]);
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {passed.map((id) => {
        const ref = deviceRef(devices, id);
        return (
          <span
            key={id}
            className="relative flex items-center text-text-disabled"
            title={`${ref.name} did not answer`}
          >
            <MiniGlyph kind={ref.kind} size={13} className="text-text-disabled" />
            <X size={8} strokeWidth={3} className="-ml-1 self-start" aria-hidden />
          </span>
        );
      })}
      <span className="flex min-w-0 items-center gap-1" title={`Answered on ${landed.name}`}>
        <MiniGlyph kind={landed.kind} size={13} className="text-text-primary" />
        <span className="min-w-0 truncate text-label font-medium text-text-primary">
          {landed.name}
        </span>
      </span>
    </span>
  );
}
