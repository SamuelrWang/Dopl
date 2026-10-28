"use client";

import type { ReactNode } from "react";
import { BookOpen, Cpu, Plus, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import type { ModelCatalogs } from "@/features/channels/lib/model-catalog";
import type { AvatarStackUser } from "@/shared/ui/avatar-stack";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { IdentityFace } from "@/shared/ui/identity-face";
import { pendingRow } from "@/shared/ui/pending";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import { SectionPanel } from "@/shared/ui/section-panel";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import type { AgentIdentity } from "../client/types";
import { agoLabel } from "../lib/identity-runs";
import { EMPTY_KNOWLEDGE } from "../lib/knowledge-scopes";
import type { IdentitySectionDef } from "../lib/visibility";

/**
 * One scope panel and its cards. Shell, grid and section are separately callable so the /home
 * face composes the same parts. An empty section keeps its header and says one line.
 */

/** Four cards per row, fixed (Samuel, 2026-09-13; not auto-fill); the skeletons import it. */
export const IDENTITY_GRID = "grid grid-cols-4 gap-2.5";
/** /home's three across: the Activity rail takes a quarter of the pane. */
export const IDENTITY_GRID_RAIL = "grid grid-cols-3 gap-2.5";

/** Whether a role is in use: live agents, when it was last seen, who else can wear it. */
interface IdentityCardStats {
  running: number;
  /** Epoch ms; `null` = nothing on record, which is not "never used". */
  lastUsed: number | null;
  /** Never used, as the account's preview states it; said only with no use on record. */
  notUsedYet?: boolean;
  /** Members who can wear a SHARED identity; empty on a private one. */
  wornBy: ReadonlyArray<AvatarStackUser>;
}

/** What a card needs from its host beyond the row itself. Every member is optional. */
export interface IdentityCardHost {
  /** `by <member>` for a row this operator did not write, else `null`. */
  markerFor?: (identity: AgentIdentity) => string | null;
  /** The OWNER's photo (`identity.createdBy`), never the viewer's; `null` = the profile glyph. */
  photoFor?: (identity: AgentIdentity) => string | null;
  /** A runtime id's display label; absent = the id. */
  runtimeLabel?: (runtime: string) => string;
  /** Absent = no state line. */
  statsFor?: (identity: AgentIdentity) => IdentityCardStats | null;
  /** Where a row is shared; absent = no scope line. */
  scopeFor?: (identity: AgentIdentity) => string | null;
  /** The live model catalogs, so a model chip reads as its short label. */
  catalogs?: ModelCatalogs | null;
}

export function IdentityPanel({
  id,
  label,
  action,
  flat,
  children,
}: {
  /** Id the heading carries, so the section is a named region. */
  id: string;
  label: string;
  /** Header-right control (a create button). */
  action?: ReactNode;
  /** No well: the section sits on the page (/home). */
  flat?: boolean;
  children: ReactNode;
}) {
  return (
    <SectionPanel id={id} label={label} action={action} flat={flat}>
      {children}
    </SectionPanel>
  );
}

/** The card grid, or the one quiet line that stands in for it. */
export function IdentityGrid({
  identities,
  emptyLine,
  onOpen,
  pendingIds,
  actionFor,
  onCreate,
  grid = IDENTITY_GRID,
  ...host
}: IdentityCardHost & {
  identities: ReadonlyArray<AgentIdentity>;
  /** The grid's class; the host picks the column count for its own layout. */
  grid?: string;
  /** Rendered only against a resolved read; absent = an empty grid renders nothing. */
  emptyLine?: string;
  /** Absent = the cards are not openable on this surface. */
  onOpen?: (identity: AgentIdentity) => void;
  /** Rows with a write in flight — dimmed and inert via the kit's PENDING_ROW. */
  pendingIds?: ReadonlySet<string>;
  /** The card's footer controls (knowledge, launch). */
  actionFor?: (identity: AgentIdentity) => ReactNode;
  /** A dashed "Create new" cell after the cards; it stands in for the empty line too. */
  onCreate?: () => void;
}) {
  if (identities.length === 0 && !onCreate) {
    return emptyLine ? <p className="pb-1 text-caption text-text-muted">{emptyLine}</p> : null;
  }
  return (
    <div className={grid}>
      {identities.map((identity) => (
        <IdentityCard
          key={identity.id}
          identity={identity}
          onOpen={onOpen}
          pending={pendingIds?.has(identity.id) ?? false}
          action={actionFor?.(identity) ?? null}
          host={host}
        />
      ))}
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="flex min-h-[104px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong text-small font-medium text-text-muted transition-colors hover:border-border-highlight hover:text-text-secondary"
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          Create new
        </button>
      )}
    </div>
  );
}

export function IdentitySection({
  section,
  identities,
  onOpen,
  pendingIds,
  catalogs,
}: {
  section: IdentitySectionDef;
  identities: ReadonlyArray<AgentIdentity>;
  onOpen: (identity: AgentIdentity) => void;
  pendingIds?: ReadonlySet<string>;
  catalogs?: ModelCatalogs | null;
}) {
  return (
    <IdentityPanel id={`agent-identities-${section.visibility}`} label={section.label}>
      <IdentityGrid
        identities={identities}
        emptyLine={section.emptyLine}
        onOpen={onOpen}
        pendingIds={pendingIds}
        catalogs={catalogs}
      />
    </IdentityPanel>
  );
}

/**
 * THE FACT CHIP: 24px, hairline, near-white, a 14px mark then the text, as wide as its fact.
 * 🔒 One concept per chip: what a role runs on and what it knows are two chips, and nothing is
 * appended to a chip that is not its own concept.
 */
const IDENTITY_ROW =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-[7px] border border-border-default bg-bg-elevated pl-1.5 pr-2 text-caption text-text-primary";

/** The quiet add row on a personal card: the chip's geometry, dashed. */
export const IDENTITY_ROW_ADD =
  "flex h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] border border-dashed border-border-strong bg-transparent pl-1.5 pr-2 text-caption text-text-muted transition-colors hover:border-border-highlight hover:text-text-secondary";

/** A runtime's 14px mark: its logo, or a generic chip glyph for a runtime with none. */
export function RuntimeMark({ logo }: { logo: string | null }) {
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element -- also renders in the Vite SPA
    <img src={logo} alt="" draggable={false} className="size-3.5 rounded-[3px] object-contain" />
  ) : (
    <Cpu size={12} strokeWidth={2} aria-hidden="true" />
  );
}

/** The 14px cell a chip's or a row's mark sits in. */
export const FACT_MARK = "flex size-3.5 flex-none items-center justify-center text-text-muted";

export function FactChip({ mark, children }: { mark?: ReactNode; children: ReactNode }) {
  return (
    <span className={IDENTITY_ROW}>
      {mark && <span className={FACT_MARK}>{mark}</span>}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * One identity as a card, answering in order: whose role is this (owner face + name + marker),
 * what it is for, what it runs on, what it knows, where it is shared, whether it is working.
 * The authorship marker is a security signal (`identity-picker.tsx › authorMarker`, INVARIANTS
 * §5A): it is the owner's line under the name. With an `action`, the face becomes a `div` and the
 * body the button (no nested buttons).
 */
function IdentityCard({
  identity,
  onOpen,
  pending,
  action,
  host,
}: {
  identity: AgentIdentity;
  onOpen?: (identity: AgentIdentity) => void;
  pending: boolean;
  action: ReactNode;
  host: IdentityCardHost;
}) {
  const logoFor = useRuntimeLogo();
  const description = identity.description?.trim();
  const marker = host.markerFor?.(identity) ?? null;
  const stats = host.statsFor?.(identity) ?? null;
  const scope = host.scopeFor?.(identity) ?? null;
  const runtime = identity.runtime;
  const runtimeName = runtime ? (host.runtimeLabel?.(runtime) ?? runtime) : null;
  const logo = logoFor(runtime);
  // The model names the runtime, so it is the chip's text when set; the runtime stands in when not.
  const runsOn = agentModelShortLabel(identity.model, host.catalogs) ?? runtimeName;
  const sources = (identity.knowledge ?? EMPTY_KNOWLEDGE).length;
  const neverUsed = !!stats?.notUsedYet && stats.running === 0 && stats.lastUsed === null;
  const stateLine = stats && (stats.running > 0 || stats.lastUsed !== null || neverUsed);

  const body = (
    <>
      <span className="flex w-full items-center gap-2.5">
        <IdentityFace
          size="l"
          photo={host.photoFor?.(identity)}
          runtimeLogo={logo}
          ring="neutral"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("min-w-0 truncate", IDENTITY_NAME_TEXT)}>{identity.name}</span>
          {marker && <span className="min-w-0 truncate text-label text-text-muted">{marker}</span>}
        </span>
        {logo && runtimeName && <span className="sr-only">Runs on {runtimeName}</span>}
        {stats && stats.wornBy.length > 0 && (
          <AvatarStack users={stats.wornBy} max={3} size="s" />
        )}
      </span>

      {description && (
        <span className="line-clamp-2 text-small leading-relaxed text-text-secondary">
          {description}
        </span>
      )}

      {(runsOn || sources > 0) && (
        <span className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
          {runsOn && <FactChip mark={<RuntimeMark logo={logo} />}>{runsOn}</FactChip>}
          {sources > 0 && (
            <FactChip mark={<BookOpen size={12} strokeWidth={2} aria-hidden="true" />}>
              {sources} {sources === 1 ? "source" : "sources"}
            </FactChip>
          )}
        </span>
      )}

      {scope && (
        <span className="flex w-full min-w-0 items-center gap-1.5 text-label text-text-muted">
          <Users size={12} strokeWidth={2} className="flex-none" aria-hidden="true" />
          <span className="min-w-0 truncate">{scope}</span>
        </span>
      )}

      {stateLine && (
        <span className="mt-auto flex w-full min-w-0 items-center gap-1.5 text-label">
          {stats.running > 0 && (
            <>
              <span className="size-1.5 flex-none rounded-full bg-success" aria-hidden="true" />
              <span className="flex-none font-medium text-text-primary">
                {stats.running} running
              </span>
              {stats.lastUsed !== null && <span className="flex-none text-text-disabled">·</span>}
            </>
          )}
          {stats.lastUsed !== null && (
            <span className="min-w-0 truncate text-text-muted">Used {agoLabel(stats.lastUsed)}</span>
          )}
          {neverUsed && <span className="min-w-0 truncate text-text-muted">Not used yet</span>}
        </span>
      )}
    </>
  );

  const shell = "white-card flex min-h-[104px] flex-col gap-2.5 p-3 text-left";
  // The kit's `.card-lift`, shared with the Knowledge card.
  const raise = "card-lift";

  if (action) {
    return (
      <div {...pendingRow(pending, cn(shell, onOpen && raise))}>
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(identity)}
            className="flex flex-1 cursor-pointer flex-col items-start gap-2.5 text-left"
          >
            {body}
          </button>
        ) : (
          body
        )}
        <div className="mt-auto flex w-full flex-col gap-1.5 border-t border-border-default pt-2.5">
          {action}
        </div>
      </div>
    );
  }

  if (!onOpen) return <div {...pendingRow(pending, shell)}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(identity)}
      {...pendingRow(pending, cn(shell, "cursor-pointer", raise))}
    >
      {body}
    </button>
  );
}
