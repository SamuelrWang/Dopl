import { BookOpen, Sparkles, Users } from "lucide-react";
import type { LinkLike } from "@/shared/ui/link-like";

export interface OverviewStatsCoreProps {
  segment: string;
  knowledgeBases: number;
  skills: number;
  members: number;
  /** Router-agnostic link — `next/link` in the web app, react-router in the SPA. */
  Link: LinkLike;
}

/**
 * Stat row's Next-free core (`./overview-stats` is the web binding). Each card
 * deep-links into its section, so the row doubles as navigation — ⚠ a stat card
 * whose href is not a route is a link to "Not found".
 */
export function OverviewStatsCore({
  segment,
  knowledgeBases,
  skills,
  members,
  Link,
}: OverviewStatsCoreProps) {
  const cards = [
    {
      label: "Knowledge bases",
      count: knowledgeBases,
      href: `/${segment}/knowledge`,
      icon: BookOpen,
      hint: "for durable context",
    },
    {
      label: "Skills",
      count: skills,
      href: `/${segment}/skills`,
      icon: Sparkles,
      hint: "agent playbooks",
    },
    {
      label: "Members",
      count: members,
      href: `/${segment}/members`,
      icon: Users,
      hint: "in this workspace",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map(({ label, count, href, icon: Icon, hint }) => (
        <Link
          key={label}
          href={href}
          className="group rounded-xl border border-border-default bg-[var(--card-surface)] p-4 transition-colors hover:border-border-strong"
        >
          <div className="flex items-center justify-between">
            <Icon size={14} className="text-text-secondary/70" />
            <span className="text-label font-mono uppercase tracking-wider text-text-secondary/50">
              {label}
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-text-primary">
            {count}
          </p>
          <p className="mt-0.5 text-caption text-text-tertiary group-hover:text-text-secondary transition-colors">
            {hint}
          </p>
        </Link>
      ))}
    </div>
  );
}
