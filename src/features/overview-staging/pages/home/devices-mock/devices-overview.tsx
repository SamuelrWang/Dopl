// STAGING COPY of apps/desktop-ui/src/pages/home/devices-mock/devices-overview.tsx @ branch devices-dashboard-mock. Only import paths differ from the source
// (desktop `#/` modules → staging copies, data hooks → ./stubs). See src/features/overview-staging/PORTING.md.
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT, SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { PAGE_ACTION_BTN_LIGHT } from "@/shared/ui/page-action-button";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { CreateButton } from "../panel-buttons";
import { DEVICES_MOCK, type MockHost } from "@/features/overview-staging/overview-mock-data";
import { ActivityBlock } from "./devices-activity";
import { ReachBlock } from "./devices-reach";
import { DevicesBands } from "./devices-variant-bands";
import { DevicesCards } from "./devices-variant-cards";
import { DevicesPanes } from "./devices-variant-panes";
import { DevicesTree } from "./devices-variant-tree";
import { VARIANT_OPTIONS, type HostHandlers, type VariantKey } from "./devices-variant-types";
import { Figure } from "./devices-bits";
import { DEV_CARD, DEV_LABEL, DEV_PROSE, type DeviceRef } from "./devices-ui";

/**
 * /home → Overview → Devices: a PREVIEW drawn from hardcoded data (`devices-mock-data.ts`),
 * shown to one account only (`overview-panels.tsx` gates it). Rename and remove change local
 * state and nothing else; Add device opens a chooser that pairs nothing.
 *
 * ── THE REDESIGN (2026-10-22, Samuel's ask 4) ────────────────────────────────────────────────
 * ⚠ **IT IS NOT A `SectionPanel` ANY MORE, AND THAT IS THE WHOLE POINT.** Samuel, verbatim:
 * *"we should lean away from the gray background with the header on the gray background and then
 * different panels on top. I feel like there's a better way to make this dashboard."* The grey
 * well, the heading standing on it and the white cards floating on top were three grounds deep
 * and the section read as packaging. What is here instead:
 *
 *   1. A HEADER ROW on the page itself, closed by a hairline. No ground under the title. (Here.)
 *   2. ONE REACH CARD on top: three figures, then the fallback order drawn as the chain it is.
 *      This is the question a devices dashboard exists to answer ("where does a question reach
 *      me right now"), so it leads instead of sitting third inside a grey well.
 *      (`./devices-reach.tsx`.)
 *   3. ONE CARD PER COMPUTER, FLAT: the two grey wells per host are gone. Agents and connected
 *      devices are labelled GROUPS separated by hairlines, so depth comes from the label and the
 *      rule rather than from a second fill (`DESIGN-LANGUAGE.md` §1, §2).
 *      (`./devices-host-card.tsx`.)
 *   4. ONE ACTIVITY CARD where Routing's "Recent" list and Logs used to be two near-identical
 *      timestamped feeds in two cards. (`./devices-activity.tsx`.)
 *
 * ⚠ FOUR FILES, NOT ONE: the redesign took the section past the 500-line `max-lines` cap, so the
 * three cards each own a file and this one keeps the state, the header and the Add-device chooser.
 * Every face they share is `./devices-ui.ts`.
 *
 * ⚠ Cards are white on the record pane's near-white `--home-card`, held apart by a hairline and
 * the landing's two-layer shadow (`staging.css › .uis-dev-card`) — never by a grey field.
 * ⚠ Destructive controls are `NAKED_ICON_BUTTON`s on the row they belong to (Samuel's 2026-09-12
 * ruling, which this section was not honouring: hosts had a red "Remove computer" text button in
 * a footer while their endpoints already wore a naked X).
 */
export function DevicesOverviewMock() {
  const [hosts, setHosts] = useState<MockHost[]>(DEVICES_MOCK.hosts);
  const [adding, setAdding] = useState(false);
  /** ITEM 4E: which STRUCTURE is on screen. Samuel picks one; the other two files are deleted. */
  const [variant, setVariant] = useState<VariantKey>("bands");

  /**
   * id → the device, for every surface that only holds ids (the fallback chain, a routing row's
   * `tried`, a log row's `deviceId`).
   *
   * ⚠ IT CARRIES STATUS AND KIND NOW, not just the name. The chain could not say WHY a question
   * fell through to the next device, because the name was all it had.
   */
  const devices = useMemo(() => {
    const map = new Map<string, DeviceRef>();
    const put = (all: readonly MockHost[]) => {
      for (const host of all) {
        map.set(host.id, { name: host.name, kind: "computer", status: host.status });
        for (const ep of host.endpoints) {
          map.set(ep.id, { name: ep.name, kind: ep.kind, status: ep.status });
        }
      }
    };
    // The pristine list first, so a removed device still resolves to its name in the log.
    put(DEVICES_MOCK.hosts);
    put(hosts);
    return map;
  }, [hosts]);

  /**
   * THE THREE BENTO FIGURES, derived — never a literal, and each one paired with the number its
   * tile's picture needs (a count is only honest against its total).
   *
   * `direct` = routes that landed on the FIRST device they tried, which is what makes "Routed
   * today" a quality figure rather than a volume one.
   */
  const tally = useMemo(() => {
    const statuses = hosts.flatMap((h) => [h.status, ...h.endpoints.map((e) => e.status)]);
    const agents = hosts.flatMap((h) => h.agents);
    return {
      devices: statuses.length,
      online: statuses.filter((s) => s === "active").length,
      agents: agents.length,
      working: agents.filter((a) => a.state === "working").length,
      direct: DEVICES_MOCK.routes.filter((r) => r.tried.length === 1).length,
    };
  }, [hosts]);

  function renameHost(id: string, name: string) {
    setHosts((all) => all.map((h) => (h.id === id ? { ...h, name } : h)));
  }
  function removeHost(id: string) {
    setHosts((all) => all.filter((h) => h.id !== id));
  }
  function renameEndpoint(hostId: string, id: string, name: string) {
    setHosts((all) =>
      all.map((h) =>
        h.id === hostId
          ? { ...h, endpoints: h.endpoints.map((e) => (e.id === id ? { ...e, name } : e)) }
          : h
      )
    );
  }
  function removeEndpoint(hostId: string, id: string) {
    setHosts((all) =>
      all.map((h) =>
        h.id === hostId ? { ...h, endpoints: h.endpoints.filter((e) => e.id !== id) } : h
      )
    );
  }

  const dirty = hosts !== DEVICES_MOCK.hosts;

  /** One contract for all three variants, so a variant is a pure renderer. */
  const handlers: HostHandlers = {
    onRename: renameHost,
    onRemove: removeHost,
    onRenameEndpoint: renameEndpoint,
    onRemoveEndpoint: removeEndpoint,
  };

  return (
    <section aria-labelledby="home-overview-devices" className="flex flex-col gap-2.5">
      {/*
        ── THE HEADER CARRIES THE FIGURES NOW (4c) ─────────────────────────────────────────────
        ⚠ **THE THREE STAT CARDS ARE DELETED.** Samuel measured them: *"Devices Online, Agent's
        Running: … there are only a few lines of text on the left. The entire 80% of the right
        side is just blank white space."* He was right, and the cause was structural, not
        cosmetic: a 26px figure needs a card, and a card that size needs content three numbers do
        not have. Padding it would have been the patch; deleting the containers is the fix.

        The figures move into the header's dead middle, where they are DENSE and where they also
        solve a second problem — the row used to be a title on the left, a button on the right and
        a gap between them. One row, three jobs, no blank space.
      */}
      <header className="flex items-center gap-4 border-b border-border-subtle px-1 pb-2.5">
        <div className="flex min-w-0 shrink-0 items-baseline gap-2">
          <h2 id="home-overview-devices" className={cn("truncate", SECTION_HEADING_TEXT)}>
            Devices
          </h2>
          <span className={DEV_LABEL}>Preview</span>
        </div>

        {/* The figure strip. `justify-end` + `flex-1` means it absorbs the row's slack instead of
            leaving it blank, and each figure sits beside its neighbour rather than in a box. */}
        <div className="flex flex-1 items-baseline justify-end gap-5">
          <Figure value={`${tally.online}/${tally.devices}`} unit="online" />
          <Figure value={tally.agents} unit="agents" />
          <Figure value={DEVICES_MOCK.routes.length} unit="routed" />
        </div>

        {/* The A/B/C switcher, scoped to the section it switches. `underline` is the face the
            frame's own page tabs wear, so a tab row reads as a tab row wherever it sits. */}
        <SegmentedControl
          options={VARIANT_OPTIONS.map((v) => ({ key: v.key, label: v.label }))}
          value={variant}
          onChange={setVariant}
          variant="underline"
          ariaLabel="Devices layout"
        />

        <CreateButton onClick={() => setAdding((v) => !v)}>Add device</CreateButton>
      </header>

      {/* The preview rule, under the hairline and out of the header's way (INVARIANTS §5). */}
      <p className={cn("flex items-center gap-2 px-1", DEV_PROSE)}>
        <span>Sample data. Changes here are not saved.</span>
        {dirty && (
          <button
            type="button"
            className="cursor-pointer underline underline-offset-2 hover:text-text-primary"
            onClick={() => setHosts(DEVICES_MOCK.hosts)}
          >
            Reset
          </button>
        )}
      </p>

      {/*
        ── 4d: THE BENTO IS GONE ───────────────────────────────────────────────────────────────
        Samuel: *"the bento is not the right route. I think having so many boxes just makes it look
        really busy and weird. I think it would look a lot better without all these boxes, and it
        should just be a section header or something like that, and then something that clearly
        shows what element is in what."*

        So: ONE COLUMN of labelled blocks on the open page. The twelve-column grid, the half-width
        host tiles and the white card under each block are all deleted. What tells you what is in
        what now:

          · a hairline opens each block, and the block's label or its name is the header
          · inside a host, two quiet uppercase labels (Agents, Reaches) over row lists
          · row lists carry hairline dividers, so a list reads as a list without a frame

        ⚠ **THE HOSTS GO FULL WIDTH NOW, and that is a gain, not a concession.** At half width a
        row had ~440px and `name + qualifier + mark + duration` only just fit; the rows are
        `SettingsRow`s at full width, so the meta line no longer competes with the name.
        ⚠ The ONE box left is the Add-device chooser, where the box IS the boundary: a transient
        panel laid over the page, not a permanent frame around content.
      */}
      <div className="flex flex-col gap-3">
        {adding && <AddDeviceChooser onClose={() => setAdding(false)} />}

        <ReachBlock devices={devices} />

        {/*
          ── ITEM 4E: THREE STRUCTURES, ONE SWITCHER ─────────────────────────────────────────────
          Samuel, after four rounds: *"so much small text, with no differentiation and no clear
          indication of what each thing belongs under… Any user who looks at this is not going to
          be able to understand what's going on here."* The diagnosis was ownership: de-boxing (his
          call, and it stands) removed the skeleton, and 4d replaced it with floating caps-labels,
          which are not a skeleton at all.

          So each variant answers "what does this belong under" with a DIFFERENT MECHANISM, and
          none of them is a box — "a box only where a boundary means something" still rules:

            A · Weight     a host band closed by its own rule; children tight under it, hosts far
                           apart. Ownership is the rhythm (`./devices-variant-bands.tsx`)
            B · Tree       a 1px rail dropping from the host's glyph, each child attached by a
                           stub. Ownership is a drawn connection (`./devices-variant-tree.tsx`)
            C · Panes      a narrow list of computers; the detail shows the selected one's rows
                           and nothing else. Ownership is enforced (`./devices-variant-panes.tsx`)

          All three share the CONTENT and the type ladder (`./devices-variant-parts.tsx`), so the
          only variable between them is the structure.
        */}
        {variant === "bands" && <DevicesBands hosts={hosts} handlers={handlers} />}
        {variant === "tree" && <DevicesTree hosts={hosts} handlers={handlers} />}
        {variant === "panes" && <DevicesPanes hosts={hosts} handlers={handlers} />}
        {/* D · Cards: one white card per computer on the design language (`./devices-variant-cards.tsx`). */}
        {variant === "cards" && <DevicesCards hosts={hosts} handlers={handlers} />}
        {/* ⚠ NO section-level empty line: a variant answers its own empty state, so the three
            are interchangeable and the section never has to know which is on screen
            (`devices-variants.test.tsx` holds this). */}

        <ActivityBlock devices={devices} direct={tally.direct} />
      </div>
    </section>
  );
}

/* ------------------------------- add device ------------------------------- */

const ADD_OPTIONS = [
  { kind: "computer", title: "Mac", note: "Download Dopl and sign in. It shows up here on its own." },
  { kind: "glasses", title: "Glasses", note: "Open Dopl on your glasses and enter the 6 letter code." },
  { kind: "phone", title: "Phone", note: "Install the Dopl app and scan a code. Coming later." },
  { kind: "other", title: "Other device", note: "Connect anything else with a pairing code." },
];

export function AddDeviceChooser({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <section className={cn(DEV_CARD, "p-3.5")} aria-label="Add a device">
      <div className="flex items-center justify-between gap-2">
        <h3 className={IDENTITY_NAME_TEXT}>Add a device</h3>
        <button
          type="button"
          aria-label="Close"
          className={NAKED_ICON_BUTTON}
          onClick={onClose}
        >
          <X size={NAKED_ICON} aria-hidden />
        </button>
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-2">
        {ADD_OPTIONS.map((opt) => (
          <button
            key={opt.kind}
            type="button"
            onClick={() => setPicked(opt.kind)}
            aria-pressed={picked === opt.kind}
            className={cn(
              "flex cursor-pointer flex-col items-start gap-2 rounded-[10px] border p-3 text-left transition-colors",
              picked === opt.kind
                ? "border-border-strong bg-surface-raised-1"
                : "border-border-subtle hover:bg-surface-raised-1"
            )}
          >
            <DeviceGlyph kind={opt.kind} />
            <span className="text-body font-medium text-text-primary">{opt.title}</span>
            <span className={DEV_PROSE}>{opt.note}</span>
          </button>
        ))}
      </div>
      {picked && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
          <span className="text-caption text-text-secondary">
            {picked === "computer"
              ? "Nothing to enter. Sign in on the new Mac."
              : "Enter the code shown on the device."}
          </span>
          {picked !== "computer" && (
            <span className="flex items-center gap-2">
              <input
                aria-label="Pairing code"
                placeholder="ABC123"
                maxLength={6}
                // ⚠ `RAISED_INPUT`, NOT `.concave-field` (4d): concave surfaces are BANNED on
                // /home and swept by `identity-editor-surface.test.tsx`, which reads every file
                // under `pages/home/`. This section is under there.
                className={cn(RAISED_INPUT, "h-8 w-28 px-2 font-mono uppercase tracking-widest")}
              />
              <button type="button" disabled className={cn(PAGE_ACTION_BTN_LIGHT, "opacity-60")}>
                Pair (preview)
              </button>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
