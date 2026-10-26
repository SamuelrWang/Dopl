"use client";

/**
 * STAGING COPY of `src/features/agent-identities/components/identity-section.tsx`.
 *
 * ⚠ **NO LONGER VERBATIM — THE CARD IS REBUILT HERE.** Item 2b (Samuel, 2026-10-22: *"I said to
 * do an overhaul… it needs to really consider what should be going on these identity cards and
 * how to make it look really good"*, after the first pass only made the edits he had named).
 * The panel, the grid and every prop the product passes are unchanged; {@link IdentityCard} is a
 * new card, built on the landing's identity card (`multiplayer-visuals.tsx › IdentityVisual`,
 * `docs/DESIGN-LANGUAGE.md` §1–§4) and taking four NEW optional props — `faceFor`, `statsFor`,
 * `scopeLabel`, `knowledgeRows`. All default to nothing. See PORTING.md before porting.
 */
import type { ReactNode } from "react";
import { BookOpen, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Img } from "@/features/onboarding/components/paired-avatar";
import { IdentityFace } from "@/shared/ui/identity-face";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import type { ModelCatalogs } from "@/features/channels/lib/model-catalog";
import { pendingRow } from "@/shared/ui/pending";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { SectionPanel } from "@/shared/ui/section-panel";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import type { AgentIdentity } from "@/features/agent-identities/client/types";

/**
 * One scope panel and its cards: a flat `SectionPanel` holding `.bento` cards — nothing pressed in
 * (Samuel's ruling). Shell, grid and section are separately callable so the /home face composes
 * the same parts. An empty section keeps its header and says one line.
 */

/**
 * WHOSE IDENTITY IT IS AND WHAT IT RUNS ON — the one thing the card cannot read off
 * `AgentIdentity`, because a photo needs a roster and a runtime logo needs the runtime registry.
 * The host answers it per row ({@link IdentityGrid}'s `faceFor`), exactly as it already answers
 * `markerFor`; staging's answer is `identities-staging/data.ts › identityCardFace`.
 */
export interface IdentityCardFace {
  /** The OWNER's photo (`identity.createdBy`), never the viewer's. `null` = the profile glyph. */
  photo: string | null;
  /** `null` when no runtime is selected — the avatar then draws no badge at all. */
  runtimeLogo: string | null;
  /** The runtime's label, for the avatar's accessible name (the badge itself is decoration). */
  runtimeLabel: string | null;
}

/**
 * WHETHER THE ROLE IS WORKING — the card's bottom line, and the half of the page that was
 * missing: a list of identities that cannot say which of them is in use is a filing cabinet.
 * Staging's answer is mock (`data.ts › identityCardStats`); in the product `running` is the live
 * session list filtered by `identityName`, `lastUsed` is `updatedAt` through a relative formatter,
 * and `wornBy` is the channel roster.
 */
export interface IdentityCardStats {
  /** Agents running from this identity right now. */
  running: number;
  /** An already-formatted relative label ("40m ago"); `null` = never launched. */
  lastUsed: string | null;
  /** Members who can wear a SHARED identity. Empty on a private one. */
  wornBy: ReadonlyArray<{
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  }>;
}

/**
 * Cards per row, FIXED (Samuel's ruling, not auto-fill); the skeletons import it.
 *
 * ⚠ ITEM 8 (2026-10-24): FOUR → THREE, and only because the column shrank. The ruling was four
 * across the full pane; the Activity rail now takes a quarter of it, and at a 1440px staging
 * window four cards measured 173px each with every name truncated. Three measure ≈ 235px, the
 * width four had before the rail. Still fixed, still not auto-fill. Samuel's call to confirm
 * (PORTING.md › Item 8).
 */
export const IDENTITY_GRID = "grid grid-cols-3 gap-2.5";

export function IdentityPanel({
  id,
  label,
  action,
  caption,
  children,
}: {
  /** Id the heading carries, so the section is a named region. */
  id: string;
  label: string;
  /** Header-right control (the /home face's scope pill). */
  action?: ReactNode;
  /** ONE quiet line under the heading — the kit's own slot, for a RULE the operator needs. */
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SectionPanel
      id={id}
      label={label}
      action={action}
      caption={caption}
    >
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
  markerFor,
  actionFor,
  catalogs,
  faceFor,
  statsFor,
  scopeFor,
}: {
  identities: ReadonlyArray<AgentIdentity>;
  /** Rendered only against a resolved read; absent = an empty grid renders nothing. */
  emptyLine?: string;
  /** Absent = the cards are not openable on this surface. */
  onOpen?: (identity: AgentIdentity) => void;
  /** Rows with a write in flight — dimmed and inert via the kit's PENDING_ROW. */
  pendingIds?: ReadonlySet<string>;
  /** `by <member>` for a row this operator did not write, else `null`. */
  markerFor?: (identity: AgentIdentity) => string | null;
  /** A second control for a row, under the body ({@link IdentityCard}). */
  actionFor?: (identity: AgentIdentity) => ReactNode;
  /** The live model catalogs the host holds, so a model chip reads as its label, not a raw id. */
  catalogs?: ModelCatalogs | null;
  /** The owner's photo + runtime badge for a row ({@link IdentityCardFace}); absent = neither. */
  faceFor?: (identity: AgentIdentity) => IdentityCardFace | null;
  /** Live state for a row ({@link IdentityCardStats}); absent = the card draws no bottom line. */
  statsFor?: (identity: AgentIdentity) => IdentityCardStats | null;
  /** The scope line a row carries, so a card says where it is shared. PER ROW since item 3c: the
   *  page shows every channel at once, so "Shared in this channel" is no longer one string for the
   *  whole section (`page/identity-page-data.ts › reachLabel`). Absent = no scope line. */
  scopeFor?: (identity: AgentIdentity) => string | null;
}) {
  if (identities.length === 0) {
    return emptyLine ? (
      <p className="px-1 pb-1 text-caption text-text-muted">{emptyLine}</p>
    ) : null;
  }
  return (
    <div className={IDENTITY_GRID}>
      {identities.map((identity) => (
        <IdentityCard
          key={identity.id}
          identity={identity}
          onOpen={onOpen}
          pending={pendingIds?.has(identity.id) ?? false}
          marker={markerFor?.(identity) ?? null}
          action={actionFor?.(identity) ?? null}
          catalogs={catalogs}
          face={faceFor?.(identity) ?? null}
          stats={statsFor?.(identity) ?? null}
          scopeLabel={scopeFor?.(identity) ?? undefined}
        />
      ))}
    </div>
  );
}

/**
 * THE CARD'S FACT CHIP — a 24px box: hairline, near-white well, 7px radius, a 14px mark then the
 * text (`docs/DESIGN-LANGUAGE.md` §1 "grey is for small wells inside a card", §2's radius and type
 * ladder).
 *
 * 🔒 **ONE CONCEPT PER CHIP, AND A CHIP IS WHAT SAYS SO** (Samuel, 2026-10-22, on the 2b card:
 * *"I see a box with the Claude logo and then two sources on it as well… if the runtime is Claude
 * it doesn't really make sense for the knowledge or whatever to be placed on the same thing"*).
 * A shared box is a claim that its contents belong together. What it runs on and what it knows are
 * two different facts, so they are two chips side by side, and nothing is ever appended to a chip
 * that does not belong to its own concept.
 *
 * Width is natural, never stretched: a chip is as wide as its fact. The row wraps.
 */
const ROW_INK =
  "min-w-0 items-center gap-1.5 border border-border-default bg-bg-elevated text-text-primary";

/** The card's chip: as wide as its fact, 24px, one concept. */
export const IDENTITY_ROW = `inline-flex h-6 max-w-full rounded-[7px] pl-1.5 pr-2 text-caption ${ROW_INK}`;

function Row({
  mark,
  children,
}: {
  /** The 14px mark: the runtime's logo, or the product's own glyph for that concept. */
  mark: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={IDENTITY_ROW}>
      <span className="grid h-3.5 w-3.5 flex-none place-items-center text-text-muted">
        {mark}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** The quiet add row the personal card's knowledge control wears ({@link IDENTITY_ROW}, dashed). */
export const IDENTITY_ROW_ADD =
  "flex h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] border border-dashed border-border-strong bg-transparent pl-1.5 pr-2 text-caption text-text-muted transition-colors hover:border-border-highlight hover:text-text-secondary";

/**
 * ONE IDENTITY AS A CARD — rebuilt for item 2b.
 *
 * ⚠ **IT IS NOT THE LANDING'S IDENTITY CARD, BY INSTRUCTION** (Samuel, 2026-10-22: *"it doesn't
 * need to look at any template. It just needs to use the design elements… Just think about what
 * it should have"*). The design LANGUAGE is the input — the white card on a hairline, the one soft
 * shadow, the grey well, the type ladder, the live dot. The CONTENT is reasoned from what a person
 * does with this page.
 *
 * **What anyone actually does with a grid of roles: pick one.** To pick, four questions, in the
 * order they get asked, and the card answers them in that order and stops:
 *
 * | Question | What answers it | Why it earns the space |
 * |---|---|---|
 * | Which of my roles is this? | the owner's face + the name | an identity is a role OF a person (§3), so the face is the subject, not decoration |
 * | What is it for? | the description, two lines | the only line in the author's own words |
 * | What does it run on? | a chip: the runtime's logo and the model | a role with no runtime cannot launch, and that is invisible today until Launch refuses |
 * | What does it know? | a second chip: how many sources it carries | the thing that makes a role yours rather than a blank agent. ⚠ Its own chip, never appended to the runtime's (see {@link IDENTITY_ROW}) |
 * | Is it working right now? | the state line: a live count and when it was last used | a list that cannot say which role is in use is a filing cabinet |
 *
 * Deliberately NOT on the card, because the editor is where they belong and a 230px card is not:
 * instructions text, field values, every knowledge path, teams, the raw visibility value.
 *
 * ```
 * ┌─────────────────────────────────────┐
 * │ (◉38) Release Captain       ◉◉◉    │  whose role, and who else wears it
 * │       by Grace Kim                  │
 * │ Runs the release checklist, cuts     │  what it is for
 * │ the build and posts notes in …       │
 * │ [◆ Opus 5.5] [▤ 2 sources]           │  what it runs on · what it knows
 * │ ⧉ Shared in this channel            │  its scope, in the section's own words
 * │ ● 1 running · Used 40m ago           │  whether it is working
 * └─────────────────────────────────────┘
 * ```
 *
 * - **The marker is the OWNER, as their face plus their name** — not the grey pill it was. Still
 *   `identity-picker.tsx › authorMarker`, still on every row the viewer did not write
 *   (INVARIANTS §5A); the photo makes it louder, not quieter.
 * - **Greyscale throughout.** The one colour is the live dot, which §1 rule 5 reserves for exactly
 *   that. No agent colour: an identity has none (see PORTING.md).
 *
 * With an `action`, the face becomes a `div` and the body the button (no nested buttons).
 */
function IdentityCard({
  identity,
  onOpen,
  pending,
  marker,
  action,
  catalogs,
  face,
  stats,
  scopeLabel,
}: {
  identity: AgentIdentity;
  onOpen?: (identity: AgentIdentity) => void;
  pending: boolean;
  marker: string | null;
  action: ReactNode;
  catalogs?: ModelCatalogs | null;
  face: IdentityCardFace | null;
  stats: IdentityCardStats | null;
  scopeLabel?: string;
}) {
  const description = identity.description?.trim();
  // "Claude · Opus 5.5" says one thing twice: the model names the runtime. So the model is the
  // bar's text when it is set, the runtime label stands in when it is not, and the runtime's own
  // logo is the mark either way.
  const model = agentModelShortLabel(identity.model, catalogs);
  const stack = model ?? face?.runtimeLabel ?? null;
  // ⚠ A COUNT, NOT THE PATHS. Which bases are attached is an editor question; whether the role
  // carries any is the card's. Stale-cache fallback as everywhere else (INVARIANTS §8).
  const sources = (identity.knowledge ?? []).length;

  const body = (
    <>
      <span className="flex w-full items-center gap-2.5">
        <IdentityFace size={38} photo={face?.photo} runtimeLogo={face?.runtimeLogo} ring="neutral" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("min-w-0 truncate", IDENTITY_NAME_TEXT)}>
            {identity.name}
          </span>
          {/* The author, under their own photo. `truncate`, because a display name is theirs. */}
          {marker && (
            <span className="min-w-0 truncate text-label text-text-muted">
              {marker}
            </span>
          )}
        </span>
        {/* The badge is decoration; the runtime is a fact, so it is said once for a reader. */}
        {face?.runtimeLogo && face.runtimeLabel && (
          <span className="sr-only">Runs on {face.runtimeLabel}</span>
        )}
        {/* Who else can wear it, where the landing card puts its audience pill. */}
        {stats && stats.wornBy.length > 0 && (
          <AvatarStack users={stats.wornBy} max={3} size="2xs" />
        )}
      </span>

      {description && (
        // The type ladder, three steps and no more: name 14/500, this 12, the meta rows 11.5.
        // It was 11.5 here too, which is why the card read as one flat block of small grey text.
        <span className="line-clamp-2 text-small leading-relaxed text-text-secondary">
          {description}
        </span>
      )}

      {(stack || sources > 0) && (
        // TWO CHIPS, NOT ONE BOX: what it runs on, and what it knows. Separate containers because
        // they are separate facts (see {@link IDENTITY_ROW}). Either may be absent on its own.
        <span className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
          {stack && (
            <Row mark={<Img src={face?.runtimeLogo ?? undefined} px={14} radius={3} />}>
              {stack}
            </Row>
          )}
          {sources > 0 && (
            // `BookOpen` is the product's own glyph for knowledge (/home's Knowledge pane), not the
            // Dopl mark, which says where a source came from rather than what the fact is.
            <Row mark={<BookOpen size={12} strokeWidth={2} aria-hidden="true" />}>
              {sources} {sources === 1 ? "source" : "sources"}
            </Row>
          )}
        </span>
      )}

      {scopeLabel && (
        <span className="flex w-full min-w-0 items-center gap-1.5 text-label text-text-muted">
          <Users size={12} strokeWidth={2} className="flex-none" aria-hidden="true" />
          <span className="min-w-0 truncate">{scopeLabel}</span>
        </span>
      )}

      {stats && (
        <span className="mt-auto flex w-full min-w-0 items-center gap-1.5 text-label">
          {stats.running > 0 && (
            <>
              <span
                className="h-1.5 w-1.5 flex-none rounded-full bg-success"
                aria-hidden="true"
              />
              <span className="flex-none font-medium text-text-primary">
                {stats.running} running
              </span>
              {stats.lastUsed && <span className="flex-none text-text-disabled">·</span>}
            </>
          )}
          <span className="min-w-0 truncate text-text-muted">
            {stats.lastUsed ? `Used ${stats.lastUsed}` : "Not used yet"}
          </span>
        </span>
      )}
    </>
  );

  // §1 rule 1 (cards are white, not the kit's near-white panel) and §2 (12px, not `.bento`'s 14px).
  // Port target if approved: a kit recipe beside `.bento`, never a literal in the component.
  const shell = "bento flex min-h-[104px] flex-col gap-2.5 rounded-xl bg-white p-3 text-left";
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
