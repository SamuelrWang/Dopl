"use client";

import { useEffect, useState } from "react";

/**
 * End-of-onboarding wait as a stepped checklist, not a spinner
 * (LAUNCH-READINESS-ROADMAP §5).
 *
 * Rows are the real stages of `POST /api/onboarding/complete`. ⚠ No progress
 * events on the wire: first two tick on a timer, the LAST never self-completes
 * — it stays active until unmount, i.e. until the navigation it names lands.
 * Nothing may claim done when it isn't.
 *
 * px/hex here, not tokens: auth + onboarding are DESIGN-SYSTEM-exempt (own
 * glass/3D kit), and these match the sibling steps.
 */

const STEPS = [
  "Saving your setup",
  "Naming your workspace",
  "Opening Dopl",
] as const;

/** ~cadence of the two serial writes behind the call. */
const STEP_MS = 850;

export function ProvisioningChecklist() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (active >= STEPS.length - 1) return;
    const id = setTimeout(() => setActive((i) => i + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [active]);

  return (
    <div
      className="flex flex-col gap-3.5 py-10"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {STEPS.map((label, i) => {
        const done = i < active;
        return (
          <div key={label} className="flex items-center gap-3">
            <Marker done={done} active={i === active} />
            <span
              className="text-[15px] transition-colors duration-300"
              style={{ color: i <= active ? "#181818" : "#a1a1a1" }}
            >
              {label}
              {done ? "" : "…"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Done = filled tick. Active = pulsing dot (same status indicator the connect
 *  step uses — deliberately not a spinner). Pending = hollow ring. */
function Marker({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#181818]">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M1.5 5.2 4 7.5 8.5 2.5"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[#d8d8d8]">
      {active && (
        <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-[#181818]" />
      )}
    </span>
  );
}
