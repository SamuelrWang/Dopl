"use client";

import { useRef } from "react";
import { CrystalField } from "@/shared/design/crystal-field";

/**
 * Full-screen overlay shell for /onboarding: a dark crystal-tile field framing
 * the centered flow. The flow renders as a bright panel floating in the field;
 * its bounding box is handed to CrystalField as an occlusion rect so hidden
 * tiles skip excitation.
 */
export function OnboardingShell({ children }: { children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-[#07070B] text-[#e7ecf2]"
      style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
    >
      <CrystalField occlusionRef={panelRef} />
      <div className="absolute inset-0 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center px-6 py-12">
          <div ref={panelRef} className="relative z-10">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
