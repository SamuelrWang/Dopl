import { toast } from "@/shared/ui/toast";
import { KnowledgeApiError } from "../../client/api";
import { kbScope, type KbScope } from "../../scope";
import type { KnowledgeBase } from "../../types";

/** Toast a knowledge API/unknown error with a friendly fallback title. */
export function reportError(err: unknown, fallback: string): void {
  if (err instanceof KnowledgeApiError) {
    toast({ title: fallback, description: err.message });
    return;
  }
  toast({
    title: fallback,
    description: err instanceof Error ? err.message : "Unknown error",
  });
}

/** Stable per-scope tile tint for KB / entry icons. Decorative. */
const SCOPE_TINT: Record<KbScope, string> = {
  private: "#8b7cf0",
  team: "#e0894a",
  workspace: "#4a7fe0",
};

export function baseTint(base: Pick<KnowledgeBase, "visibility" | "accessMode">): string {
  return SCOPE_TINT[kbScope(base)];
}

/** "Today" / "Yesterday" / "5 May" — list-row timestamp. */
export function shortWhen(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "Mon 5 May 05:00PM" — detail meta-field timestamp. */
export function longWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(" ", "");
  return `${date} ${time}`;
}

/** First grapheme of a name, upper-cased — avatar / tile fallback. */
export function initial(name: string): string {
  return (name.trim()[0] || "?").toUpperCase();
}
