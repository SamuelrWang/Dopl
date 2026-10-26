"use client";

/**
 * WHAT YOUR ROLES ARE DOING — the page's RIGHT RAIL (item 8, 2026-10-24). One panel, two tabs:
 * **Active now** and **Recent**.
 *
 * Samuel: *"we should put the activity as a panel on the right side… three-fourths of the
 * identities page on the left side, and then another quarter's on the right side"* and *"each
 * agent that's working should have some sort of box that's probably white… It doesn't need to be
 * so long. It doesn't really need to say what channel it's in"*. The layout lives in
 * `home/identity-panels.tsx` (`.uis-idp-layout`); this file is the rail's content.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * **Active now = one compact white card per running agent** ({@link RunCard}), the
 * `docs/DESIGN-LANGUAGE.md` §4 agent card slimmed to two lines:
 *
 * | Line | Holds |
 * |---|---|
 * | 1 | IdentityFace (owner photo + runtime badge, agent-colour ring) · agent name (600) · elapsed time, muted, trailing |
 * | 2 | status pill (dot + word, green dot only when working) · ONE muted line: what it is doing (the thread title) |
 *
 * ⚠ **THE PILL IS ON LINE 2, MEASURED, NOT TASTE.** On line 1 beside the name (the full recipe's
 * place) a "Working…" pill is ~79px, and at the rail's real width (card ≈ 211px at a 1440px
 * staging window) that left the name 62px: four of five fixture names truncated. With the time
 * (≈ 20px) there instead, every name fits; the thread, which may truncate, carries a `title`.
 *
 * ⚠ **DROPPED FROM THE CARD, ON PURPOSE:** the channel (Samuel leaned that way, and the thread
 * title is the more useful "what"), the context meter, the token footer and the pill button the
 * full recipe carries. A 1/4-width rail has room for the 3–5 things that matter (§1 rule 4), and
 * the whole card opens the identity's view popup, which already carries the rest.
 *
 * **Recent stays rows, not cards** (the 3c ruling: a card is for something live or pickable; a
 * logged event in a card face reads as more agents). In a quarter column the old six-column grid
 * cannot fit, so a row is two lines: the sentence, then whose identity + when.
 *
 * **Filters:** the owner filter (fix 5, "Just mine", asked for by name) stays as the panel's one
 * header control. The STATE filter is gone: every card now states its state in its own pill and
 * working agents sort first, so a menu for it was a second control saying the same thing in a
 * column with no room for two.
 *
 * 🔒 **The card face and the rail layout are hand-written CSS** in
 * `ui-staging/staging.css › THE IDENTITIES PAGE RAIL (.uis-idp-*)`, not new Tailwind utilities:
 * the dev server only compiles utilities that existed when it booted (PORTING.md › CORRECTION).
 * Only utilities already used elsewhere in the app appear below.
 * ────────────────────────────────────────────────────────────────────────────────
 */

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import type { AgentColorKey } from "@dopl/contracts";
import { AGENT_COLOR_KEYS } from "@/shared/lib/agent-colors";
import { IdentityFace } from "@/shared/ui/identity-face";
import { IdentityPanel } from "../agent-identities/components/identity-section";
import { agoLabel } from "../view/identity-view-mocks";
import { STAGING_PEOPLE } from "@/features/ui-staging/staging-stubs";
import { identityCardFace, STAGING_USER_ID } from "../data";
import { SelectMenu } from "@/shared/ui/select-menu";
import { AGENT_STATE_WORD, type ActiveRun, type AgentState, type FeedRow } from "./identity-page-data";
import type { AgentIdentity } from "@/features/agent-identities/client/types";

type Tab = "now" | "recent";

/** The running agent's face on its card (§3: 28–34px is the header size). */
export const RUN_FACE_PX = 28;
/** A logged event's face: row size (§3: 20–22px). */
const FEED_FACE_PX = 22;

/** The card and row faces, literal classes (see the header's 🔒). */
export const RUN_LIST = "uis-idp-run-list";
export const RUN_CARD = "uis-idp-run";
const FEED_ROW = "uis-idp-feed-row";

/** The permission words, the landing's own (`control-content.ts › LOG_COPY.permission`). `auto`
 *  never draws a chip: one on every row is the bloat Samuel named in 2d. */
const PERMISSION_WORD = {
  approved: "Approved by you",
  waiting: "Waited for you",
  paused: "Paused",
} as const;

/** `"all"` · `"mine"` · a `userId`. */
type OwnerFilter = string;

export function IdentityActivityPanel({
  active,
  feed,
  onOpen,
}: {
  active: ReadonlyArray<ActiveRun>;
  feed: ReadonlyArray<FeedRow>;
  /** Clicking a card or row opens that identity's own view popup — the rail is a way IN. */
  onOpen: (identity: AgentIdentity) => void;
}) {
  // Opens on whatever there is to see: if something is running that is the more urgent answer.
  const [tab, setTab] = useState<Tab>(active.length > 0 ? "now" : "recent");
  const [owner, setOwner] = useState<OwnerFilter>("all");

  // ⚠ Built from the rows ON SCREEN, not from the roster: a filter that returns nothing is a
  // filter nobody should be offered. "Just mine" is the one Samuel asked for by name.
  const ownerOptions = useMemo(
    () => ownerFilterOptions([...active.map((r) => r.identity), ...feed.map((r) => r.identity)]),
    [active, feed]
  );

  const activeShown = active.filter((run) => ownedBy(run.identity, owner));
  const feedShown = feed.filter((row) => ownedBy(row.identity, owner));

  return (
    <IdentityPanel
      id="home-agents-activity"
      label="Activity"
      action={
        ownerOptions.length > 1 ? (
          <SelectMenu
            variant="bare"
            value={owner}
            options={ownerOptions}
            onChange={setOwner}
            ariaLabel="Filter activity by whose identity it is"
          />
        ) : null
      }
    >
      <div role="tablist" aria-label="Activity view" className="flex items-center gap-1 px-1 pb-2.5">
        <Tabs tab={tab} onTab={setTab} count={active.length} />
      </div>
      {tab === "now" ? (
        activeShown.length === 0 ? (
          <Quiet>
            {active.length === 0
              ? "No agents running from your identities right now."
              : "Nothing running matches this filter."}
          </Quiet>
        ) : (
          <div className={RUN_LIST}>
            {activeShown.map((run) => (
              <RunCard key={`${run.identity.id}-${run.thread}`} run={run} onOpen={onOpen} />
            ))}
          </div>
        )
      ) : feedShown.length === 0 ? (
        <Quiet>{feed.length === 0 ? "Nothing logged yet." : "Nothing logged matches this filter."}</Quiet>
      ) : (
        <div className="flex flex-col gap-0.5">
          {feedShown.map((row, i) => (
            <FeedItem key={`${row.identity.id}-${row.at}-${i}`} row={row} onOpen={onOpen} />
          ))}
        </div>
      )}
    </IdentityPanel>
  );
}

/**
 * ONE RUNNING AGENT, ONE SMALL WHITE CARD. Two lines; the whole card opens the identity.
 * The `title`s carry the full text wherever a column truncates.
 */
function RunCard({ run, onOpen }: { run: ActiveRun; onOpen: (identity: AgentIdentity) => void }) {
  const face = identityCardFace(run.identity);
  return (
    <button type="button" onClick={() => onOpen(run.identity)} className={RUN_CARD}>
      <span className="flex w-full min-w-0 items-center gap-2">
        <IdentityFace
          size={RUN_FACE_PX}
          photo={face.photo}
          runtimeLogo={face.runtimeLogo}
          ring={agentColorKey(run.agent)}
        />
        <span className="min-w-0 flex-1 truncate text-small font-semibold text-text-primary" title={run.agent}>
          {run.agent}
        </span>
        <span className="flex-none text-caption tabular-nums text-text-muted">{run.since}</span>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <StatusPill state={run.state} />
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted" title={run.thread}>
          {run.thread}
        </span>
      </span>
    </button>
  );
}

/**
 * The agent's colour key, derived from its name so a re-render never repaints it. A run is ringed
 * in it; a saved identity has no colour, which is why the grid's cards ring `"neutral"`.
 * STAGING: in the product the session row carries its own key.
 */
export function agentColorKey(name: string): AgentColorKey {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AGENT_COLOR_KEYS[h % AGENT_COLOR_KEYS.length];
}

/** §4's status pill: dot + word. Green only when working (§1 rule 5); idle's dot is the muted ink.
 *  White on a hairline, not `--bg-inset` (item 7 fix 2 banned that grey on this page). */
function StatusPill({ state }: { state: AgentState }) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center gap-1 rounded-full border border-border-default bg-white px-2 py-0.5 text-micro font-medium",
        state === "working" ? "text-text-primary" : "text-text-muted"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 flex-none rounded-full",
          state === "working" ? "bg-success" : "bg-text-muted"
        )}
        aria-hidden="true"
      />
      {AGENT_STATE_WORD[state]}
    </span>
  );
}

/** One logged event on two lines: what it did, then whose identity and when. */
function FeedItem({ row, onOpen }: { row: FeedRow; onOpen: (identity: AgentIdentity) => void }) {
  const face = identityCardFace(row.identity);
  return (
    <button type="button" onClick={() => onOpen(row.identity)} className={FEED_ROW}>
      <IdentityFace size={FEED_FACE_PX} photo={face.photo} runtimeLogo={face.runtimeLogo} ring="neutral" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-small font-medium text-text-primary" title={row.did}>
          {row.did}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-caption text-text-muted">
          <span className="min-w-0 flex-1 truncate" title={row.identity.name}>
            {row.identity.name}
          </span>
          <span className="flex-none tabular-nums">{agoLabel(row.at)}</span>
        </span>
        {row.permission !== "auto" && (
          <span className="inline-flex max-w-full items-center self-start truncate rounded-full border border-border-default bg-bg-elevated px-1.5 py-0.5 text-micro font-medium text-text-secondary">
            {PERMISSION_WORD[row.permission]}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Whose identities to show. "Everyone" is dropped when there is only one owner in the rows, so
 * the menu never appears to narrow something that is already narrow.
 */
function ownerFilterOptions(
  identities: ReadonlyArray<AgentIdentity>
): ReadonlyArray<{ value: string; label: string; description?: string }> {
  // `createdBy` is nullable on the payload: a row whose author the roster cannot name offers no
  // filter, the same way `authorMarker` refuses to print a blank name (INVARIANTS §5A).
  const owners = [...new Set(identities.map((i) => i.createdBy).filter((id): id is string => !!id))];
  const others = owners
    .filter((id) => id !== STAGING_USER_ID)
    .map((id) => ({
      value: id,
      label: STAGING_PEOPLE.find((p) => p.userId === id)?.displayName ?? "Another member",
      description: "Only activity from this member's identities",
    }));
  const mine = owners.includes(STAGING_USER_ID)
    ? [{ value: "mine", label: "Just mine", description: "Only your own AI identities" }]
    : [];
  // One owner and nothing to choose between: the caller hides the menu on length 1.
  if (mine.length + others.length < 2) return [{ value: "all", label: "Everyone" }];
  return [
    { value: "all", label: "Everyone", description: "Every identity's activity" },
    ...mine,
    ...others,
  ];
}

function ownedBy(identity: AgentIdentity, filter: OwnerFilter): boolean {
  if (filter === "all") return true;
  if (filter === "mine") return identity.createdBy === STAGING_USER_ID;
  return identity.createdBy === filter;
}

function Tabs({ tab, onTab, count }: { tab: Tab; onTab: (next: Tab) => void; count: number }) {
  const items: ReadonlyArray<{ key: Tab; label: string; badge?: number }> = [
    { key: "now", label: "Active now", badge: count },
    { key: "recent", label: "Recent" },
  ];
  return (
    <>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={tab === item.key}
          onClick={() => onTab(item.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium transition-colors",
            // Item 7 fix 2: the selected tab was the banned grey. White on a hairline instead.
            tab === item.key
              ? "border border-border-default bg-white text-text-primary"
              : "border border-transparent text-text-muted hover:text-text-secondary"
          )}
        >
          {item.label}
          {item.badge !== undefined && item.badge > 0 && (
            <span className="flex items-center gap-1 text-micro font-semibold text-text-secondary">
              <span className="h-1 w-1 rounded-full bg-success" aria-hidden="true" />
              {item.badge}
            </span>
          )}
        </button>
      ))}
    </>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-1 pb-1 text-caption text-text-muted">{children}</p>;
}
