import { userFacingMessage } from "@/shared/api/user-facing-message";
import { toast } from "@/shared/ui/toast";

/** Toast a knowledge API/unknown error with a friendly fallback title. */
export function reportError(err: unknown, fallback: string): void {
  toast({ title: fallback, description: userFacingMessage(err) });
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
