"use client";

/**
 * The banner demo's /home CHROME — the account rail, the gray panel's header
 * row and the 290px channel list that frame the record pane.
 *
 * ⚠ THIS ONE IS A MOCK, AND IT HAS TO BE. Every other part of the scene mounts
 * the product's own components; these cannot, because /home lives in a
 * DIFFERENT APP. `apps/desktop-ui/src/pages/home/` and
 * `apps/desktop-ui/src/components/app-shell/account-rail.tsx` resolve `#/*`
 * against the SPA's own src, and the root `tsconfig.json` excludes `apps`
 * outright — the Next tree has no path to them at all. So the chrome is
 * hand-built here.
 *
 * ⚠ WHICH MAKES THE TOKEN DISCIPLINE THE WHOLE POINT. Nothing below picks a
 * colour, a radius or a type size: the frame ink, the panel gray, the card
 * white and the panel line are `globals.css › THE APP FRAME PALETTE` (the same
 * four values `apps/desktop-ui/src/styles/tokens.css` carries), the faces are
 * the kit's `.auth-btn-3d` / `.auth-btn-3d-light` / `.selected-ring` /
 * `.raised-tab` / `.search-expand*`, and `Avatar`, `AvatarStack`,
 * `SegmentedControl` and `WorkspaceGlyph` are the SHARED primitives the real
 * page mounts (`src/shared/**`, reached by both apps). Geometry that has no
 * token — the 54px rail, the 40px tile — is in `marketing.css` beside its
 * source reference.
 *
 * Sources to keep this in step with, all four read on 2026-08-30:
 *   `apps/desktop-ui/src/pages/home/index.tsx`            — the header row
 *   `apps/desktop-ui/src/pages/home/relationship-list.tsx` — the rows
 *   `apps/desktop-ui/src/components/app-shell/account-rail.{tsx,module.css}`
 *   `apps/desktop-ui/src/pages/home/home-settings-control.tsx` — the face
 */

import { Bot, Plus, Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { WorkspaceGlyph } from "@/shared/layout/app-shell/workspace-switcher-core";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type { HomeRowMock } from "./demo-home-rows";

const NOOP = () => {};

/** The scene never leaves Chat — the selector NAMES the surface here, it does
 *  not drive it (the timeline owns every state change in the demo). */
const HOME_TABS = [
  { key: "chat", label: "Chat" },
  { key: "knowledge", label: "Knowledge" },
  { key: "agents", label: "Agents" },
] as const;

/**
 * The ACCOUNT rail — Home pinned top and selected, workspace tiles under it,
 * create at the end (`account-rail.tsx`). Home is the active tile because /home
 * is the surface on screen, so it wears the kit's `.raised-tab` exactly as the
 * real one does.
 */
export function DemoAccountRail() {
  return (
    <nav className="lp-demo-rail" aria-label="Account">
      <span className="lp-demo-rail-tile raised-tab">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/favicons/android-chrome-512x512.png"
          alt=""
          className="lp-demo-rail-mark"
          draggable={false}
        />
      </span>
      {/* ⚠ The account/container break is 4px of RHYTHM and no rule — the
          divider that used to sit here is deleted (`account-rail.module.css`);
          the only line in this rail belongs to the selected tile. */}
      <div className="lp-demo-rail-group">
        {["Northwind", "Vermillion", "Lattice"].map((name) => (
          <span key={name} className="lp-demo-rail-tile">
            <WorkspaceGlyph name={name} iconUrl={null} size="md" />
          </span>
        ))}
      </div>
      <span className="lp-demo-rail-tile lp-demo-rail-create">
        <Plus size={18} strokeWidth={1.8} />
      </span>
    </nav>
  );
}

/**
 * The panel's header strip: the operator's face in a cell EXACTLY the list
 * column's width, then the Chat/Knowledge/Agents selector — so the selector's
 * left edge lands on the record pane's, one `--home-list-w` for both — then
 * search and the single black "New channel" pill (`index.tsx`).
 */
export function DemoHomeHeader({ viewer }: { viewer: AvatarPerson }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 pr-5">
      <div className="flex min-w-0 items-center">
        <div className="flex w-[var(--home-list-w)] shrink-0 items-center px-3">
          <Avatar person={viewer} size="sm" />
        </div>
        <SegmentedControl
          options={HOME_TABS}
          value="chat"
          onChange={NOOP}
          variant="track"
          size="lg"
        />
      </div>
      <div className="flex items-center gap-2.5">
        {/* The kit's collapsing pill at rest — a round icon button that grows
            leftward when it opens. Nothing opens it here. */}
        <div className="search-expand" data-open="false">
          <div className="auth-btn-3d-light search-expand-shell">
            <span className="search-expand-toggle">
              <Search size={15} aria-hidden />
            </span>
          </div>
        </div>
        <span className="auth-btn-3d flex h-9 items-center rounded-full px-[15px] text-small font-semibold text-white">
          New channel
        </span>
      </div>
    </div>
  );
}

/**
 * The 290px channel column. Rows are floating raised cards on the panel gray;
 * the live one wears `.selected-ring` — the same darkened hairline and halo the
 * search pill wears open, held (`relationship-list.tsx`).
 */
export function DemoChannelList({
  rows,
  selectedId,
}: {
  rows: HomeRowMock[];
  selectedId: string;
}) {
  return (
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-3 pb-3 pt-1">
        {rows.map((row) => (
          <DemoChannelRow
            key={row.id}
            row={row}
            selected={row.id === selectedId}
          />
        ))}
      </div>
    </div>
  );
}

function DemoChannelRow({
  row,
  selected,
}: {
  row: HomeRowMock;
  selected: boolean;
}) {
  // ⚠ THE THREE AVATAR BRANCHES ARE THE REAL ROW'S, in its order and at its one
  // size: a SOLO channel gets a glyph rather than initials invented from a
  // channel name, 2+ people get the shared stack capped at 3, and everything
  // else is a single face. All three are a 32px box, or the rows sit at two
  // heights the moment a second person joins.
  const solo = row.people.length === 0 && !row.pending;
  return (
    <span
      className={cn(
        // ⚠ `shrink-0`: the rows are flex items in a COLUMN, so without it a
        // full list squashes every card instead of the column clipping the
        // overflow — the real list scrolls, and a scrollbar has no place in a
        // decorative scene.
        "auth-btn-3d-light flex w-full shrink-0 items-start gap-2.5 rounded-[14px] px-2.5 py-2.5 text-left",
        selected && "selected-ring",
      )}
    >
      {solo ? (
        <span
          aria-hidden
          className="btn-light flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary"
        >
          <Bot size={15} />
        </span>
      ) : row.people.length > 1 ? (
        <div className="shrink-0" aria-hidden>
          <AvatarStack
            size="sm"
            max={3}
            users={row.people.map((p) => ({
              userId: p.userId,
              displayName: p.displayName,
              avatarUrl: p.avatarUrl,
            }))}
          />
        </div>
      ) : (
        <Avatar
          person={
            row.people[0]
              ? {
                  userId: row.people[0].userId,
                  email: null,
                  displayName: row.people[0].displayName,
                  avatarUrl: row.people[0].avatarUrl,
                }
              : // An unclaimed link has no face yet; the row id keys the
                // fallback so the generated initial is stable.
                {
                  userId: row.id,
                  email: null,
                  displayName: row.title,
                  avatarUrl: null,
                }
          }
          size="sm"
          className={cn(row.pending && "opacity-55")}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-body font-medium",
              row.pending ? "text-text-secondary" : "text-text-primary",
            )}
          >
            {row.title}
          </span>
          <span className="shrink-0 text-micro text-text-muted">
            {formatChannelTimestamp(row.at)}
          </span>
        </span>
        <span className="block truncate text-caption text-text-muted">
          {row.subline}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {row.linkOut && (
            <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 text-micro font-medium text-text-secondary">
              Link out
            </span>
          )}
          <span className="truncate text-caption text-text-muted">
            {row.lastLine}
          </span>
        </span>
      </span>
    </span>
  );
}
