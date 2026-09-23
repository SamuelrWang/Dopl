import { useMemo, useState } from "react";
import { FormDialog, FormSection } from "@/shared/ui/form-dialog";
import { agentTemplateErrorMessage } from "@/features/agent-templates/client/api";
import { useAgentTemplateWrites } from "@/features/agent-templates/hooks/use-agent-template-writes";
import { BaseNode, type ScopeToggle } from "@/features/agent-templates/components/knowledge-scope-tree";
import {
  EMPTY_KNOWLEDGE,
  refKey,
  refToScope,
  sameScopes,
  scopeChipLabel,
} from "@/features/agent-templates/lib/knowledge-scopes";
import { useKnowledgeBaseList } from "@/features/knowledge/client/hooks";
import type {
  AgentTemplate,
  TemplateKnowledgeRef,
} from "@/features/agent-templates/client/types";

/**
 * **"Add knowledge", ON THE CARD** (Samuel, 2026-09-22: *"under the description
 * of the agent and above the launch button, add a gray box that says Add
 * knowledge … the whole gray box should be clickable"*, opening *"a new popup
 * that matches the UI design of the new agent popup"* with *"selectors for
 * knowledge bases as well as specific folders/entries"*, and the picked ones
 * *"showing up as white rectangle bars within the gray box"*).
 *
 * ⚠ **IT ATTACHES TO THE TEMPLATE, NOT TO ONE LAUNCH.** A card has no launch
 * form behind it (`agent-card-launch.tsx` sends the template id and nothing
 * else), so knowledge picked here is a PATCH of the row — which is what makes it
 * true of the next launch, of the popup's launches, and of the MCP surface's.
 * A per-click attachment would be a fourth place knowledge can come from and the
 * only one nothing can read back.
 *
 * ⚠ **THE TREE IS `knowledge-scope-tree.tsx`'s, UNFORKED**, and so is the
 * add-or-remove-plus-prune rule the toggle applies: two rows where one suffices
 * renders the same attachment twice, and the redundant one survives when the
 * operator unchecks the ancestor. The one thing this surface does NOT reuse is
 * `knowledge-scope-picker.tsx` itself — that control is chips plus a POPOVER
 * anchored to an Add button, and Samuel asked for a popup on the kit's form
 * recipe with the selection rendered as bars.
 *
 * ⚠ **ONE SHELF, ONE CACHE ENTRY.** The write is `useAgentTemplateWrites(
 * homeWorkspaceId, "home")`, which MUST match the shelf the PERSONAL section's
 * read was mounted with (`agent-panels.tsx › HOME_SHELF`) — a mismatch patches a
 * key nobody is subscribed to and the save silently does not appear (F-331 with
 * the shelf as the axis).
 */

/** One attachment, as a WHITE BAR — the face Samuel named, and the only thing
 *  the gray box lists. ⚠ The label is the server's own `path` falling back to
 *  the base name (`scopeChipLabel`), so a folder renamed in another window
 *  corrects itself on the next read instead of persisting here forever. */
function ScopeBar({ label }: { label: string }) {
  return (
    <span className="block w-full truncate rounded-md bg-bg-elevated px-2 py-1 text-caption text-text-secondary">
      {label}
    </span>
  );
}

/**
 * THE GRAY BOX — the whole of it is the button (his ruling), so there is no
 * inner control to miss and nothing about the bars is pressable on its own.
 *
 * ⚠ IT IS A FLAT FILL, NEVER A PRESSED-IN WELL. /home has no concave surface
 * (Samuel, 2026-08-22) and the sweep over these files enforces it
 * (`template-editor-surface.test.tsx › no concave surfaces`).
 */
export function AddKnowledgeWell({
  refs,
  templateName,
  onClick,
}: {
  refs: ReadonlyArray<TemplateKnowledgeRef>;
  /** ⚠ **THE ACCESSIBLE NAME SAYS WHICH ROW** — one of these sits on every card
   *  in the grid, and the authoring modal's own picker is already called "Add
   *  knowledge" (`knowledge-scope-picker.tsx`, whose docblock makes exactly this
   *  argument about its own label). Several controls with one name is ambiguous
   *  on a screen reader and unaddressable for every `getByRole`. */
  templateName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add knowledge to ${templateName}`}
      className="flex w-full cursor-pointer flex-col gap-1 rounded-lg bg-bg-inset p-2 text-left transition-colors hover:bg-bg-inset-hover"
    >
      {refs.map((ref) => (
        <ScopeBar key={refKey(ref)} label={scopeChipLabel(ref)} />
      ))}
      {/* ⚠ THE WORDS STAY UNDER THE BARS RATHER THAN BEING REPLACED BY THEM:
          the box is still the way to add the next one, and a box that stopped
          saying so once it held a row would be a control that disappears the
          moment it is used. */}
      <span className="text-caption text-text-muted">Add knowledge</span>
    </button>
  );
}

/**
 * THE POPUP — the kit's form recipe (`shared/ui/form-dialog.tsx`), which IS the
 * New-agent popup's own shell, holding the checkable tree.
 *
 * ⚠ THE DIALOG STAYS OPEN UNTIL THE WRITE SETTLES AND CLOSES ONLY ON SUCCESS —
 * this tree's idiom (INVARIANTS §5A). The patch is optimistic, so a dialog that
 * closed on the click would leave a failed save with nowhere to report.
 */
export function AgentKnowledgeDialog({
  template,
  workspaceId,
  onClose,
}: {
  /** The row being attached to. ⚠ Its `workspaceId` is where its BASES are read
   *  from — a personal template's knowledge lives in the same home workspace. */
  template: AgentTemplate;
  /** The home workspace the PERSONAL list was read from, so the patch lands on
   *  the entry that list is subscribed to. */
  workspaceId: string;
  onClose: () => void;
}) {
  // ⚠ §8's STALE-CACHE FALLBACK, SPELLED INLINE at the read: `knowledge` was
  // added to an already-persisted payload, so an entry written by a previous
  // bundle survives with no such key.
  const [refs, setRefs] = useState<ReadonlyArray<TemplateKnowledgeRef>>(
    template.knowledge ?? EMPTY_KNOWLEDGE
  );
  const [error, setError] = useState<string | null>(null);
  const writes = useAgentTemplateWrites(workspaceId, "home");
  // ⚠ THE PLAIN WORKSPACE KEY, not the channel-scoped one — the same entry the
  // authoring modal's picker mounts (`agent-editor.tsx`), so this popup usually
  // opens on a warm cache and never pulls the grant-bearing entry out from
  // under the Knowledge pane.
  const baseList = useKnowledgeBaseList(workspaceId);
  const bases = useMemo(
    () => (baseList.data?.bases ?? []).map((b) => ({ id: b.id, name: b.name })),
    [baseList.data]
  );

  const selectedKeys = useMemo(() => new Set(refs.map(refKey)), [refs]);

  /** ⚠ ADD-OR-REMOVE PLUS A PRUNE, in one call — `knowledge-scope-picker.tsx`'s
   *  rule, stated there and applied here. */
  const toggle: ScopeToggle = (ref, impliedKeys) => {
    const key = refKey(ref);
    if (selectedKeys.has(key)) {
      setRefs(refs.filter((s) => refKey(s) !== key));
      return;
    }
    const pruned = new Set(impliedKeys);
    setRefs([...refs.filter((s) => !pruned.has(refKey(s))), ref]);
  };

  const scopes = useMemo(() => refs.map(refToScope), [refs]);
  const unchanged = useMemo(
    () => sameScopes(scopes, (template.knowledge ?? EMPTY_KNOWLEDGE).map(refToScope)),
    [scopes, template.knowledge]
  );

  async function save() {
    // Nothing moved — a PATCH with a body that changes no column is a round trip
    // that can only fail, and Save is the operator saying "I'm done".
    if (unchanged) {
      onClose();
      return;
    }
    setError(null);
    try {
      await writes.update.mutateAsync({
        templateId: template.id,
        // ⚠ `knowledge` IS A REPLACE-SET: `[]` empties it, absent leaves it
        // alone. This dialog always sends the whole set, which is what the
        // operator was looking at.
        body: { knowledge: scopes },
        optimistic: {
          ...template,
          knowledge: [...refs],
          // ⚠ THE BASE-LEVEL SLICE, derived the way the server derives it — a
          // folder scope contributes nothing, because listing its base would
          // claim the whole base is attached.
          knowledgeBases: refs
            .filter((ref) => ref.scope === "base")
            .map((ref) => ({ id: ref.baseId, name: ref.baseName })),
        },
        // 🔒 The `X-Updated-At` precondition (F-747) — the row as the operator
        // opened it, so a save that lost a race is refused rather than silently
        // overwriting the other edit.
        expectedUpdatedAt: template.updatedAt,
      });
      onClose();
    } catch (err) {
      setError(agentTemplateErrorMessage(err, "Couldn't save the knowledge."));
    }
  }

  return (
    <FormDialog
      open
      onDiscard={onClose}
      title="Add knowledge"
      closeLabel="Close add knowledge"
      primary={{
        label: "Save",
        onClick: () => void save(),
        busy: writes.update.pending,
        hint: "Save",
      }}
    >
      {/* ⚠ **"Knowledge", NOT "Knowledge bases"** (Samuel, 2026-09-08) — the
          label names what may be attached, and bases are the narrower word. */}
      <FormSection label="Knowledge">
        {refs.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg bg-bg-inset p-2">
            {refs.map((ref) => (
              <ScopeBar key={refKey(ref)} label={scopeChipLabel(ref)} />
            ))}
          </div>
        )}
        {bases.length === 0 ? (
          // ⚠ A FACT ABOUT THE WORKSPACE, and only once the read has ANSWERED —
          // an emptiness stated against an unresolved list is a false sentence.
          <p className="text-caption text-text-muted">
            {baseList.data ? "No knowledge here yet." : "Loading knowledge…"}
          </p>
        ) : (
          <div
            role="tree"
            aria-label="Knowledge"
            className="flex max-h-[320px] flex-col overflow-y-auto"
          >
            {bases.map((base) => (
              <BaseNode
                key={base.id}
                base={base}
                workspaceId={workspaceId}
                selectedKeys={selectedKeys}
                onToggle={toggle}
              />
            ))}
          </div>
        )}
      </FormSection>
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </FormDialog>
  );
}
