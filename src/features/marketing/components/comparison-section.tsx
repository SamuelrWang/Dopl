import { Reveal } from "./reveal";

const WITHOUT = [
  "Paste the style guide… again",
  "Re-explain the architecture",
  "Dig up last quarter's decisions",
  "Every session starts at zero",
];

const WITH = [
  "Skills loaded",
  "Knowledge loaded",
  "Workflows ready",
  "Working in seconds",
];

/**
 * Light comparison section: a flat grey "every session from scratch" card
 * against a glowing dark "context already there" card.
 */
export function ComparisonSection() {
  return (
    <section className="py-28">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal className="text-center">
          <h2 className="font-(family-name:--font-playfair) text-4xl tracking-tight text-balance text-[#10131a] sm:text-5xl">
            Onboard agents like employees
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[#5b6573]">
            New teammates get docs, playbooks, and a team. Your agents
            should too — once, not every single session.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          <Reveal delay={100}>
            <div className="h-full rounded-3xl border border-[#10131a]/10 bg-white p-7">
              <p className="text-sm font-semibold tracking-wide text-[#8a93a3] uppercase">
                Without Dopl
              </p>
              <div className="mt-6 space-y-3">
                {WITHOUT.map((line) => (
                  <div
                    key={line}
                    className="rounded-xl bg-[#f2f5fa] px-4 py-3 text-sm text-[#5b6573] line-through decoration-[#8a93a3]/50"
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={220}>
            <div className="relative h-full overflow-hidden rounded-3xl bg-[#0b0e14] p-7 ring-1 ring-[#4a9eff]/30">
              <p className="text-sm font-semibold tracking-wide text-[#4a9eff] uppercase">
                With Dopl
              </p>
              <div className="mt-6 space-y-3">
                {WITH.map((line) => (
                  <div
                    key={line}
                    className="flex items-center gap-2.5 rounded-xl border border-[#4a9eff]/30 bg-[#4a9eff]/10 px-4 py-3 text-sm font-medium text-[#dce7f8]"
                  >
                    <span className="text-[#4a9eff]">✓</span>
                    {line}
                  </div>
                ))}
              </div>
              <div
                className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full opacity-30 blur-3xl"
                style={{ background: "#3d7bff" }}
              />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
