"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTheme, type Theme } from "@/shared/hooks/use-theme";
import { SectionShell } from "./section-shell";

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
];

/**
 * Appearance section — pick the dark or light theme. The choice persists in
 * localStorage (no-flash on reload) and syncs to the server preference for
 * cross-device. Marketing/auth/docs routes always render dark regardless.
 */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <SectionShell title="Appearance" subtitle="Choose how Dopl looks to you">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
          Theme
        </label>
        <div className="grid grid-cols-2 gap-2 max-w-sm">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-2.5 px-3 h-10 rounded-lg border text-sm transition-colors cursor-pointer",
                  active
                    ? "border-border-active bg-surface-raised-3 text-text-primary"
                    : "border-border-default text-text-tertiary hover:bg-surface-raised-2 hover:text-text-primary",
                )}
              >
                <Icon size={16} className="shrink-0" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-muted">
          Light mode applies to the app. Marketing and docs pages stay dark.
        </p>
      </div>
    </SectionShell>
  );
}
