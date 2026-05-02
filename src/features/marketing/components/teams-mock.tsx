import { BookOpen, Check, Plus, Sparkles } from "lucide-react";

import { cn } from "@/shared/lib/utils";

import { PageTopBar } from "./page-top-bar";

export function TeamsMock() {
  const teams = [
    { name: "Engineering", count: 8, color: "bg-cyan-500/80" },
    { name: "Marketing", count: 4, color: "bg-fuchsia-500/80" },
    { name: "Founders", count: 2, color: "bg-amber-500/80" },
  ];
  const resources: {
    kind: "kb" | "skill";
    name: string;
    access: boolean[];
  }[] = [
    { kind: "kb", name: "AI agents", access: [true, true, true] },
    { kind: "kb", name: "Marketing playbooks", access: [false, true, true] },
    { kind: "kb", name: "Internal docs", access: [true, true, true] },
    {
      kind: "skill",
      name: "Cold outreach email writer",
      access: [false, true, true],
    },
    {
      kind: "skill",
      name: "Polymarket trading bot",
      access: [false, false, true],
    },
    {
      kind: "skill",
      name: "Code review assistant",
      access: [true, false, true],
    },
  ];

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "oklch(0.11 0 0)" }}
    >
      <PageTopBar
        title="Teams"
        right={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] text-black bg-white px-2.5 py-1 rounded-md font-medium"
          >
            <Plus size={12} /> New team
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {teams.map((t) => (
              <div
                key={t.name}
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className={cn(
                      "w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-semibold text-white",
                      t.color,
                    )}
                  >
                    {t.name[0]}
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-white">
                      {t.name}
                    </div>
                    <div className="text-[11px] text-white/40">
                      {t.count} members
                    </div>
                  </div>
                </div>
                <div className="flex -space-x-1.5">
                  {Array.from({ length: Math.min(t.count, 4) }).map((_, i) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded-full ring-2 ring-[oklch(0.11_0_0)] bg-gradient-to-br from-white/30 to-white/10"
                    />
                  ))}
                  {t.count > 4 && (
                    <div className="w-6 h-6 rounded-full ring-2 ring-[oklch(0.11_0_0)] bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[9px] text-white/60">
                      +{t.count - 4}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-white">
                  Access matrix
                </div>
                <div className="text-[11px] text-white/40 mt-0.5">
                  Scope knowledge bases and skills to teams
                </div>
              </div>
              <button
                type="button"
                className="text-[11px] text-white/60 hover:text-white px-2 py-1 border border-white/[0.06] rounded-md"
              >
                Edit
              </button>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.01]">
                  <th className="text-left font-normal text-[10px] uppercase tracking-wider text-white/40 px-5 py-2">
                    Resource
                  </th>
                  {teams.map((t) => (
                    <th
                      key={t.name}
                      className="text-left font-normal text-[10px] uppercase tracking-wider text-white/40 px-3 py-2"
                    >
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {resources.map((r) => (
                  <tr key={r.name}>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        {r.kind === "kb" ? (
                          <BookOpen size={13} className="text-white/40" />
                        ) : (
                          <Sparkles size={13} className="text-amber-400/70" />
                        )}
                        <span className="text-white/80">{r.name}</span>
                      </div>
                    </td>
                    {r.access.map((g, i) => (
                      <td key={i} className="px-3 py-2.5">
                        {g ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                            <Check size={11} />
                          </span>
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
