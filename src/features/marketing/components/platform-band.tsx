import { AGENT_TOOLS } from "../constants";
import { Reveal } from "./reveal";

/**
 * Soft blue band: a quiet strip restating that Dopl lives wherever the
 * team's agents live, with one chip per supported tool.
 */
export function PlatformBand() {
  return (
    <section className="rounded-[40px] bg-[#dce7f8] py-16">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <Reveal>
          <h2 className="font-(family-name:--font-playfair) text-3xl tracking-tight text-balance text-[#10131a]">
            Wherever your agents work
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            {AGENT_TOOLS.map((tool) => (
              <span
                key={tool.name}
                className="rounded-full border border-[#0e2240]/20 bg-white/70 px-4 py-2 text-sm font-medium text-[#0e2240]"
              >
                {tool.name}
              </span>
            ))}
            <span className="rounded-full border border-[#0e2240]/20 bg-white/70 px-4 py-2 text-sm font-medium text-[#0e2240]">
              Any MCP client
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
