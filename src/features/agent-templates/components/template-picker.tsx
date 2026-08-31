"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { MenuDivider, Popover } from "@/shared/ui/popover-menu";
import { cn } from "@/shared/lib/utils";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import { agentTemplateErrorMessage } from "../client/api";
import type { AgentTemplate } from "../client/types";
import { useAgentTemplates } from "../hooks/use-agent-templates";
import { SECTIONS, groupByVisibility } from "../lib/visibility";
import type { TemplateLaunchOverrides } from "../lib/launch-overrides";
import { TemplateLaunchSheet } from "./launch-sheet";
import {
  TemplateApprovalDialog,
  type TemplateApprovalRequest,
} from "./template-approval";

/**
 * WHICH IDENTITY THE NEXT AGENT WEARS — one popover, with ONE live mount:
 * `channels-v2/agents-tab.tsx`'s New Agent split button.
 *
 * ⚠ THIS DOCBLOCK SAID "mounted by BOTH launch surfaces … and
 * `channels-v2/composer.tsx`'s Bot icon" UNTIL 2026-08-30, AND THAT MOUNT WAS
 * RETIRED ON 2026-08-27. The composer's Bot icon and the chevron beside it are
 * both replaced by `channels-v2/composer-launch-panel.tsx`, whose **Template
 * row is this picker's whole function**; `composer.tsx` imports
 * `TemplateApprovalDialog` and `ComposerLaunch` and no picker at all. INVARIANTS
 * §5A carried the same stale sentence and is corrected in the same change.
 * Re-derive rather than trusting this line: `grep -rn TemplateLaunchPicker src apps`.
 *
 * ⚠ THE ONE-CLICK BLANK LAUNCH IS UNTOUCHED AND THIS COMPONENT IS NOT ON IT
 * (Samuel's standing channels-v2 ruling — *one lane, one-click launch* — which
 * RESOLVES the spec's OQ-4 against its own recommendation). The New Agent button
 * still spawns a blank agent in exactly one click; this opens from a DISTINCT
 * adjacent chevron zone beside it. A popover that intercepted the click would
 * put a keystroke in front of the most common action in the product.
 *
 * ⚠ THE READ IS SHAREABLE, AND THAT IS DIFFERENT FROM `useAgentsPanel` — kept
 * because it is the rule for the NEXT surface that wants this picker, not a
 * claim that a second mount exists today. The "never mount it twice" rule there
 * is about a POLL INTERVAL (`PEER_SESSIONS_POLL_MS` — two mounts are two answers
 * to "how fresh is fresh enough"). `useAgentTemplates` is a react-query read on
 * a stable key, so two mounts would share one in-flight fetch and one cache
 * entry. ⚠ And the hook lives in {@link PickerBody}, which `Popover` mounts only
 * while the popover is OPEN — so a channel the operator never opens the picker
 * in costs no request at all.
 *
 * ⚠ THE AUTHORSHIP MARKER IS A SECURITY SIGNAL, NOT DECORATION (§4's injection
 * surface). A `team` / `workspace` template's instructions are another member's
 * text about to run on this machine under this operator's credential, and this
 * marker is the ONLY signal shown to the human BEFORE the choice is made — so it
 * is in the row's accessible name as well as on its face. `createdBy` is already
 * on the list DTO; this costs no server change.
 *
 * ⚠ NO COUNT CAP. The server returns only what the caller may see, and a cap
 * would hide a template with no way to reach it. The popover is bounded by
 * height and scrolls; a search input appears past {@link SEARCH_THRESHOLD}.
 *
 * ⚠ NO CONCAVE SURFACE (Samuel, 2026-08-22) — swept by
 * `./template-editor.test.tsx › no concave surfaces`, which reads every source
 * under `features/agent-templates/{components,lib,hooks,client}`.
 */

/** Below this the search field is chrome for nothing. */
export const SEARCH_THRESHOLD = 8;

/**
 * What `sessions.launch` answered, read TOLERANTLY.
 *
 * ⚠ `template` RIDES A REFUSAL, WHICH IS UNUSUAL AND DELIBERATE. Main refuses a
 * first-use foreign template with `reason: 'template-approval'` and hands back
 * the name and instructions IT resolved — not the ones this cache holds — so the
 * modal shows the text that would actually have run. Both halves are optional
 * here because this tree and the desktop ship separately: a main that words the
 * payload differently degrades to the cached row rather than to a blank modal.
 */
export interface TemplateLaunchOutcome {
  ok: boolean;
  reason?: string;
  template?: { name?: string | null; instructions?: string | null } | null;
}

export interface TemplatePickerHandlers {
  /**
   * `null` launches a BLANK agent — the same act the surface's main click
   * performs, and the same payload.
   */
  launch: (
    templateId: string | null,
    overrides?: TemplateLaunchOverrides
  ) => Promise<TemplateLaunchOutcome>;
  /**
   * Remember this operator's first-use approval of a FOREIGN template, on THIS
   * machine. ⚠ Optional and FEATURE-DETECTED BY THE CALLER on the bridge op it
   * wraps — a main old enough to refuse with `template-approval` but without the
   * op cannot be talked into remembering, and the modal must say so rather than
   * loop.
   */
  approve?: (templateId: string) => Promise<{ ok: boolean; reason?: string }>;
}

/**
 * `by <member>` for a template this operator did not write, else `null`.
 *
 * ⚠ AN UNRESOLVABLE AUTHOR IS STILL FOREIGN. `createdBy` is a WORKSPACE member
 * and the map is the CHANNEL's roster, so a template shared by someone who is
 * not in this channel resolves to no name; `created_by` is also nulled when its
 * author leaves the workspace. Both answer "somebody else wrote this", which is
 * the security-relevant half — dropping the marker because the name is missing
 * would turn UNKNOWN into MINE (INVARIANTS §11).
 */
export function authorMarker(
  template: AgentTemplate,
  currentUserId: string | null,
  memberNames?: ReadonlyMap<string, string>
): string | null {
  if (currentUserId && template.createdBy === currentUserId) return null;
  const name = template.createdBy ? memberNames?.get(template.createdBy) : null;
  return name ? `by ${name}` : "by another member";
}

/**
 * The chevron zone's own state, so both surfaces spell the trigger the same way
 * while wearing different chrome (a split button; an icon pair).
 *
 * ⚠ COORDINATE MODE, like `SelectMenu` and the editor's pickers: both launch
 * surfaces sit inside scrolling, overflow-clipping panes where a
 * trigger-anchored panel renders as a clipped sliver.
 *
 * ⚠ NO REF, AND THAT IS NOT AN ACCIDENT. The obvious shape returns a
 * `triggerRef` for the surface to attach — but every read of the returned object
 * during render then trips `react-hooks/refs` ("cannot access refs during
 * render"), and the root lint runs `--max-warnings 0`. The click event already
 * carries the element that was clicked, so {@link openAt} takes it and the hook
 * holds nothing but coordinates.
 */
export function useTemplatePicker() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return {
    at,
    open: at !== null,
    close: () => setAt(null),
    /** Toggle, anchored under the element that was clicked. */
    toggleFrom: (el: HTMLElement | null) => {
      if (at) {
        setAt(null);
        return;
      }
      const rect = el?.getBoundingClientRect();
      setAt(rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 0, y: 0 });
    },
  };
}

export function TemplateLaunchPicker({
  open,
  at,
  onClose,
  workspaceId,
  currentUserId = null,
  memberNames,
  busy = false,
  launch,
  approve,
}: {
  open: boolean;
  at: { x: number; y: number } | null;
  onClose: () => void;
  workspaceId: string;
  currentUserId?: string | null;
  /** `userId → display name`, for the authorship marker. */
  memberNames?: ReadonlyMap<string, string>;
  /** A launch already in flight — the same double-submit guard the surfaces use. */
  busy?: boolean;
} & TemplatePickerHandlers) {
  const [sheetFor, setSheetFor] = useState<AgentTemplate | null>(null);
  const [approval, setApproval] = useState<TemplateApprovalRequest | null>(null);
  // The overrides the refused launch carried, replayed verbatim after approval.
  const [heldOverrides, setHeldOverrides] = useState<
    TemplateLaunchOverrides | undefined
  >(undefined);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  /**
   * ⚠ THE APPROVAL REFUSAL IS HANDLED HERE AND NOWHERE ELSE. Every OTHER refusal
   * is the SURFACE's to say — it already owns a `role="alert"` line under its
   * button (`use-agents-panel.ts › launchRefusalText`) — and duplicating that
   * here would report one refusal in two places. `template-approval` is not a
   * refusal the operator can read and act on in a line of copy; it is a question.
   */
  async function run(
    templateId: string | null,
    overrides: TemplateLaunchOverrides | undefined,
    fallback: AgentTemplate | null
  ) {
    const res = await launch(templateId, overrides);
    if (res.ok || res.reason !== "template-approval" || templateId === null) return;
    setHeldOverrides(overrides);
    setApproveError(null);
    setApproval({
      templateId,
      // Main's resolved text FIRST — it is what would have run. The cached row
      // is the degradation for a desktop that words the payload differently.
      name: res.template?.name || fallback?.name || "this template",
      instructions: res.template?.instructions ?? fallback?.instructions ?? null,
      authorLabel: fallback
        ? authorMarker(fallback, currentUserId, memberNames)
        : null,
    });
  }

  function pick(template: AgentTemplate) {
    onClose();
    void run(template.id, undefined, template);
  }

  function openSheet(template: AgentTemplate) {
    onClose();
    setSheetFor(template);
  }

  async function confirmApproval() {
    if (!approval) return;
    if (!approve) {
      // The op is absent on this build — say so instead of spinning.
      setApproveError("Not available here");
      return;
    }
    setApproving(true);
    setApproveError(null);
    try {
      const stored = await approve(approval.templateId);
      if (!stored.ok) {
        setApproveError("Could not save that approval — try again");
        return;
      }
      const res = await launch(approval.templateId, heldOverrides);
      if (!res.ok && res.reason === "template-approval") {
        // The approval did not stick. Staying open is the honest answer: closing
        // would leave the operator looking at a surface that did nothing twice.
        setApproveError("Could not save that approval — try again");
        return;
      }
      setApproval(null);
    } finally {
      setApproving(false);
    }
  }

  return (
    <>
      <Popover
        open={open}
        at={at ?? undefined}
        onClose={onClose}
        className="max-h-[min(60vh,420px)] w-[288px] overflow-y-auto"
      >
        <PickerBody
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          memberNames={memberNames}
          busy={busy}
          onBlank={() => {
            onClose();
            void run(null, undefined, null);
          }}
          onPick={pick}
          onOptions={openSheet}
        />
      </Popover>

      <TemplateLaunchSheet
        open={sheetFor !== null}
        template={sheetFor}
        busy={busy}
        onCancel={() => setSheetFor(null)}
        onLaunch={(overrides) => {
          const template = sheetFor;
          setSheetFor(null);
          if (template) void run(template.id, overrides, template);
        }}
      />

      <TemplateApprovalDialog
        open={approval !== null}
        request={approval}
        busy={approving}
        error={approveError}
        onCancel={() => {
          setApproval(null);
          setApproveError(null);
        }}
        onConfirm={() => void confirmApproval()}
      />
    </>
  );
}

/**
 * The popover's contents. ⚠ SEPARATE COMPONENT BECAUSE OF THE HOOK: `Popover`
 * renders nothing while closed, so mounting the read here is what keeps a picker
 * the operator never opens from costing a request.
 */
function PickerBody({
  workspaceId,
  currentUserId,
  memberNames,
  busy,
  onBlank,
  onPick,
  onOptions,
}: {
  workspaceId: string;
  currentUserId: string | null;
  memberNames?: ReadonlyMap<string, string>;
  busy: boolean;
  onBlank: () => void;
  onPick: (template: AgentTemplate) => void;
  onOptions: (template: AgentTemplate) => void;
}) {
  const list = useAgentTemplates(workspaceId);
  const [query, setQuery] = useState("");

  // ⚠ THE THRESHOLD READS THE WHOLE LIST, NEVER THE FILTERED ONE. A field that
  // disappeared once its own filter narrowed the list past 8 would take the
  // operator's cursor with it mid-word.
  const searchable = list.templates.length > SEARCH_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? list.templates.filter((t) => t.name.toLowerCase().includes(needle))
        : list.templates,
    [list.templates, needle]
  );
  const grouped = useMemo(() => groupByVisibility(visible), [visible]);
  // ⚠ HEADERS ONLY WHEN THERE IS SOMETHING TO TELL APART. One non-empty group
  // means the header labels every row on screen, which is a word that carries no
  // information (INVARIANTS §5, minimal copy).
  const filled = SECTIONS.filter((s) => grouped[s.visibility].length > 0);

  return (
    <div className="flex flex-col">
      {/* ⚠ FIRST ROW, AND IT IS THE SAME ACT AS THE SURFACE'S MAIN CLICK. It is
          redundant on purpose: an operator who opened the picker to browse must
          be able to back out into the default without hunting for the button
          behind the backdrop. */}
      <button
        type="button"
        role="menuitem"
        autoFocus
        onClick={onBlank}
        disabled={busy}
        className="menu-row flex w-full cursor-pointer flex-col items-start gap-0.5 px-2.5 py-1.5 text-left disabled:opacity-60"
      >
        <span className="text-small text-text-primary">Blank agent</span>
        <span className="text-caption text-text-muted">No template</span>
      </button>

      {(list.loading || list.error != null || visible.length > 0 || searchable) && (
        <MenuDivider />
      )}

      {searchable && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5">
          <Search size={12} aria-hidden className="shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search templates"
            placeholder="Search templates"
            className="min-w-0 flex-1 bg-transparent text-small text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
      )}

      {list.loading ? (
        <p className="px-2.5 py-2 text-caption text-text-muted">Loading templates…</p>
      ) : list.error != null ? (
        // ⚠ "COULD NOT ASK" IS NOT "NOTHING TO SHOW". An empty list under a
        // failed read would read as "you have no templates" (INVARIANTS §11).
        <p role="alert" className="px-2.5 py-2 text-caption text-danger">
          {agentTemplateErrorMessage(list.error, "Couldn't load templates")}
        </p>
      ) : visible.length === 0 ? (
        <p className="px-2.5 py-2 text-caption text-text-muted">
          {needle ? "No template matches." : "No templates yet."}
        </p>
      ) : (
        filled.map((section) => (
          <div key={section.visibility} role="none">
            {filled.length > 1 && (
              <p className="px-2.5 pb-0.5 pt-2 text-label font-semibold uppercase tracking-wide text-text-muted">
                {section.label}
              </p>
            )}
            {grouped[section.visibility].map((template) => (
              <TemplateRow
                key={template.id}
                template={template}
                marker={authorMarker(template, currentUserId, memberNames)}
                busy={busy}
                onPick={onPick}
                onOptions={onOptions}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/**
 * ONE TEMPLATE, AND TWO ACTS. The row LAUNCHES; the trailing chevron opens the
 * launch sheet.
 *
 * ⚠ TWO SIBLING BUTTONS, NEVER A NESTED ONE. A button inside a button is invalid
 * HTML and browsers resolve it by dropping one of them — which one is not
 * specified. `role="none"` on the wrapper keeps the popover's `role="menu"` and
 * its `menuitem` children adjacent, as the a11y tree requires.
 */
function TemplateRow({
  template,
  marker,
  busy,
  onPick,
  onOptions,
}: {
  template: AgentTemplate;
  marker: string | null;
  busy: boolean;
  onPick: (template: AgentTemplate) => void;
  onOptions: (template: AgentTemplate) => void;
}) {
  const model = agentModelShortLabel(template.model);
  return (
    <div role="none" className="flex items-stretch">
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick(template)}
        disabled={busy}
        // ⚠ THE MARKER IS IN THE ACCESSIBLE NAME. A screen-reader operator gets
        // the same security signal a sighted one does, before the choice.
        aria-label={["Launch", template.name, marker ? `(${marker})` : null]
          .filter(Boolean)
          .join(" ")}
        className="menu-row flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate text-small text-text-primary">
          {template.name}
        </span>
        {marker && (
          <span className="shrink-0 text-caption text-text-muted">{marker}</span>
        )}
        {/* ⚠ NO CHIP ON AN UNSET MODEL. `agentModelShortLabel` returns null for
            exactly that, and a chip reading "Default" on every unset row would
            be three words of chrome per row saying nothing. */}
        {model && (
          <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
            {model}
          </span>
        )}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onOptions(template)}
        disabled={busy}
        aria-label={`Launch options for ${template.name}`}
        className={cn(
          "menu-row flex w-7 shrink-0 cursor-pointer items-center justify-center",
          "text-text-muted transition-colors hover:text-text-primary disabled:opacity-60"
        )}
      >
        <ChevronRight size={13} aria-hidden />
      </button>
    </div>
  );
}
