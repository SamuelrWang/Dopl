// STAGING COPY of apps/desktop-ui/src/pages/home/devices-mock/devices-reach.tsx @ branch devices-dashboard-mock. Only import paths differ from the source
// (desktop `#/` modules → staging copies, data hooks → ./stubs). See src/features/overview-staging/PORTING.md.
import { cn } from "@/shared/lib/utils";
import { DEVICES_MOCK } from "@/features/overview-staging/overview-mock-data";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { Dot, Figure } from "./devices-bits";
import { DEV_LABEL, DEV_MONO, DEV_ROW, deviceRef, type DeviceRef } from "./devices-ui";

/**
 * THE REACH ORDER — where a question goes, and what happens when that device does not answer.
 *
 * ⚠ **IT HAS NO SENTENCES** (4b). Three runs of prose carried this and all three are drawn now:
 * the chain's own order, a `30s` mark ON each connector (the wait is a property of the hop, so it
 * is drawn on the hop), and each tile's own position label.
 *
 * ⚠ **AND IN 4c IT LOST ITS HEADER ROW** (Samuel: *"so much blank space"*). A label on its own
 * line above three tiles is a line with one word on the left and nothing else. The label is the
 * row's first COLUMN instead, so the card is one band: label, then the chain filling the rest.
 *
 * ⚠ **EACH TILE EARNS ITS WIDTH.** At twelve columns a tile is ~290px, and 4b put a glyph and a
 * name in it — the rest was empty. It now carries four facts in two columns: who it is (glyph +
 * name), what state it is in (dot + word + stamp), and WHERE IT SITS IN THE ORDER (the position
 * figure, right-aligned, which is the fact the chain exists to show). Right-aligning the figure
 * is what removes the blank right edge, and it is not padding: it is the tile's own index.
 */
export function ReachBlock({
  devices,
  className,
}: {
  devices: Map<string, DeviceRef>;
  className?: string;
}) {
  const chain = DEVICES_MOCK.fallbackChain;
  return (
    // 4d: NO CARD. The label and the chain sit on the open page; the band needs no frame to be
    // read as one thing, because the connectors already draw it as a chain.
    <section
      className={cn("flex items-stretch gap-4 px-1", className)}
      aria-label="Reach order"
    >
      {/* The label as the band's first column, two lines, no row of its own. */}
      <h3 className={cn("w-14 shrink-0 self-center leading-tight", DEV_LABEL)}>Reach order</h3>

      {/* ⚠ RULE 1: `w-fit`, NOT `flex-1`. The chain used to stretch to the pane, which made each
          tile ~300px holding a 15px glyph, a short name and a two-word state — the "overly long
          bars" Samuel named. The band is now as wide as the chain it draws, and the page carries
          the rest. */}
      <ol className="flex w-fit min-w-0 items-stretch">
        {chain.map((id, i) => {
          const ref = deviceRef(devices, id);
          const last = i === chain.length - 1;
          return (
            <li key={id} className="flex min-w-0 flex-none items-center">
              <ReachTile ref_={ref} index={i} lead={i === 0} last={last} />
              {!last && <Connector />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** `NOW` / `THEN` / `LAST` — the position's meaning, which is why the figure is not decoration. */
function positionUnit(lead: boolean, last: boolean): string {
  if (lead) return "now";
  return last ? "last" : "then";
}

function ReachTile({
  ref_,
  index,
  lead,
  last,
}: {
  ref_: DeviceRef;
  index: number;
  lead: boolean;
  last: boolean;
}) {
  return (
    <div
      className={cn(
        // `flex-none` + a content ceiling: a tile is as wide as its name, never a third of the pane.
        "flex min-w-0 max-w-[13rem] flex-none items-center gap-2.5 rounded-[10px] border px-2.5 py-2",
        // The section's ONE inked surface: "this is where it goes right now" should be the first
        // thing the eye lands on in the whole section.
        lead ? "border-transparent bg-surface-cta" : "border-border-subtle bg-bg-base"
      )}
    >
      <DeviceGlyph kind={ref_.kind} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "min-w-0 truncate font-medium",
            lead ? "text-body text-text-on-cta" : DEV_ROW
          )}
        >
          {ref_.name}
        </span>
        {lead ? (
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
            <span className="text-label font-medium text-text-on-cta">Answering</span>
          </span>
        ) : (
          <Dot status={ref_.status} label className="mt-0.5" />
        )}
      </span>
      {/* The position, right-aligned: the fact that fills the tile's right side. */}
      <Figure
        value={index + 1}
        unit={positionUnit(lead, last)}
        className={cn("shrink-0 flex-col items-end gap-0", lead && "[&>*]:text-text-on-cta")}
      />
    </div>
  );
}

/**
 * THE CONNECTOR, CARRYING THE RULE. A hairline with `30s` on it: the wait belongs to the hop, so
 * it is drawn on the hop instead of in a caption under the card.
 */
function Connector() {
  return (
    <span className="flex shrink-0 flex-col items-center gap-0.5 px-2" aria-hidden>
      <span className={DEV_MONO}>30s</span>
      <span className="flex items-center">
        <span className="h-px w-3 bg-border-default" />
        <span className="h-1.5 w-1.5 rotate-45 border-r border-t border-border-default" />
      </span>
    </span>
  );
}
