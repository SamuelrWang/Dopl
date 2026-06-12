"use client";

import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { TEAMS } from "../constants";
import { Reveal } from "./reveal";

/**
 * Dark teams section: chip selector swaps a preview of the skills and
 * knowledge that team's agents receive — the resource-distribution
 * feature, shown instead of explained.
 */
export function TeamsSection() {
  const [activeId, setActiveId] = useState(TEAMS[0].id);
  const active = TEAMS.find((team) => team.id === activeId) ?? TEAMS[0];

  return (
    <section className="relative overflow-hidden rounded-[40px] bg-[#0b0e14] py-24">
      <div className="mx-auto max-w-5xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <Reveal>
              <h2 className="font-(family-name:--font-playfair) text-4xl tracking-tight text-balance text-white sm:text-5xl">
                Every team,{" "}
                <span className="text-[#4a9eff] italic">their own</span>{" "}
                toolkit
              </h2>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-5 max-w-md text-white/65">
                Split your workspace into teams and decide exactly which
                skills and knowledge each one&apos;s agents get.
              </p>
            </Reveal>
            <Reveal delay={200}>
              <div className="mt-8 flex flex-wrap gap-2.5">
                {TEAMS.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setActiveId(team.id)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                      team.id === activeId
                        ? "border-[#4a9eff] bg-[#4a9eff]/15 text-[#bcd9ff]"
                        : "border-white/15 text-white/70 hover:border-white/35 hover:text-white",
                    )}
                  >
                    {team.label}
                  </button>
                ))}
              </div>
            </Reveal>
          </div>

          <Reveal delay={150}>
            <div
              key={active.id}
              className="relative overflow-hidden rounded-3xl bg-[#12161f] p-7 ring-1 ring-white/10"
            >
              <p className="font-semibold text-white/95">{active.label} agents get</p>
              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <ResourceList label="Skills" items={active.skills} />
                <ResourceList label="Knowledge" items={active.knowledge} />
              </div>
              <div
                className="pointer-events-none absolute -bottom-16 -right-16 size-48 rounded-full opacity-25 blur-3xl"
                style={{ background: "#3d7bff" }}
              />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function ResourceList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-white/45 uppercase">
        {label}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {items.map((item, i) => (
          <div
            key={item}
            className="mk-pill rounded-full border border-[#4a9eff]/40 bg-[#4a9eff]/10 px-3.5 py-1.5 text-sm text-[#bcd9ff]"
            style={
              {
                "--mk-delay": `${i * 80}ms`,
                "--mk-pill-from": "24px",
              } as React.CSSProperties
            }
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
