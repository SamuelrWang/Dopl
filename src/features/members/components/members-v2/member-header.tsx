"use client";

import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatDate, formatLastActive } from "@/shared/lib/format-time";
import type { WorkspaceMemberView } from "../../types";
import { RolePillOnInvert, StatBlock } from "./bits";
import { displayNameOf } from "./view-model";
import { DETAIL_TAB_LABEL, type DetailTabKey, type MemberVisibility } from "./visibility";

export function MemberHeader({
  member: m,
  visibility,
  tabs,
  tab,
  onTabChange,
}: {
  member: WorkspaceMemberView;
  visibility: MemberVisibility;
  tabs: DetailTabKey[];
  tab: DetailTabKey;
  onTabChange: (next: DetailTabKey) => void;
}) {
  const activity = formatLastActive(m.lastSeenAt, m.status, m.invitedAt);

  return (
    <header className="shrink-0 bg-surface-invert px-5 pt-4">
      <div className="flex items-start gap-3.5">
        <Avatar
          person={m}
          size="md"
          className="border-text-on-invert/20 bg-text-on-invert/10 text-text-on-invert"
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 truncate text-display font-semibold tracking-tight text-text-on-invert">
              {displayNameOf(m)}
            </h2>
            <RolePillOnInvert role={m.role} />
            {visibility.isSelf && (
              <span className="shrink-0 rounded-full bg-text-on-invert/15 px-2 py-px text-micro font-semibold uppercase tracking-wide text-text-on-invert">
                You
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-caption text-text-on-invert/60">{m.email}</p>
        </div>

        <div className="flex shrink-0 items-center divide-x divide-text-on-invert/15">
          {visibility.showPresence && (
            <StatBlock label="Last active" value={activity.label} />
          )}
          <StatBlock label="Member since" value={formatDate(m.joinedAt)} />
        </div>
      </div>

      <div role="tablist" className="mt-3 flex items-center">
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => onTabChange(key)}
            className={cn(
              "relative cursor-pointer px-3 pb-2.5 pt-1 text-small font-medium transition-colors",
              tab === key
                ? "text-text-on-invert"
                : "text-text-on-invert/50 hover:text-text-on-invert/80"
            )}
          >
            {DETAIL_TAB_LABEL[key]}
            {tab === key && (
              <span
                aria-hidden
                className="absolute inset-x-2 bottom-0 h-[2px] rounded-t-full bg-text-on-invert"
              />
            )}
          </button>
        ))}
      </div>
    </header>
  );
}
