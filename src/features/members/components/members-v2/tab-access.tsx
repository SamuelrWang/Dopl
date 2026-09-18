"use client";

import { Lock } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SectionPanel } from "@/shared/ui/section-panel";
import { SkeletonRow } from "@/shared/ui/skeleton";
import type { EffectiveAccessRow } from "@/features/teams/effective-access";
import type { WorkspaceMemberView } from "../../types";
import { resourceMeta } from "../member-bits";
import { TeamChip } from "../team-bits";
import { PaneError, PaneHeading } from "./bits";
import { firstNameOf, groupAccess } from "./view-model";
import type { MemberVisibility } from "./visibility";

/**
 * What the member can reach, grouped by capability.
 *
 * ⚠ The "No access" group only ever has rows when an ADMIN is looking at
 * SOMEBODY ELSE — the route drops `level: null` rows for a self view before
 * they leave the server, so this is the second gate, not the only one.
 */
export function AccessTab({
  member,
  rows,
  loading,
  error,
  onRetry,
  visibility,
}: {
  member: WorkspaceMemberView;
  rows: EffectiveAccessRow[] | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  visibility: MemberVisibility;
}) {
  const isAdminTarget = member.role === "owner" || member.role === "admin";
  const who = visibility.isSelf ? "You" : firstNameOf(member);
  const groups = rows ? groupAccess(rows) : null;

  return (
    <div className="flex flex-col gap-3.5">
      <PaneHeading
        title="Access"
        subtitle={
          isAdminTarget
            ? `${who} ${visibility.isSelf ? "reach" : "reaches"} everything — admins are not scoped by teams.`
            : `Resolved through ${visibility.isSelf ? "your" : "their"} teams and the workspace defaults.`
        }
      />

      {error && !groups ? (
        <PaneError title="Couldn't load access." onRetry={onRetry} />
      ) : loading || !groups ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading access</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : (
        <>
          <AccessGroup
            id="access-edit"
            label="Can edit"
            rows={groups.edit}
            empty={`Nothing ${visibility.isSelf ? "you" : "they"} can change.`}
          />
          <AccessGroup
            id="access-read"
            label="Can read"
            rows={groups.read}
            empty="Nothing read-only."
          />
          {visibility.showNoAccessGroup && (
            <AccessGroup
              id="access-none"
              label="No access"
              rows={groups.none}
              locked
              empty="Nothing in the workspace is out of reach."
            />
          )}
        </>
      )}
    </div>
  );
}

function AccessGroup({
  id,
  label,
  rows,
  locked = false,
  empty,
}: {
  id: string;
  label: string;
  rows: EffectiveAccessRow[];
  locked?: boolean;
  empty: string;
}) {
  return (
    // FLAT since R-39 (2026-09-17) — this was a `SectionBox`: a header STRIP
    // over a concave inset body. The count keeps the `caption` slot, which is
    // what `SectionBox`'s `meta` had no counterpart for and what a fact ABOUT
    // the section belongs in (the same swap `knowledge-v2/detail/
    // overview-contents.tsx` made).
    <SectionPanel id={id} label={label} caption={`${rows.length}`}>
      {rows.length === 0 ? (
        <p className="px-1 py-1 text-caption text-text-muted">{empty}</p>
      ) : (
        rows.map((row) => {
          const { label: typeLabel, icon: Icon } = resourceMeta(row.resourceType);
          return (
            <div
              key={`${row.resourceType}:${row.resourceId}`}
              // ⚠ `px-1`, NOT `px-3` — the panel supplies the padding now; the
              // deeper inset was `SectionBox`'s edge-to-edge inset body.
              className="flex items-center gap-2.5 border-b border-border-subtle px-1 py-2 last:border-b-0"
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]",
                  locked ? "bg-danger/10 text-danger" : "bg-bg-elevated text-text-secondary"
                )}
              >
                {locked ? <Lock size={12} aria-hidden /> : <Icon size={13} aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-body",
                    locked ? "text-text-secondary" : "text-text-primary"
                  )}
                >
                  {row.resourceName}
                </span>
                <span className="block truncate text-caption text-text-muted">
                  {typeLabel}
                  {row.viaTeam ? "" : locked ? " · no grant" : " · role default"}
                </span>
              </span>
              {/* The chip is the PROVENANCE, not the level — the group header
                  already says the level. */}
              {row.viaTeam && (
                <TeamChip
                  name={row.viaTeam.name}
                  color={row.viaTeam.color}
                  className="shrink-0"
                />
              )}
            </div>
          );
        })
      )}
    </SectionPanel>
  );
}
