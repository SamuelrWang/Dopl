"use client";

import { useState } from "react";
import { Plus, Settings, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CHROME_ICON_BUTTON } from "@/shared/ui/chrome-icon-button";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import {
  CreateButton,
  PILL_ICON,
  pillButton,
  type PillSize,
  type PillVariant,
} from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import { SMALL_PRIMARY_BUTTON, SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { TabUnderline } from "@/shared/ui/tab-underline";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import { SpecimenRow, Specimen, SystemSection } from "./specimen";

const VARIANTS: ReadonlyArray<PillVariant> = ["outline", "quiet", "white", "ink"];
const SIZES: ReadonlyArray<PillSize> = ["xs", "sm", "md", "lg", "fit"];
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "channels", label: "Channels" },
  { key: "knowledge", label: "Knowledge" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function PillButtonSection() {
  return (
    <SystemSection
      id="pill-button"
      title="Pill button"
      rule="Every rounded-full button: pillButton(variant, size). white and ink stand on their lift."
    >
      {VARIANTS.map((variant) => (
        <SpecimenRow key={variant} label={variant}>
          {SIZES.map((size) => (
            <Specimen key={size} name={`pillButton("${variant}", "${size}")`}>
              <button type="button" className={pillButton(variant, size)}>
                {size === "lg" && <Plus size={PILL_ICON.lg} aria-hidden="true" />}
                {variant === "ink" ? "Open thread" : "Launch agent"}
              </button>
            </Specimen>
          ))}
          <Specimen name={`pillButton("${variant}", "md") disabled`}>
            <button type="button" disabled className={cn(pillButton(variant, "md"), "disabled:opacity-60")}>
              Disabled
            </button>
          </Specimen>
        </SpecimenRow>
      ))}
      <SpecimenRow label="lift">
        <Specimen name={`pillButton("outline", "md", { raise: true })`}>
          <button type="button" className={pillButton("outline", "md", { raise: true })}>
            Raised outline
          </button>
        </Specimen>
        <Specimen name={`pillButton("ink", "md", { raise: false })`}>
          <button type="button" className={pillButton("ink", "md", { raise: false })}>
            Flat ink
          </button>
        </Specimen>
        <Specimen name="CreateButton">
          <CreateButton onClick={() => {}}>Knowledge base</CreateButton>
        </Specimen>
      </SpecimenRow>
    </SystemSection>
  );
}

export function TabUnderlineSection() {
  const [tab, setTab] = useState<TabKey>("channels");
  const [rail, setRail] = useState<TabKey>("overview");
  return (
    <SystemSection
      id="tab-underline"
      title="Tab underline"
      rule="A switcher's selection mark: a 2px ink rule at the tab's bottom edge, on the selected tab only."
    >
      <SpecimenRow>
        <Specimen name={`SegmentedControl variant="underline"`}>
          <SegmentedControl variant="underline" options={TABS} value={tab} onChange={setTab} ariaLabel="Small tabs" />
        </Specimen>
        <Specimen name={`SegmentedControl variant="underline" size="lg"`}>
          <SegmentedControl variant="underline" size="lg" options={TABS} value={tab} onChange={setTab} ariaLabel="Header tabs" />
        </Specimen>
        <Specimen name={`SegmentedControl variant="underline" size="lg" orientation="vertical"`}>
          <SegmentedControl
            variant="underline"
            size="lg"
            orientation="vertical"
            options={TABS}
            value={rail}
            onChange={setRail}
            ariaLabel="Rail tabs"
          />
        </Specimen>
        <Specimen name="TabUnderline (a tab holding a ×)">
          <span className="relative flex h-8.5 items-center gap-1.5 px-2 text-body font-semibold text-text-primary">
            Coder
            <X size={12} aria-hidden="true" className="text-text-muted" />
            <TabUnderline />
          </span>
        </Specimen>
      </SpecimenRow>
    </SystemSection>
  );
}

export function TextLinkSection() {
  return (
    <SystemSection
      id="text-link"
      title="Text link"
      rule="Plain text; the ink underline sits close under the letters on hover and keyboard focus."
    >
      <SpecimenRow>
        <Specimen name="TEXT_LINK_BUTTON">
          <button type="button" className={cn(TEXT_LINK_BUTTON, "text-caption font-medium text-text-primary")}>
            See all
          </button>
        </Specimen>
        <Specimen name="TEXT_LINK_BUTTON (secondary ink)">
          <button type="button" className={cn(TEXT_LINK_BUTTON, "text-small text-text-secondary")}>
            New file
          </button>
        </Specimen>
        <Specimen name={`SelectMenu variant="link"`}>
          <LinkSelect />
        </Specimen>
      </SpecimenRow>
    </SystemSection>
  );
}

function LinkSelect() {
  const [value, setValue] = useState<"canvas" | "rows">("rows");
  return (
    <SelectMenu
      value={value}
      options={[
        { value: "canvas", label: "Canvas" },
        { value: "rows", label: "Rows" },
      ]}
      onChange={setValue}
      ariaLabel="Board display"
      variant="link"
    />
  );
}

export function OtherControlsSection() {
  const [seg, setSeg] = useState<TabKey>("overview");
  return (
    <SystemSection id="other-controls" title="Other controls" rule="Not one of the three kinds; listed so each has a name.">
      <SpecimenRow label="buttons">
        <Specimen name="SMALL_PRIMARY_BUTTON">
          <button type="button" className={SMALL_PRIMARY_BUTTON}>
            Create
          </button>
        </Specimen>
        <Specimen name="SMALL_TEXT_BUTTON">
          <button type="button" className={SMALL_TEXT_BUTTON}>
            Discard
          </button>
        </Specimen>
        <Specimen name="CHROME_ICON_BUTTON">
          <button type="button" aria-label="Settings" className={CHROME_ICON_BUTTON}>
            <Settings size={15} aria-hidden="true" />
          </button>
        </Specimen>
        <Specimen name="NAKED_ICON_BUTTON">
          <button type="button" aria-label="Close" className={NAKED_ICON_BUTTON}>
            <X size={NAKED_ICON} aria-hidden="true" />
          </button>
        </Specimen>
      </SpecimenRow>
      <SpecimenRow label="segmented">
        {(["pills", "track", "plain"] as const).map((variant) => (
          <Specimen key={variant} name={`SegmentedControl variant="${variant}"`}>
            <SegmentedControl variant={variant} options={TABS} value={seg} onChange={setSeg} ariaLabel={variant} />
          </Specimen>
        ))}
      </SpecimenRow>
    </SystemSection>
  );
}
