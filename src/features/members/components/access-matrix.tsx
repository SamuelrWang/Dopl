"use client";

import { Database, FileCode, Layout } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  defaultLevelForRole,
  type AccessLevel,
  type ResourceType,
} from "../access-defaults";
import { useMemberAccess, type ResourceEntry } from "../hooks/use-member-access";
import type { MemberRole } from "../types";
import { AccessMatrixSkeleton } from "./members-skeleton";

interface Props {
  workspaceSlug: string;
  workspaceId: string;
  targetUserId: string;
  /** Member's role — used to compute the default access when no override exists. */
  targetRole: MemberRole;
  /** Whether to actually fetch (only when expanded). */
  enabled: boolean;
}

const ICONS: Record<ResourceType, typeof Database> = {
  knowledge_base: Database,
  skill: FileCode,
  canvas: Layout,
};

const SECTION_LABELS: Record<ResourceType, string> = {
  knowledge_base: "Knowledge bases",
  skill: "Skills",
  canvas: "Canvases",
};

/**
 * Per-resource read/edit matrix for one member. Owner/admin members
 * don't render this — their access is implicit edit and not configurable.
 */
export function AccessMatrix({
  workspaceSlug,
  workspaceId,
  targetUserId,
  targetRole,
  enabled,
}: Props) {
  // Skip the resource fetch for owner/admin — their matrix isn't
  // configurable, so the data would just be discarded.
  const fetchEnabled =
    enabled && targetRole !== "owner" && targetRole !== "admin";
  const { data, loading, error, setLevel } = useMemberAccess(
    workspaceSlug,
    workspaceId,
    targetUserId,
    fetchEnabled
  );

  if (targetRole === "owner" || targetRole === "admin") {
    return (
      <p className="px-12 py-3 text-[11px] text-text-secondary/60">
        Admins and owners have full edit access on every resource.
      </p>
    );
  }

  if (!enabled) return null;

  if (loading && !data) {
    return <AccessMatrixSkeleton />;
  }

  const resources = data?.resources ?? [];
  const overrides = data?.overrides ?? new Map<string, AccessLevel>();
  const defaultLevel = defaultLevelForRole(targetRole);

  const grouped: Record<ResourceType, ResourceEntry[]> = {
    knowledge_base: [],
    skill: [],
    canvas: [],
  };
  for (const r of resources) grouped[r.type].push(r);

  return (
    <div className="px-12 pb-4 pt-1 space-y-4">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {(["knowledge_base", "skill", "canvas"] as ResourceType[]).map((type) => {
        const items = grouped[type];
        if (items.length === 0) return null;
        const Icon = ICONS[type];
        return (
          <section key={type}>
            <h4 className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-2">
              <Icon size={11} />
              {SECTION_LABELS[type]} · {items.length}
            </h4>
            <ul className="rounded-lg border border-border-subtle divide-y divide-border-subtle overflow-hidden">
              {items.map((r) => {
                const key = `${r.type}:${r.id}`;
                const current = overrides.get(key) ?? defaultLevel;
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="text-sm text-text-primary truncate">
                      {r.name}
                    </span>
                    <LevelToggle
                      value={current}
                      onChange={(next) => void setLevel(r.type, r.id, next)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {resources.length === 0 && !loading && (
        <p className="text-[11px] text-text-secondary/60">
          No resources in this workspace yet.
        </p>
      )}
    </div>
  );
}

function LevelToggle({
  value,
  onChange,
}: {
  value: AccessLevel;
  onChange: (next: AccessLevel) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex items-center rounded-md border border-border-default overflow-hidden"
    >
      {(["read", "edit"] as AccessLevel[]).map((level) => {
        const active = value === level;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !active && onChange(level)}
            className={cn(
              "px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer",
              active
                ? "bg-surface-selected text-text-primary"
                : "text-text-secondary/60 hover:text-text-primary hover:bg-surface-raised-2"
            )}
          >
            {level}
          </button>
        );
      })}
    </div>
  );
}
