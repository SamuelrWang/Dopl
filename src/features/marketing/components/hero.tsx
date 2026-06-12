import Link from "next/link";

import { HeroRibbon } from "./hero-ribbon";
import { Reveal } from "./reveal";

/**
 * Hero: oversized two-tone serif headline over the ice background, with
 * the context-in / actions-out ribbon animation flowing beneath it.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden pt-40 pb-8">
      <div className="mx-auto max-w-5xl px-6 text-center">
        <Reveal>
          <h1 className="font-(family-name:--font-playfair) text-5xl leading-[1.05] tracking-tight text-balance sm:text-7xl">
            <span className="text-[#8a93a3]">Teach once,</span>{" "}
            <span className="text-[#10131a]">delegate everywhere</span>
          </h1>
        </Reveal>
        <Reveal delay={120}>
          <p className="mx-auto mt-6 max-w-xl text-lg text-[#5b6573]">
            One workspace for your team&apos;s knowledge, skills, and
            workflows — connected to every AI agent your team uses.
          </p>
        </Reveal>
        <Reveal delay={220}>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/login"
              className="rounded-xl bg-[#2f6fed] px-6 py-3 font-semibold text-white shadow-[0_12px_28px_-10px_rgba(47,111,237,0.6)] transition-colors hover:bg-[#3d7bff]"
            >
              Get started free
            </Link>
            <Link
              href="/docs"
              className="rounded-xl border border-[#10131a]/15 bg-white px-6 py-3 font-semibold text-[#10131a] transition-colors hover:border-[#10131a]/30"
            >
              See how it works
            </Link>
          </div>
        </Reveal>
        <Reveal delay={320}>
          <p className="mt-5 text-sm text-[#8a93a3]">
            Works with Claude Code, Codex, Cursor, and any MCP client
          </p>
        </Reveal>
      </div>
      <div className="mt-2 -mb-10">
        <HeroRibbon />
      </div>
    </section>
  );
}
