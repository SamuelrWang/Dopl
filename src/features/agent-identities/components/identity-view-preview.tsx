"use client";

import type { ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Glasses,
  GitBranch,
  Mail,
  MessageSquare,
  Search,
  Sheet,
  SquareTerminal,
} from "lucide-react";
import type {
  IdentityAction,
  IdentityPreview,
  IdentityToolMark,
} from "@/features/home/preview-types";
import { StatusPill } from "@/shared/ui/status-pill";
import { agoLabel } from "../lib/identity-runs";
import { channelLabel } from "../lib/identity-preview";
import { FACT_MARK } from "./identity-section";
import { Empty, EventRow, Group, GroupPair, Lines, Rows } from "./identity-view-parts";

/** The view's preview-only content (INVARIANTS §4A): the Tools and rules tab and the action log. */

const TOOL_GLYPH: Record<IdentityToolMark, ReactNode> = {
  repo: <GitBranch size={13} strokeWidth={2} />,
  terminal: <SquareTerminal size={13} strokeWidth={2} />,
  channels: <MessageSquare size={13} strokeWidth={2} />,
  calendar: <CalendarDays size={13} strokeWidth={2} />,
  sheet: <Sheet size={13} strokeWidth={2} />,
  mail: <Mail size={13} strokeWidth={2} />,
  glasses: <Glasses size={13} strokeWidth={2} />,
  search: <Search size={13} strokeWidth={2} />,
};

const PERMISSION_WORD: Record<Exclude<IdentityAction["permission"], "auto">, string> = {
  approved: "Approved by you",
  waiting: "Waited for you",
  paused: "Paused",
};

/** A logged action's permission; the ordinary `auto` draws nothing. */
export function PermissionChip({ permission }: { permission: IdentityAction["permission"] }) {
  if (permission === "auto") return null;
  return <StatusPill>{PERMISSION_WORD[permission]}</StatusPill>;
}

export function RulesTab({ entry }: { entry: IdentityPreview }) {
  return (
    <>
      <Group label="Tools" hint="what it may call">
        {entry.tools.length === 0 ? (
          <Empty>No tools granted.</Empty>
        ) : (
          <Rows>
            {entry.tools.map((tool) => (
              <EventRow
                key={tool.name}
                lead={tool.mark && <span className={FACT_MARK}>{TOOL_GLYPH[tool.mark]}</span>}
                title={tool.name}
                middle={tool.detail}
                trail={<StatusPill>{tool.allowed ? "Allowed" : "Off"}</StatusPill>}
              />
            ))}
          </Rows>
        )}
      </Group>
      <GroupPair>
        {entry.rules.length > 0 && (
          <Group label="Rules" hint="always">
            <Lines items={entry.rules} icon={<Check size={13} strokeWidth={2.5} />} />
          </Group>
        )}
        {entry.escalations.length > 0 && (
          <Group label="Escalates to you">
            <Lines items={entry.escalations} icon={<ArrowUpRight size={13} strokeWidth={2.5} />} />
          </Group>
        )}
      </GroupPair>
    </>
  );
}

/** The identity's logged actions, most recent first. */
export function ActionLogGroup({ log }: { log: ReadonlyArray<IdentityAction> }) {
  const held = log.filter((row) => row.permission !== "auto").length;
  return (
    <Group label="Log" hint={`${log.length} actions${held > 0 ? `, ${held} needed you` : ""}`}>
      <Rows>
        {log.map((row) => (
          <EventRow
            key={`${row.at}-${row.action}`}
            title={row.action}
            middle={row.channelName && channelLabel(row.channelName)}
            trail={
              <>
                <PermissionChip permission={row.permission} />
                <span className="text-caption tabular-nums text-text-muted">
                  {agoLabel(Date.parse(row.at))}
                </span>
              </>
            }
          />
        ))}
      </Rows>
    </Group>
  );
}
