"use client";

import { useEffect, useState } from "react";

/**
 * The wait at the end of onboarding, as a stepped checklist instead of a
 * spinner (LAUNCH-READINESS-ROADMAP §5 "Spinners → skeletons": a spinner over
 * a multi-second provisioning call tells the user nothing except that time is
 * passing).
 *
 * The three rows are the real stages of `POST /api/onboarding/complete` —
 * the survey/MCP answers are already saved, the call names the default
 * workspace and stamps `onboarded_at`, and then the app navigates to the
 * workspace overview. There are no progress events on the wire, so the first
 * two tick on a timer and the LAST one never self-completes: it stays active
 * until this component unmounts, which happens when the navigation it names
 * actually lands. Nothing here can claim to be done when it isn't.
 *
 * Onboarding is exempt from the token/type scale (DESIGN-SYSTEM: "Exempt:
 * marketing pages and auth + onboarding (their own crystal/3D kit)"), so the
 * px/hex values here match the sibling steps rather than the app tokens.
 */

const STEPS = [
  "Saving your setup",
  "Naming your workspace",
  "Opening Dopl",
] as const;

/** Roughly the cadence of the two serial writes behind the call. */
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

/**
 * Done = filled tick. Active = the pulsing dot the connect step already uses
 * for "Waiting for your agent…" (a status indicator, deliberately not a
 * spinner). Pending = hollow ring.
 */
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
