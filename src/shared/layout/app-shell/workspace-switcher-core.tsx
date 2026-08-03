"use client";

import { useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Settings, UserPlus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Popover, MenuItem } from "@/shared/ui/popover-menu";
import { RolePill } from "@/features/members/components/member-bits";
import { workspaceSegment } from "@/features/workspaces/url";
import type { WorkspaceLike } from "./workspace-types";
import styles from "./app-shell.module.css";

export interface WorkspaceSwitcherCoreProps {
  /** Canonical segment of the open workspace (`{slug}-{publicId}`). */
  workspaceSegment: string;
  /** Public id of the open workspace — marks the active row + header. */
  workspacePublicId: string;
  /** Name of the open workspace (header fallback before the fetch lands). */
  workspaceName: string;
  /** The caller's workspaces; each app fetches them with its own transport. */
  workspaces: WorkspaceLike[];
  /** True while that fetch is in flight and nothing is cached yet. */
  isLoading: boolean;
  /** Navigate to an in-app path — `router.push` / SPA `navigate`. */
  onNavigate: (path: string) => void;
  onOpenSettings: (section: "workspace") => void;
  onCreateWorkspace: () => void;
  /** Opens the list — the web app uses it to enable its lazy fetch. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * The switcher's Next-free core (see `./workspace-switcher` for the web
 * binding). Clicking the brand pill opens a Popover with the current
 * workspace header (icon, name, slug, role), workspace actions (settings,
 * invite members), the full switch list, and a create-workspace row.
 * Keyboard accessible: Escape closes and returns focus to the pill; every row
 * is a real button.
 */
export function WorkspaceSwitcherCore({
  workspaceSegment: segment,
  workspacePublicId,
  workspaceName,
  workspaces,
  isLoading,
  onNavigate,
  onOpenSettings,
  onCreateWorkspace,
  onOpenChange,
}: WorkspaceSwitcherCoreProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const active = workspaces.find((w) => w.publicId === workspacePublicId) ?? null;

  function setOpenState(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  function close() {
    setOpenState(false);
    triggerRef.current?.focus();
  }

  function go(path: string) {
    close();
    onNavigate(path);
  }

  return (
    <div className={styles.brand}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.brandPill}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenState(!open)}
      >
        <span className={styles.brandPillName}>{workspaceName}</span>
        <ChevronsUpDown size={15} className={styles.brandChevron} />
      </button>

      <Popover
        open={open}
        onClose={close}
        className="w-[248px] overflow-hidden rounded-xl border-border-strong p-0"
      >
        {/* Current workspace header */}
        <div className="flex items-start gap-2.5 px-3 py-2.5">
          <WorkspaceGlyph
            name={active?.name ?? workspaceName}
            iconUrl={active?.iconUrl ?? null}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <div className="text-body font-semibold leading-snug text-text-primary">
              {active?.name ?? workspaceName}
            </div>
            {active && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="truncate text-caption text-text-muted">
                  {active.slug}
                </span>
              </div>
            )}
          </div>
          {active && <RolePill role={active.role} />}
        </div>

        {/* Current-workspace actions */}
        <div className="border-t border-border-subtle py-1">
          <MenuItem
            icon={<Settings size={13} />}
            onSelect={() => {
              close();
              onOpenSettings("workspace");
            }}
          >
            Workspace settings
          </MenuItem>
          <MenuItem
            icon={<UserPlus size={13} />}
            onSelect={() => go(`/${segment}/members`)}
          >
            Invite members
          </MenuItem>
        </div>

        {/* Switch workspace */}
        <div className="border-t border-border-subtle py-1">
          <p className="px-3 pt-1 pb-1 text-label font-semibold uppercase tracking-wide text-text-muted">
            Switch workspace
          </p>
          {isLoading && workspaces.length === 0 ? (
            <p className="px-3 py-1.5 text-small text-text-muted">Loading…</p>
          ) : (
            workspaces.map((ws) => {
              const isActive = ws.publicId === workspacePublicId;
              return (
                <button
                  key={ws.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => go(`/${workspaceSegment(ws)}`)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-raised-2"
                >
                  <WorkspaceGlyph name={ws.name} iconUrl={ws.iconUrl} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small text-text-primary">
                      {ws.name}
                    </span>
                    <span className="block text-caption capitalize text-text-muted">
                      {ws.role}
                    </span>
                  </span>
                  <Check
                    size={13}
                    className={cn(
                      "shrink-0 text-text-primary",
                      !isActive && "opacity-0"
                    )}
                  />
                </button>
              );
            })
          )}
        </div>

        {/* Create workspace */}
        <div className="border-t border-border-subtle py-1">
          <MenuItem
            icon={<Plus size={13} />}
            onSelect={() => {
              close();
              onCreateWorkspace();
            }}
          >
            Create workspace
          </MenuItem>
        </div>
      </Popover>
    </div>
  );
}

/** Rounded workspace glyph — icon image when present, neutral initial
 *  otherwise (Avatar's fallback recipe, squared for workspace identity). */
function WorkspaceGlyph({
  name,
  iconUrl,
  size,
}: {
  name: string;
  iconUrl: string | null;
  size: "sm" | "md";
}) {
  const box = size === "md" ? "h-7 w-7 text-body" : "h-6 w-6 text-caption";
  if (iconUrl) {
    return (
      <span className={cn("shrink-0 overflow-hidden rounded-md", box)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconUrl} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md border border-border-default bg-bg-inset font-semibold text-text-secondary",
        box
      )}
    >
      {(name.trim()[0] || "?").toUpperCase()}
    </span>
  );
}
