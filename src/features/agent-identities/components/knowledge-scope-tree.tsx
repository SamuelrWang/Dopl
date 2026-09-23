"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, FileText, Folder, Library } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useKnowledgeTree } from "@/features/knowledge/client/hooks";
import type { IdentityKnowledgeRef } from "../client/types";
import { composeDisplayPath, scopeKey } from "../lib/knowledge-scopes";
import type { KnowledgeBaseOption } from "./knowledge-scope-picker";

/**
 * THE TREE INSIDE THE KNOWLEDGE PICKER — one node component per level, plus the
 * flat-arrays-to-hierarchy index the rows read.
 *
 * ⚠ **ITS OWN FILE, AND THE REASON IS §1's 500-LINE CAP** (`eslint.config.mjs ›
 * max-lines`, `error`, no exemption for this path). `knowledge-scope-picker.tsx`
 * with the tree inline measured 627 lines. The seam is the honest one rather
 * than an arbitrary cut: that file owns the CHIPS, the popover and the selection
 * set; this one owns WHAT A BASE LOOKS LIKE WHEN YOU OPEN IT. The arrow points
 * one way — this imports the picker's option type, and the picker imports
 * {@link BaseNode}.
 *
 * ⚠ The folder-means-its-subtree rule is stated once, on
 * `knowledge-scope-picker.tsx`'s docblock; the rows here render it (checked +
 * `implied`, never expanded into the set).
 */

// ─── Nodes ──────────────────────────────────────────────────────────────

interface TreeIndex {
  /** folderId → its own ancestor chain, root-first, INCLUDING itself. */
  chain: Map<string, string[]>;
  /** folderId → child folder ids, and `""` for the base root. */
  childFolders: Map<string, string[]>;
  /** folderId (or `""`) → entry ids directly in it. */
  childEntries: Map<string, string[]>;
  folderName: Map<string, string>;
  entryTitle: Map<string, string>;
  entryFolder: Map<string, string>;
}

const ROOT = "";

/** Checking a row: the scope it attaches, plus the keys that scope now IMPLIES
 *  and the picker must therefore prune. Stated once — four rows pass it on. */
export type ScopeToggle = (
  ref: IdentityKnowledgeRef,
  impliedKeys: ReadonlyArray<string>
) => void;

/** What every non-root node needs to draw itself and address its own scope. */
interface NodeContext {
  depth: number;
  base: KnowledgeBaseOption;
  index: TreeIndex;
  selectedKeys: ReadonlySet<string>;
  /** An ancestor row holds the attachment, so this row is checked-and-locked. */
  ancestorChecked: boolean;
  onToggle: ScopeToggle;
}

export function BaseNode({
  base,
  workspaceId,
  selectedKeys,
  onToggle,
}: {
  base: KnowledgeBaseOption;
  workspaceId: string;
  selectedKeys: ReadonlySet<string>;
  onToggle: ScopeToggle;
}) {
  const [open, setOpen] = useState(false);
  // ⚠ LAZY, AND THE NULL ID IS THE MECHANISM. `useKnowledgeTree` is a keyed
  // query that stays IDLE on a null id, so an unexpanded base costs no request
  // — the same drill-in discipline `ontology/components/knowledge-pick-menu.tsx`
  // already runs, expressed through the knowledge feature's own hook rather than
  // a hand-rolled fetch.
  const tree = useKnowledgeTree(open ? base.id : null, workspaceId);

  const index = useMemo<TreeIndex>(() => buildIndex(tree.data), [tree.data]);

  const baseChecked = selectedKeys.has(scopeKey({ baseId: base.id, scope: "base" }));
  const rootFolders = index.childFolders.get(ROOT) ?? [];
  const rootEntries = index.childEntries.get(ROOT) ?? [];

  return (
    <div>
      <TreeRow
        depth={0}
        icon={<Library size={12} aria-hidden="true" />}
        label={base.name}
        checked={baseChecked}
        implied={false}
        expandable
        expanded={open}
        onExpandToggle={() => setOpen((v) => !v)}
        onCheckToggle={() =>
          onToggle(
            {
              baseId: base.id,
              baseName: base.name,
              scope: "base",
              path: base.name,
            },
            // The picker prunes a base's own scopes off the selection itself (P7-04).
            []
          )
        }
      />
      {open &&
        (tree.status === "loading" ? (
          <p className="py-1.5 pr-2 pl-8 text-caption text-text-muted">Loading…</p>
        ) : tree.status === "error" ? (
          // A failed read is not an empty base (INVARIANTS §11, P7-06).
          <p role="alert" className="py-1.5 pr-2 pl-8 text-caption text-danger">
            {tree.error?.message || "Couldn't load this base."}{" "}
            <button type="button" className="underline" onClick={() => tree.refetch()}>
              Retry
            </button>
          </p>
        ) : rootFolders.length === 0 && rootEntries.length === 0 ? (
          <p className="py-1.5 pr-2 pl-8 text-caption text-text-muted">Empty</p>
        ) : (
          <>
            {rootFolders.map((folderId) => (
              <FolderNode
                key={folderId}
                folderId={folderId}
                depth={1}
                base={base}
                index={index}
                selectedKeys={selectedKeys}
                ancestorChecked={baseChecked}
                onToggle={onToggle}
              />
            ))}
            {rootEntries.map((entryId) => (
              <EntryRow
                key={entryId}
                entryId={entryId}
                depth={1}
                base={base}
                index={index}
                selectedKeys={selectedKeys}
                ancestorChecked={baseChecked}
                onToggle={onToggle}
              />
            ))}
          </>
        ))}
    </div>
  );
}

function FolderNode({
  folderId,
  depth,
  base,
  index,
  selectedKeys,
  ancestorChecked,
  onToggle,
}: NodeContext & { folderId: string }) {
  const [open, setOpen] = useState(false);
  const checked = selectedKeys.has(scopeKey({ baseId: base.id, scope: "folder", folderId }));
  const covered = ancestorChecked || checked;
  const children = index.childFolders.get(folderId) ?? [];
  const entries = index.childEntries.get(folderId) ?? [];
  const segments = index.chain.get(folderId) ?? [];

  return (
    <div>
      <TreeRow
        depth={depth}
        icon={<Folder size={12} aria-hidden="true" />}
        label={index.folderName.get(folderId) ?? folderId}
        checked={covered}
        // ⚠ IMPLIED = checked AND not togglable. The row says "this IS attached"
        // and refuses to be the place you detach it, because the row that owns
        // the attachment is the ancestor above it.
        implied={ancestorChecked}
        expandable={children.length > 0 || entries.length > 0}
        expanded={open}
        onExpandToggle={() => setOpen((v) => !v)}
        onCheckToggle={() =>
          onToggle(
            {
              baseId: base.id,
              baseName: base.name,
              scope: "folder",
              folderId,
              folderName: index.folderName.get(folderId) ?? "",
              path: composeDisplayPath(
                base.name,
                segments.map((id) => index.folderName.get(id) ?? "")
              ),
              toolPath: segments
                .map((id) => index.folderName.get(id) ?? "")
                .join("/"),
            },
            descendantKeys(base.id, folderId, index)
          )
        }
      />
      {open && (
        <>
          {children.map((childId) => (
            <FolderNode
              key={childId}
              folderId={childId}
              depth={depth + 1}
              base={base}
              index={index}
              selectedKeys={selectedKeys}
              ancestorChecked={covered}
              onToggle={onToggle}
            />
          ))}
          {entries.map((entryId) => (
            <EntryRow
              key={entryId}
              entryId={entryId}
              depth={depth + 1}
              base={base}
              index={index}
              selectedKeys={selectedKeys}
              ancestorChecked={covered}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </div>
  );
}

function EntryRow({
  entryId,
  depth,
  base,
  index,
  selectedKeys,
  ancestorChecked,
  onToggle,
}: NodeContext & { entryId: string }) {
  const title = index.entryTitle.get(entryId) ?? entryId;
  const parent = index.entryFolder.get(entryId);
  const segments = [
    ...(parent ? (index.chain.get(parent) ?? []) : []).map(
      (id) => index.folderName.get(id) ?? ""
    ),
    title,
  ];
  return (
    <TreeRow
      depth={depth}
      icon={<FileText size={12} aria-hidden="true" />}
      label={title}
      checked={ancestorChecked || selectedKeys.has(scopeKey({ baseId: base.id, scope: "entry", entryId }))}
      implied={ancestorChecked}
      expandable={false}
      expanded={false}
      onExpandToggle={() => {}}
      onCheckToggle={() =>
        onToggle(
          {
            baseId: base.id,
            baseName: base.name,
            scope: "entry",
            entryId,
            entryTitle: title,
            path: composeDisplayPath(base.name, segments),
            toolPath: segments.join("/"),
          },
          []
        )
      }
    />
  );
}

/**
 * ONE ROW. ⚠ `role="treeitem"` ON THE ROW, not on a nested button: the tree owns
 * arrow navigation and the row owns Space/Enter, so the focusable thing and the
 * checkable thing must be one element. The chevron is a separate control for the
 * MOUSE and stops propagation; the keyboard reaches expansion through
 * ArrowRight/ArrowLeft on the row itself.
 */
function TreeRow({
  depth,
  icon,
  label,
  checked,
  implied,
  expandable,
  expanded,
  onExpandToggle,
  onCheckToggle,
}: {
  depth: number;
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  implied: boolean;
  expandable: boolean;
  expanded: boolean;
  onExpandToggle: () => void;
  onCheckToggle: () => void;
}) {
  return (
    <div
      role="treeitem"
      tabIndex={0}
      // ⚠ AN EXPLICIT NAME, because the row CONTAINS a labelled button. Name
      // computation from contents would fold the chevron's "Expand Deploys" into
      // the row's own name and produce "Expand Deploys Deploys" — a name no
      // operator hears as the folder and no `getByRole` can address.
      aria-label={label}
      aria-selected={checked}
      aria-disabled={implied || undefined}
      aria-expanded={expandable ? expanded : undefined}
      onClick={() => {
        if (!implied) onCheckToggle();
      }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (!implied) onCheckToggle();
          return;
        }
        if (!expandable) return;
        if (event.key === "ArrowRight" && !expanded) {
          event.preventDefault();
          onExpandToggle();
        } else if (event.key === "ArrowLeft" && expanded) {
          event.preventDefault();
          onExpandToggle();
        }
      }}
      style={{ paddingLeft: 6 + depth * 14 }}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 text-small transition-colors outline-none",
        "focus-visible:bg-surface-raised-2",
        implied
          ? "cursor-default text-text-muted"
          : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary"
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden={!expandable}
        disabled={!expandable}
        onClick={(event) => {
          event.stopPropagation();
          onExpandToggle();
        }}
        aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        className="flex w-3 shrink-0 items-center text-text-muted disabled:opacity-0"
      >
        <ChevronRight
          size={11}
          className={cn("shrink-0 transition-transform", expanded && "rotate-90")}
        />
      </button>
      <span className="shrink-0 text-text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {/* ⚠ A GLYPH, NOT AN `<input type="checkbox">`. The row already carries the
          checked state for assistive tech through `aria-selected`, and a real
          input inside a `treeitem` would be a second focus stop on every row. */}
      <span
        aria-hidden="true"
        className={cn("shrink-0", checked ? "text-text-primary" : "opacity-0")}
      >
        <Check size={12} />
      </span>
    </div>
  );
}

// ─── Index ──────────────────────────────────────────────────────────────

/** ⚠ Built from the FLAT arrays the tree read returns (`KnowledgeTreeSnapshot`
 *  is explicit that hierarchy is the UI's to assemble), and cycle-guarded on the
 *  `parentId` walk for the same reason the server's own path derivation is: a
 *  loop would hang a render rather than draw a wrong name. */
function buildIndex(
  data: {
    folders: Array<{ id: string; parentId: string | null; name: string; position: number }>;
    entries: Array<{ id: string; folderId: string | null; title: string; position: number }>;
  } | null
): TreeIndex {
  const index: TreeIndex = {
    chain: new Map(),
    childFolders: new Map(),
    childEntries: new Map(),
    folderName: new Map(),
    entryTitle: new Map(),
    entryFolder: new Map(),
  };
  if (!data) return index;
  const parentOf = new Map<string, string | null>();
  for (const folder of [...data.folders].sort((a, b) => a.position - b.position)) {
    index.folderName.set(folder.id, folder.name);
    parentOf.set(folder.id, folder.parentId);
    const bucket = folder.parentId ?? ROOT;
    index.childFolders.set(bucket, [
      ...(index.childFolders.get(bucket) ?? []),
      folder.id,
    ]);
  }
  for (const entry of [...data.entries].sort((a, b) => a.position - b.position)) {
    index.entryTitle.set(entry.id, entry.title);
    if (entry.folderId) index.entryFolder.set(entry.id, entry.folderId);
    const bucket = entry.folderId ?? ROOT;
    index.childEntries.set(bucket, [
      ...(index.childEntries.get(bucket) ?? []),
      entry.id,
    ]);
  }
  for (const folderId of index.folderName.keys()) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | null = folderId;
    while (current && !seen.has(current)) {
      seen.add(current);
      chain.unshift(current);
      current = parentOf.get(current) ?? null;
    }
    index.chain.set(folderId, chain);
  }
  return index;
}

/** Every scope key a folder now COVERS — its descendant folders and every entry
 *  under any of them. ⚠ Used for the PRUNE, never to write rows. */
function descendantKeys(baseId: string, folderId: string, index: TreeIndex): string[] {
  const keys: string[] = [];
  const stack = [folderId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    if (current !== folderId) keys.push(scopeKey({ baseId, scope: "folder", folderId: current }));
    for (const entryId of index.childEntries.get(current) ?? []) {
      keys.push(scopeKey({ baseId, scope: "entry", entryId }));
    }
    stack.push(...(index.childFolders.get(current) ?? []));
  }
  return keys;
}

