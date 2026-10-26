"use client";

/**
 * THE IDENTITY VIEW POPUP. A card click used to open the EDIT FORM; Samuel (2d): *"the popup needs
 * to show just the identity as is in a non-editable format… There can be a button at the top right
 * or something where the user can click Edit… It shouldn't be a ton of scrolling. I think we
 * probably need to make maybe different tabs."*
 *
 * So: a READ-ONLY surface, a fixed box whose body is the only thing that scrolls, four tabs on his
 * four axes (what it IS, what it may DO, what it HAS done, where it is working NOW), and the
 * editor one button away. Nothing here is editable, including things that are editable elsewhere:
 * a tool's grant is a chip, not a toggle.
 *
 * ── ITEM 2E: THE FORMATTING ──────────────────────────────────────────────────────────────────
 * ⚠ **2d SHIPPED THIS AND SAMUEL REJECTED THE LOOK**: *"no formatting… hodgepodge of random
 * stuff"*, against the identity cards' *"very clear-cut elements"*. The content was right; the
 * composition was four tabs in four different languages — full-width bars on one, bare bullet
 * lists on another, bordered boxes on a third.
 *
 * Every tab is now composed of the same four elements and nothing else
 * (`./identity-view-parts.tsx`, `Plans/UI Standing Rules`, Rule 4 (clear-cut elements)): a labelled `Group`, a `Chip`
 * sized to its fact, a `Fact` in a grid, an `EventRow` with a fact in the middle. Prose is prose.
 *
 * 🔒 **AND NO ELEMENT IS STRETCHED (the Blank Space Rule).** 2d drew runtime and knowledge as full-width bars:
 * at 680px of body that was a mark, nine characters and 600px of nothing. They are chips now, and
 * the slack is filled by putting the next group BESIDE them rather than under them.
 *
 * ⚠ Tools, rules and escalations are MOCK: they are not fields on `AgentIdentity` yet
 * (`identity-view-mocks.ts` has the detail and the open product call). The Identity tab is real.
 */

import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock3,
  Cpu,
  Glasses,
  GitBranch,
  Mail,
  MessageSquare,
  Pencil,
  Search,
  Sheet,
  SquareTerminal,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Img } from "@/features/onboarding/components/paired-avatar";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import type { ModelCatalogs } from "@/features/channels/lib/model-catalog";
import {
  EMPTY_KNOWLEDGE,
  refKey,
  scopeChipLabel,
} from "@/features/agent-identities/lib/knowledge-scopes";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { IdentityAvatar } from "@/features/identities-staging/identity-avatar";
import type {
  IdentityCardFace,
  IdentityCardStats,
} from "@/features/identities-staging/agent-identities/components/identity-section";
// 🔒 Geometry from the module, not from Tailwind utilities — the cache-invalidation instance of
// Rule 6 (prove the style exists) in `Plans/UI Standing Rules`.
// ⚠ RETRACTED REASON: this comment used to say "detection does not reach `identities-staging`".
// That was disproved by a cold rebuild and is false. A CSS module is still the right answer,
// because it compiles outside Tailwind's scan entirely. See the module header for the measured
// mechanism and both retractions.
import styles from "./identity-view.module.css";
import { IDENTITY_MODAL_CLOSE, IdentityModalShell } from "./identity-modal-shell";
import {
  Chip,
  Chips,
  Empty,
  EventRow,
  Fact,
  Facts,
  Group,
  GroupPair,
  Lines,
  Prose,
  Rows,
  StateChip,
} from "./identity-view-parts";
import {
  agoLabel,
  identityViewMock,
  type IdentityLogMock,
  type IdentityToolMock,
} from "./identity-view-mocks";

type TabKey = "identity" | "rules" | "activity" | "running";

/** The glyph a mocked tool wears. Lucide, greyscale: a brand SVG would bring its own colour. */
const TOOL_GLYPH: Record<IdentityToolMock["mark"], ReactNode> = {
  repo: <GitBranch size={13} strokeWidth={2} />,
  terminal: <SquareTerminal size={13} strokeWidth={2} />,
  channels: <MessageSquare size={13} strokeWidth={2} />,
  calendar: <CalendarDays size={13} strokeWidth={2} />,
  sheet: <Sheet size={13} strokeWidth={2} />,
  mail: <Mail size={13} strokeWidth={2} />,
  glasses: <Glasses size={13} strokeWidth={2} />,
  search: <Search size={13} strokeWidth={2} />,
};

/** What a log row's permission says, when it says anything. `auto` is the ordinary case and draws
 *  no chip: one on every row is the bloat Samuel named. Words are the landing's own
 *  (`control-content.ts › LOG_COPY.permission`). */
const PERMISSION_WORD: Record<Exclude<IdentityLogMock["permission"], "auto">, string> = {
  approved: "Approved by you",
  waiting: "Waited for you",
  paused: "Paused",
};

export function IdentityViewDialog({
  identity,
  face,
  stats,
  marker,
  scopeLabel,
  catalogs,
  onClose,
  onEdit,
}: {
  identity: AgentIdentity;
  face: IdentityCardFace | null;
  stats: IdentityCardStats | null;
  /** `by <member>` for a row this operator did not write, else `null` — the card's own signal
   *  (`identity-picker.tsx › authorMarker`, INVARIANTS §5A), carried into the popup unchanged. */
  marker: string | null;
  /** The section's own word for this row's scope ("Shared in this channel"), handed down. */
  scopeLabel?: string;
  catalogs?: ModelCatalogs | null;
  onClose: () => void;
  /** Hands over to the edit form, which is a different surface by design. */
  onEdit: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("identity");
  const mock = identityViewMock(identity.id);
  const running = mock.running.length;
  const wearers = stats?.wornBy.length ?? 0;

  const tabs: ReadonlyArray<{ key: TabKey; label: string; count?: number }> = [
    { key: "identity", label: "Identity" },
    { key: "rules", label: "Tools and rules" },
    { key: "activity", label: "Activity" },
    { key: "running", label: "Running", count: running },
  ];

  return (
    <IdentityModalShell open onClose={onClose} label={identity.name}>
      {/* ── The head: never changes with the tab ── */}
      <div className={styles.head}>
        <IdentityAvatar d={44} photo={face?.photo} runtimeLogo={face?.runtimeLogo} />
        <div className={styles.headText}>
          <h2 className="min-w-0 truncate text-display font-semibold text-text-primary">
            {identity.name}
          </h2>
          <p className={cn(styles.headMeta, "text-caption text-text-muted")}>
            <UserRound size={12} strokeWidth={2} className="flex-none" aria-hidden="true" />
            <span className="truncate">{marker ?? "Yours"}</span>
            {wearers > 1 && (
              <>
                <span className="text-text-disabled">·</span>
                <span className="truncate">{wearers} people can wear this</span>
              </>
            )}
            {scopeLabel && (
              <>
                <span className="text-text-disabled">·</span>
                <span className="truncate">{scopeLabel}</span>
              </>
            )}
          </p>
        </div>
        {/* Top right, as asked: the one way out of read-only. */}
        <OpenScaleButton onClick={onEdit} className="flex-none gap-1.5">
          <Pencil size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
          Edit
        </OpenScaleButton>
        <button
          type="button"
          onClick={onClose}
          className={IDENTITY_MODAL_CLOSE}
          aria-label="Close identity"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── The tab strip: the 2px underline Samuel approved on the staged top bar ── */}
      <div
        role="tablist"
        aria-label="Identity sections"
        className={styles.tabs}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              styles.tab,
              "text-small font-medium",
              tab === t.key
                ? cn(styles.tabOn, "text-text-primary")
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              // No `--bg-inset` (item 7's page-wide grey ban): a live count is a dot and a number.
              <span className="flex items-center gap-1 text-micro font-semibold text-text-secondary">
                <span className="h-1 w-1 rounded-full bg-success" aria-hidden="true" />
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── The body: the only thing that scrolls ── */}
      <div className={styles.body}>
        {tab === "identity" && (
          <IdentityTab identity={identity} face={face} catalogs={catalogs} />
        )}
        {tab === "rules" && <RulesTab mock={mock} />}
        {tab === "activity" && <ActivityTab mock={mock} />}
        {tab === "running" && <RunningTab mock={mock} stats={stats} />}
      </div>
    </IdentityModalShell>
  );
}

// ── Tab 1: what it IS ────────────────────────────────────────────────

/**
 * Prose first, then the structured facts: a reader scans the two sentences that explain the role,
 * then the chips that say what it carries. "Runs on" and "Knowledge" sit SIDE BY SIDE — each holds
 * two or three short chips, and stacking them would leave two half-empty rows (the Blank Space Rule).
 */
function IdentityTab({
  identity,
  face,
  catalogs,
}: {
  identity: AgentIdentity;
  face: IdentityCardFace | null;
  catalogs?: ModelCatalogs | null;
}) {
  const model = agentModelShortLabel(identity.model, catalogs);
  const description = identity.description?.trim();
  const instructions = identity.instructions?.trim();
  const knowledge = identity.knowledge ?? EMPTY_KNOWLEDGE;
  const unreachable = identity.unreachableKnowledgeBaseCount ?? 0;

  return (
    <>
      <Group label="What it is for">
        {description ? <Prose>{description}</Prose> : <Empty>No description yet.</Empty>}
      </Group>

      <Group label="How it works" hint="instructions">
        {instructions ? (
          // A quoted block, not a text box: this is the role's own standing order, and a read-only
          // textarea reads as a disabled field.
          <Prose quoted>{instructions}</Prose>
        ) : (
          <Empty>
            No instructions yet, so an agent launched from this runs on its own judgment.
          </Empty>
        )}
      </Group>

      <GroupPair>
        <Group label="Runs on">
          <Chips>
            <Chip
              mark={
                face?.runtimeLogo ? (
                  <Img src={face.runtimeLogo} px={14} radius={3} />
                ) : (
                  <Cpu size={13} strokeWidth={2} />
                )
              }
            >
              {face?.runtimeLabel ?? "No runtime set"}
            </Chip>
            {model && <Chip>{model}</Chip>}
          </Chips>
        </Group>

        <Group
          label="Knowledge"
          hint={unreachable > 0 ? `${unreachable} not reachable` : undefined}
        >
          {knowledge.length === 0 ? (
            <Empty>Nothing attached, so it starts every run with no context of yours.</Empty>
          ) : (
            <Chips>
              {knowledge.map((ref) => (
                <Chip key={refKey(ref)} mark={<Sheet size={13} strokeWidth={2} />}>
                  {scopeChipLabel(ref)}
                </Chip>
              ))}
            </Chips>
          )}
        </Group>
      </GroupPair>

      {identity.fields.length > 0 && (
        <Group label="Fields">
          {/* A grid, three across: a field is a short label over a short value, and one per row
              would be three lines each holding nine characters. */}
          <Facts>
            {identity.fields.map((field) => (
              <Fact key={field.key} label={field.key} value={field.value} />
            ))}
          </Facts>
        </Group>
      )}
    </>
  );
}

// ── Tab 2: what it may DO ────────────────────────────────────────────

function RulesTab({ mock }: { mock: ReturnType<typeof identityViewMock> }) {
  const nothing =
    mock.tools.length === 0 && mock.rules.length === 0 && mock.escalations.length === 0;
  if (nothing) {
    return <Empty>No tools or rules set for this identity yet.</Empty>;
  }
  return (
    <>
      <Group label="Tools" hint="what it may call">
        {mock.tools.length === 0 ? (
          <Empty>No tools granted.</Empty>
        ) : (
          // A tool row has three facts, and the middle one is what it LETS the identity do — so
          // the row's slack is occupied by content rather than by air (the Blank Space Rule).
          <Rows>
            {mock.tools.map((tool) => (
              <EventRow
                key={tool.name}
                lead={
                  <span className={cn(styles.mark, "text-text-muted")}>
                    {TOOL_GLYPH[tool.mark]}
                  </span>
                }
                title={tool.name}
                middle={tool.does}
                trail={
                  <StateChip strong={tool.allowed}>
                    {tool.allowed ? "Allowed" : "Off"}
                  </StateChip>
                }
              />
            ))}
          </Rows>
        )}
      </Group>

      {/* Two short lists, side by side: stacked they are two half-empty columns. */}
      <GroupPair>
        {mock.rules.length > 0 && (
          <Group label="Rules" hint="always">
            <Lines items={mock.rules} icon={<Check size={13} strokeWidth={2.5} />} />
          </Group>
        )}
        {mock.escalations.length > 0 && (
          <Group label="Escalates to you">
            <Lines items={mock.escalations} icon={<ArrowUpRight size={13} strokeWidth={2.5} />} />
          </Group>
        )}
      </GroupPair>
    </>
  );
}

// ── Tab 3: what it HAS done ──────────────────────────────────────────

function ActivityTab({ mock }: { mock: ReturnType<typeof identityViewMock> }) {
  if (mock.log.length === 0) {
    return <Empty>Nothing logged yet. An action shows up here the first time it runs.</Empty>;
  }
  const held = mock.log.filter((row) => row.permission !== "auto").length;
  const rows = [...mock.log].sort((a, b) => a.at - b.at);
  return (
    // The count moves into the group's own hint: 2d spent a whole line on "6 actions today", which
    // is a label's job, not a row's.
    <Group
      label="Today"
      hint={`${mock.log.length} actions${held > 0 ? `, ${held} needed you` : ""}`}
    >
      <Rows>
        {rows.map((row, i) => (
          <EventRow
            key={`${row.at}-${i}`}
            title={row.did}
            middle={row.where}
            trail={
              <>
                {row.permission !== "auto" && (
                  <StateChip strong>{PERMISSION_WORD[row.permission]}</StateChip>
                )}
                <span className="text-caption tabular-nums text-text-muted">
                  {agoLabel(row.at)}
                </span>
              </>
            }
          />
        ))}
      </Rows>
    </Group>
  );
}

// ── Tab 4: where it is working RIGHT NOW ─────────────────────────────

function RunningTab({
  mock,
  stats,
}: {
  mock: ReturnType<typeof identityViewMock>;
  stats: IdentityCardStats | null;
}) {
  if (mock.running.length === 0) {
    return (
      <Empty>
        Not running anywhere right now
        {stats?.lastUsed ? `. Last used ${stats.lastUsed}.` : "."}
      </Empty>
    );
  }
  return (
    <Group label="Running now">
      {/* The same row element as Activity, UN-BOXED: 2d gave these a bordered frame each, which
          made two tabs of the same popup look like two different products. */}
      <Rows>
        {mock.running.map((run) => (
          <EventRow
            key={`${run.agent}-${run.thread}`}
            lead={
              <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" aria-hidden="true" />
            }
            title={run.agent}
            middle={`${run.channel} › ${run.thread}`}
            trail={
              <span className="flex items-center gap-1 text-caption text-text-muted">
                <Clock3 size={12} strokeWidth={2} aria-hidden="true" />
                {run.since}
              </span>
            }
          />
        ))}
      </Rows>
    </Group>
  );
}
