"use client";

import { StagingFrame } from "../staging-frame";
import {
  OtherControlsSection,
  PillButtonSection,
  TabUnderlineSection,
  TextLinkSection,
} from "./system-controls";
import { ColourSection, RadiusShadowSection, TypeSection } from "./system-tokens";
import {
  EmptyStatesSection,
  FacesSection,
  HeadingsSection,
  SurfacesSection,
} from "./system-surfaces";

/**
 * `/system` — the design system's reference sheet, in the staging frame: the three control kinds
 * (Pill button, Tab underline, Text link) in every variant, size and state, then the tokens and
 * shared surfaces, each captioned with the exact name a change request can use. Renders the real
 * `src/shared/ui` primitives; nothing here is a copy. Spec: `docs/DESIGN-SYSTEM.md`.
 */
export function SystemPage() {
  return (
    <StagingFrame tab={null} showChannels={false} recordClassName="flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-240 flex-col gap-8 px-8 py-7">
          <PillButtonSection />
          <TabUnderlineSection />
          <TextLinkSection />
          <OtherControlsSection />
          <TypeSection />
          <ColourSection />
          <RadiusShadowSection />
          <SurfacesSection />
          <HeadingsSection />
          <FacesSection />
          <EmptyStatesSection />
        </div>
      </div>
    </StagingFrame>
  );
}
