"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { WorkspaceGlyph } from "@/shared/layout/app-shell/workspace-switcher-core";
// The switcher's own role chip — one recipe, so the list and the menu that
// opens it cannot describe the same membership two ways.
import { RolePill } from "@/features/members/components/member-bits";
import {
  isStandardWorkspace,
  type Role,
  type WorkspaceWithRole,
} from "@/features/workspaces/types";
import { SectionShell } from "./section-shell";

/**
 * WORKSPACES — every container this account belongs to, home space first
 * (Samuel, 2026-09-18: *"General becomes Workspaces, and it lists your home
 * space plus every workspace you're in"*).
 *
 * ⚠ **IT IS NOT THE OLD General PANE UNDER A NEW WORD.** Nothing here edits a
 * workspace: rename, description, icon and the owner's danger zone are
 * `sections/workspace-section-core.tsx › WorkspaceSectionBody`, mounted by
 * `/{segment}/settings` alone since this overhaul.
 *
 * ⚠ **`isStandardWorkspace` IS THE FILTER, AND ITS POSITIVE FORM IS THE POINT**
 * (`features/workspaces/types.ts`, INVARIANTS §4A): `GET /api/workspaces` is
 * unfiltered and carries one `kind='link'` row per person this account is
 * connected to. Those are plumbing — the relationship is a CHANNEL on /home, not
 * a workspace — so listing them here would fill the pane with rows that open a
 * surface the shell redirects away from.
 *
 * ⚠ **THE HOME ROW IS NOT READ FROM THAT LIST.** Home is the account surface
 * every account has, pinned above the rule in the rail
 * (`app-shell/account-rail.tsx`) for the same reason it is pinned here; its
 * `kind='home'` container is never rendered as a workspace (the shell
 * bounces `/{personal-segment}` to /home on sight).
 */
export function WorkspacesSectionCore({
  activeWorkspaceId,
  onOpenHome,
  onOpenWorkspace,
}: {
  /** Lights the row for the container the popup was opened from. */
  activeWorkspaceId?: string | null;
  /** Absent ⇒ the rows are plain, not pressable (the web has no shell to route
   *  into since Stage D deleted `src/app/[workspaceSlug]/**`). */
  onOpenHome?: () => void;
  /** See `onOpenHome`. */
  onOpenWorkspace?: (workspace: WorkspaceWithRole) => void;
}) {
  const query = useApiQuery<{ workspaces?: WorkspaceWithRole[] }, WorkspaceWithRole[]>(
    "/api/workspaces",
    { select: selectWorkspaces }
  );
  // ⚠ Error ONLY when there is nothing to show: a failed background refetch must
  // not blank a list the operator is reading.
  const workspaces = query.data ?? null;
  const failed = query.error && !query.data;

  return (
    <SectionShell title="Workspaces" subtitle="Spaces you belong to">
      <div className="flex flex-col gap-1.5">
        <Row
          glyph={<HomeGlyph />}
          name="Home"
          meta="Your personal space"
          onOpen={onOpenHome}
        />
        {workspaces?.map((ws) => (
          <Row
            key={ws.id}
            glyph={<WorkspaceGlyph name={ws.name} iconUrl={ws.iconUrl} size="md" />}
            name={ws.name}
            meta={ws.slug}
            role={ws.role}
            active={ws.id === activeWorkspaceId}
            onOpen={onOpenWorkspace && (() => onOpenWorkspace(ws))}
          />
        ))}
        {workspaces === null && !failed && (
          <div className="h-12 animate-pulse rounded-[10px] bg-surface-raised-1" />
        )}
        {failed && (
          <p className="text-caption text-danger">Couldn&rsquo;t load your workspaces.</p>
        )}
      </div>
    </SectionShell>
  );
}

const selectWorkspaces = (body: { workspaces?: WorkspaceWithRole[] }) =>
  // `?? []` is the stale-cache guard (INVARIANTS §8): this payload is
  // IndexedDB-persisted on the desktop, and a `.filter` on an absent key throws
  // the whole pane away.
  (body.workspaces ?? []).filter(isStandardWorkspace);

/**
 * ONE ROW — glyph, name, one line of meta, an optional trailing word.
 *
 * ⚠ FLAT AND UN-INDENTED, on the kit's own card face: the popup's list language
 * is the New-agent popup's (one level, no nesting, `--border-subtle` hairlines),
 * never the nested rows this pane replaced.
 */
function Row({
  glyph,
  name,
  meta,
  role,
  active,
  onOpen,
}: {
  glyph: React.ReactNode;
  name: string;
  meta: string;
  role?: Role;
  active?: boolean;
  onOpen?: () => void;
}) {
  const body = (
    <>
      {glyph}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-body font-medium text-text-primary">
          {name}
        </span>
        <span className="block truncate text-caption text-text-muted">{meta}</span>
      </span>
      {role && <RolePill role={role} />}
    </>
  );
  const face =
    "flex w-full items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left transition-colors " +
    (active
      ? "border-border-strong bg-surface-raised-1 "
      : "border-border-subtle bg-card-surface ");

  if (!onOpen) return <div className={face}>{body}</div>;
  return (
    <button type="button" onClick={onOpen} className={`${face}hover:bg-surface-raised-1`}>
      {body}
    </button>
  );
}

/** The account surface's mark. ⚠ A GLYPH, not the product logo: the rail's own
 *  Dopl mark is a packaged PNG the web tree cannot import. */
function HomeGlyph() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-border-subtle bg-bg-inset text-caption font-semibold text-text-secondary">
      H
    </span>
  );
}
