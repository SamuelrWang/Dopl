"use client";

import { useState } from "react";
import { Eye, PencilLine } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MOCK_PROFILE } from "../mock-data";
import type { ConfigMode } from "../types";
import { EmployeeView } from "./employee-view";
import { ManagerView } from "./manager-view";

/**
 * Configuration page root — static UI preview. The mode toggle flips
 * between the manager's edit surface and what an employee on the team
 * would see. All data is mock (see ../mock-data.ts).
 */
export function ConfigurationView() {
  const [mode, setMode] = useState<ConfigMode>("manager");

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-7">
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-snug tracking-tight text-text-primary">
            Configuration
          </h1>
          <p className="mt-0.5 text-sm leading-relaxed text-text-secondary">
            One profile for your team&apos;s agents — skills, connections,
            instructions, and guardrails, kept in sync for everyone.
          </p>
        </div>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {mode === "manager" ? (
        <ManagerView profile={MOCK_PROFILE} />
      ) : (
        <EmployeeView profile={MOCK_PROFILE} />
      )}
    </div>
  );
}

const MODES: ReadonlyArray<{
  id: ConfigMode;
  label: string;
  icon: typeof PencilLine;
}> = [
  { id: "manager", label: "Manager edit", icon: PencilLine },
  { id: "employee", label: "Employee view", icon: Eye },
];

function ModeToggle({
  mode,
  onChange,
}: {
  mode: ConfigMode;
  onChange: (mode: ConfigMode) => void;
}) {
  const activeIndex = MODES.findIndex((m) => m.id === mode);
  return (
    <div className="relative flex items-center gap-1 rounded-[10px] border border-black/[0.06] bg-[#e9eaec] p-1 shadow-[inset_0_2px_4px_rgba(0,0,0,0.12),inset_0_1px_2px_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(255,255,255,0.85)]">
      <span
        className="pointer-events-none absolute top-1 left-1 h-7 w-[130px] rounded-[7px] bg-gradient-to-b from-white to-[#f3f3f3] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_0_0_1px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.12),0_3px_6px_rgba(0,0,0,0.08)] transition-transform duration-200"
        style={{ transform: `translateX(${activeIndex * 134}px)` }}
        aria-hidden
      />
      {MODES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "relative z-[1] flex h-7 w-[130px] items-center justify-center gap-1.5 rounded-[7px] text-xs font-medium transition-colors",
            id === mode ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
          )}
        >
          <Icon size={13} />
          {label}
        </button>
      ))}
    </div>
  );
}
