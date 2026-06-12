import Link from "next/link";

import { Reveal } from "./reveal";

/**
 * Full-bleed closing CTA: ink-to-deep-blue gradient with a pulsing
 * accent glow behind the headline.
 */
export function CtaSection() {
  return (
    <section
      className="relative overflow-hidden rounded-[40px] py-32"
      style={{
        background: "linear-gradient(160deg, #0b0e14 0%, #0e2240 70%, #143158 100%)",
      }}
    >
      <div
        className="mk-glow pointer-events-none absolute top-1/2 left-1/2 h-72 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: "#3d7bff" }}
      />
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <Reveal>
          <h2 className="font-(family-name:--font-playfair) text-5xl tracking-tight text-balance text-white sm:text-6xl">
            Start delegating
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="mx-auto mt-5 max-w-md text-white/65">
            Set up your workspace, connect your agents, and put your
            team&apos;s knowledge to work.
          </p>
        </Reveal>
        <Reveal delay={220}>
          <div className="mt-9 flex items-center justify-center gap-3">
            <Link
              href="/login"
              className="rounded-xl bg-white px-6 py-3 font-semibold text-[#0b0e14] transition-colors hover:bg-[#dce7f8]"
            >
              Get started free
            </Link>
            <Link
              href="/pricing"
              className="rounded-xl border border-white/25 px-6 py-3 font-semibold text-white transition-colors hover:bg-white/10"
            >
              View pricing
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
