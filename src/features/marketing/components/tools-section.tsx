import Link from "next/link";

import { AGENT_TOOLS } from "../constants";
import { Reveal } from "./reveal";

function ToolChip({ name, mark }: { name: string; mark: string }) {
  return (
    <div className="mx-3 flex shrink-0 items-center gap-3 rounded-2xl border border-white/12 bg-white/[0.05] px-5 py-3.5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-[#4a9eff]/15 text-sm font-bold text-[#4a9eff]">
        {mark}
      </span>
      <span className="font-medium text-white/90">{name}</span>
    </div>
  );
}

function MarqueeRow({ reverse, duration }: { reverse?: boolean; duration: string }) {
  const row = (
    <>
      {AGENT_TOOLS.map((tool) => (
        <ToolChip key={tool.name} name={tool.name} mark={tool.mark} />
      ))}
    </>
  );
  return (
    <div
      className={`mk-marquee ${reverse ? "mk-marquee-reverse" : ""}`}
      style={{ "--mk-marquee-duration": duration } as React.CSSProperties}
    >
      <div className="flex">{row}</div>
      <div className="flex" aria-hidden>
        {row}
      </div>
    </div>
  );
}

/**
 * Dark full-bleed section: every agent tool, one workspace. Two
 * counter-scrolling chip marquees on a slight diagonal carry the visual.
 */
export function ToolsSection() {
  return (
    <section className="relative overflow-hidden rounded-[40px] bg-[#0b0e14] py-24">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <Reveal>
          <h2 className="font-(family-name:--font-playfair) text-4xl tracking-tight text-balance text-white sm:text-5xl">
            Every agent your team runs, one workspace
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="mx-auto mt-5 max-w-xl text-white/65">
            Connect Dopl once over OAuth — no API keys, no config files —
            and every agent picks up the same skills, knowledge, and
            workflows.
          </p>
        </Reveal>
        <Reveal delay={220}>
          <Link
            href="/docs"
            className="mt-7 inline-block rounded-xl border border-white/20 bg-white/[0.06] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
          >
            Connect in one click
          </Link>
        </Reveal>
      </div>

      <div className="mt-16 -rotate-2 space-y-5">
        <MarqueeRow duration="36s" />
        <MarqueeRow reverse duration="44s" />
      </div>

      <div
        className="pointer-events-none absolute -bottom-40 left-1/2 h-80 w-[640px] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: "#3d7bff" }}
      />
    </section>
  );
}
