import { cn } from "@/shared/lib/utils";
import { AGENT_COLOR_KEYS, agentColorVar } from "@/shared/lib/agent-colors";
import { SpecimenRow, Specimen, SystemSection } from "./specimen";

const TYPE_SCALE = [
  ["text-micro", "10.5px"],
  ["text-label", "11px"],
  ["text-caption", "11.5px"],
  ["text-small", "12px"],
  ["text-body", "12.5px"],
  ["text-lead", "13px"],
  ["text-title", "14px"],
  ["text-heading", "15px"],
  ["text-display", "18px"],
  ["text-stat", "26px"],
] as const;

const DOC_SCALE = ["--doc-code", "--doc-table", "--doc-h4", "--doc-text", "--doc-h2", "--doc-h1"] as const;

const COLOURS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["surfaces", ["--bg-base", "--bg-elevated", "--bg-inset", "--bg-overlay", "--panel-surface", "--card-surface-subtle", "--modal-surface", "--home-frame", "--home-panel", "--home-card"]],
  ["ink", ["--text-primary", "--text-secondary", "--text-tertiary", "--text-muted", "--text-disabled", "--link", "--accent-primary"]],
  ["lines", ["--border-subtle", "--border-default", "--border-strong", "--border-highlight", "--border-active", "--home-panel-line", "--focus-line"]],
  ["tints", ["--surface-raised-1", "--surface-raised-2", "--surface-raised-3", "--surface-raised-4", "--surface-selected", "--menu-item-hover-bg", "--seg-fill"]],
  ["solids", ["--surface-cta", "--surface-invert", "--scrim", "--chart-bar"]],
  ["status", ["--success", "--caution", "--warning", "--danger"]],
];

const RADII = [
  ["rounded-xs", "2px"],
  ["rounded-mark", "4px"],
  ["rounded-sm", "6px"],
  ["rounded-tile", "7px"],
  ["rounded-md", "8px"],
  ["rounded-field", "9px"],
  ["rounded-lg", "10px"],
  ["rounded-card", "12px"],
  ["rounded-xl", "14px"],
  ["rounded-2xl", "18px"],
  ["rounded-3xl", "22px"],
  ["rounded-4xl", "26px"],
  ["rounded-full", "pill"],
] as const;

const SHADOWS = [
  "--shadow-hairline",
  "--shadow-bento",
  "--shadow-raise",
  "--shadow-raise-hover",
  "--shadow-card-lift",
  "--shadow-raise-ink",
  "--shadow-raised-hover",
  "--shadow-elevated",
] as const;

const LAYERS = ["--layer-raised", "--layer-float", "--layer-menu-scrim", "--layer-menu", "--layer-top"] as const;

export function TypeSection() {
  return (
    <SystemSection id="type" title="Type scale" rule="Semantic text-* utilities for all interface text; never raw px.">
      <div className="flex flex-col gap-2">
        {TYPE_SCALE.map(([cls, px]) => (
          <Specimen key={cls} name={`${cls} · ${px}`}>
            <span className={cn(cls, "text-text-primary")}>The agent opened a thread</span>
          </Specimen>
        ))}
      </div>
      <SpecimenRow label="document reading scale">
        {DOC_SCALE.map((v) => (
          <Specimen key={v} name={`text-(length:${v})`}>
            <span className="text-text-primary" style={{ fontSize: `var(${v})` }}>
              Renewals
            </span>
          </Specimen>
        ))}
      </SpecimenRow>
    </SystemSection>
  );
}

export function ColourSection() {
  return (
    <SystemSection id="colour" title="Colour tokens" rule="Every colour is a token; the utility is its name (bg-bg-inset, text-text-muted).">
      {COLOURS.map(([group, vars]) => (
        <SpecimenRow key={group} label={group}>
          {vars.map((v) => (
            <Specimen key={v} name={v}>
              <span className="block h-10 w-20 rounded-md border border-border-default" style={{ background: `var(${v})` }} />
            </Specimen>
          ))}
        </SpecimenRow>
      ))}
      <SpecimenRow label="agent colours (identity, never status)">
        {AGENT_COLOR_KEYS.map((key) => (
          <Specimen key={key} name={key}>
            <span className="block size-6 rounded-full" style={{ background: agentColorVar(key) }} />
          </Specimen>
        ))}
      </SpecimenRow>
    </SystemSection>
  );
}

export function RadiusShadowSection() {
  return (
    <SystemSection id="radius-shadow" title="Radii, shadows, layers">
      <SpecimenRow label="radii">
        {RADII.map(([cls, px]) => (
          <Specimen key={cls} name={`${cls} · ${px}`}>
            <span className={cn(cls, "block h-12 w-16 border border-border-strong bg-bg-inset")} />
          </Specimen>
        ))}
      </SpecimenRow>
      <SpecimenRow label="shadows">
        {SHADOWS.map((v) => (
          <Specimen key={v} name={`shadow-(${v})`}>
            <span className="block h-14 w-24 rounded-card bg-bg-overlay" style={{ boxShadow: `var(${v})` }} />
          </Specimen>
        ))}
      </SpecimenRow>
      <SpecimenRow label="stacking layers (lowest first)">
        {LAYERS.map((v) => (
          <Specimen key={v} name={`z-(${v})`}>
            <span className="text-caption text-text-secondary">{v.replace("--layer-", "")}</span>
          </Specimen>
        ))}
      </SpecimenRow>
    </SystemSection>
  );
}
