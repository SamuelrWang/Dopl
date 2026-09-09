"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { Popover } from "@/shared/ui/popover-menu";
import {
  OPEN_SCALE_ICON,
  OpenScaleButton,
} from "@/shared/ui/open-scale-button";
import type { TemplateKnowledgeRef } from "../client/types";
import { refKey, scopeChipLabel } from "../lib/knowledge-scopes";
import { RemovableChip } from "./template-editor-rows";
import { BaseNode, type ScopeToggle } from "./knowledge-scope-tree";

/**
 * THE KNOWLEDGE PICKER — chips for what is attached, and one **Add** button
 * opening a CHECKABLE TREE (Samuel, 2026-09-08: *"right now, you can only
 * select entire bases, but I want to be able to specific folders or
 * entries/files. also i dont think a dropdown is the best way to do it"*).
 *
 * ⚠ **IT REPLACES `ChipMultiSelect` FOR KNOWLEDGE AND LEAVES IT TO THE TEAMS.**
 * That component's docblock argues teams and KBs share one REPLACE-SET shape and
 * therefore one control; **that argument ends here.** A team set is FLAT — a
 * list of names with no inside — and a knowledge set is a forest three levels
 * deep. A flat menu cannot express "this folder", which is the whole request,
 * and Samuel's own sentence rules out the dropdown by name.
 *
 * ⚠ **`TreeRows` IS NOT REUSED** (`knowledge/components/knowledge-v2/list/
 * tree-rows.tsx`): its eight props are the base EDITOR's authoring callbacks and
 * none is about selection, so reusing it means giving each a "not here" branch
 * inside a picker. Shared instead: the read (`useKnowledgeTree`) and the
 * parent-indexing idiom.
 *
 * ⚠ **A FOLDER MEANS ITS SUBTREE, INCLUDING LATER ADDITIONS** (the Desktop
 * Agent's assumption, unopposed). So checking a folder does not check its
 * children into the set — it makes them IMPLIED: they render checked and
 * disabled, and the set holds ONE row. An expansion here would be a snapshot,
 * and an entry filed tomorrow would silently not be attached.
 *
 * ⚠ **SCOPED TO THE EDITOR'S CONTAINER**, exactly as the base list already was:
 * `workspaceId` is the mount's, every tree read carries it, and this component
 * resolves no visibility of its own — a second opinion about which knowledge a
 * member may attach is the two-readers-one-fact defect with an ACCESS GRANT as
 * the thing that drifts. The server refuses an unreadable scope with a 404.
 *
 * ⚠ `Popover` in COORDINATE mode, like the control it replaces — the editor is a
 * scrolling, overflow-clipping modal body, where a trigger-anchored panel
 * renders as a clipped sliver.
 */

export interface KnowledgeBaseOption {
  id: string;
  name: string;
}

export function KnowledgeScopePicker({
  workspaceId,
  bases,
  selected,
  onChange,
  emptyLine,
}: {
  workspaceId: string;
  /** ⚠ WHAT THE CALLER WAS GIVEN. The page supplies these from its own base
   *  read; this control never fetches a list of its own. */
  bases: ReadonlyArray<KnowledgeBaseOption>;
  selected: ReadonlyArray<TemplateKnowledgeRef>;
  onChange: (next: TemplateKnowledgeRef[]) => void;
  /** ⚠ A FACT about the container, not a loading state — the caller passes `[]`
   *  only once its own read has answered. */
  emptyLine: string;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);

  const selectedKeys = useMemo(
    () => new Set(selected.map(refKey)),
    [selected]
  );

  /**
   * ⚠ ADD-OR-REMOVE PLUS A PRUNE, IN ONE CALL. Checking a base or a folder
   * removes every scope it now IMPLIES, because two rows where one suffices is
   * a set that renders the same attachment twice in the role block — and the
   * redundant one survives when the operator later unchecks the ancestor,
   * silently keeping an attachment they thought they had removed.
   */
  const toggle: ScopeToggle = (ref, impliedKeys) => {
    const key = refKey(ref);
    if (selectedKeys.has(key)) {
      onChange(selected.filter((s) => refKey(s) !== key));
      return;
    }
    const pruned = new Set(impliedKeys);
    onChange([...selected.filter((s) => !pruned.has(refKey(s))), ref]);
  };

  /**
   * ARROWS AND SPACE, over whatever is currently rendered. ⚠ THE ROW SET IS READ
   * FROM THE DOM rather than mirrored in state: the tree is assembled by three
   * components and lazily, so a state mirror would be a second answer to "what
   * is on screen" that goes stale the moment a base finishes loading.
   * Space/Enter are handled by the row itself, which is where the scope is.
   */
  function onTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const root = treeRef.current;
    if (!root) return;
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>('[role="treeitem"]')
    );
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(at + 1, rows.length - 1)
        : Math.max(at - 1, 0);
    rows[at === -1 ? 0 : next]?.focus();
    event.preventDefault();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((ref) => {
        const label = scopeChipLabel(ref);
        return (
          <RemovableChip
            key={refKey(ref)}
            label={label}
            detachLabel={`Detach ${label}`}
            onDetach={() =>
              onChange(selected.filter((s) => refKey(s) !== refKey(ref)))
            }
          />
        );
      })}
      <OpenScaleButton
        onClick={(e) => {
          if (anchor) {
            setAnchor(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 4 });
        }}
        // ⚠ **THE VISIBLE WORD IS "Add" AND THE ACCESSIBLE NAME SAYS WHAT OF.**
        // The editor's own Add-field dialog puts a second "Add" on screen
        // (`template-editor-rows.tsx › AddFieldDialog`, whose docblock makes
        // exactly this argument about its own label), and two controls with one
        // accessible name is ambiguous for an operator on a screen reader and
        // unaddressable for every `getByRole`. The label is not repeated
        // visually — the section heading above already says "Knowledge".
        aria-label="Add knowledge"
        aria-haspopup="tree"
        aria-expanded={anchor !== null}
        disabled={bases.length === 0}
        className="disabled:opacity-40"
      >
        <Plus size={OPEN_SCALE_ICON} aria-hidden="true" />
        Add
      </OpenScaleButton>
      {bases.length === 0 && (
        <span className="text-caption text-text-muted">{emptyLine}</span>
      )}
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={() => setAnchor(null)}
        className="max-h-[320px] min-w-[280px] overflow-y-auto"
      >
        <div
          ref={treeRef}
          role="tree"
          aria-label="Knowledge"
          onKeyDown={onTreeKeyDown}
          className="flex flex-col"
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
      </Popover>
    </div>
  );
}
