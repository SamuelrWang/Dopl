"use client";

import { RevealGate } from "../reveal";

const ROWS = [
  { resource: "Code review skill", team: "Engineering", on: true },
  { resource: "Brand voice KB", team: "Marketing", on: true },
  { resource: "Lead enrichment", team: "Sales", on: true },
  { resource: "Pricing sheet KB", team: "Sales", on: false },
  { resource: "Incident runbooks", team: "Engineering", on: true },
];

/**
 * Admin-console card: resource rows with team badges and access toggles,
 * sliding in row by row.
 */
export function AdminMock({ className }: { className?: string }) {
  return (
    <RevealGate className={className}>
      {(started) => (
        <div className="relative overflow-hidden rounded-3xl bg-[#12161f] p-7 shadow-[0_24px_60px_-24px_rgba(14,34,64,0.55)] ring-1 ring-white/10">
          <p className="font-semibold text-white/95">Workspace Admin</p>
          <div className="mt-6 flex flex-col gap-2.5">
            {ROWS.map((row, i) => (
              <div
                key={row.resource}
                className={`flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 ${started ? "mk-pill" : ""}`}
                style={
                  {
                    opacity: started ? undefined : 0,
                    "--mk-delay": `${i * 110}ms`,
                    "--mk-pill-from": "-40px",
                  } as React.CSSProperties
                }
              >
                <span className="truncate text-sm font-medium text-white/90">
                  {row.resource}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="rounded-full border border-[#4a9eff]/40 bg-[#4a9eff]/10 px-2.5 py-0.5 text-xs font-medium text-[#bcd9ff]">
                    {row.team}
                  </span>
                  <span
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${row.on ? "bg-[#3d7bff]" : "bg-white/15"}`}
                    aria-hidden
                  >
                    <span
                      className={`absolute size-4 rounded-full bg-white transition-transform ${row.on ? "translate-x-[18px]" : "translate-x-0.5"}`}
                    />
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div
            className="pointer-events-none absolute -bottom-20 -left-20 size-56 rounded-full opacity-25 blur-3xl"
            style={{ background: "#3d7bff" }}
          />
        </div>
      )}
    </RevealGate>
  );
}
