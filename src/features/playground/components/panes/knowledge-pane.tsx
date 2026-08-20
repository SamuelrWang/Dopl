"use client";

import { Fragment, useState } from "react";
import {
  Bold,
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Settings,
  Trash2,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { EmptyState } from "@/shared/ui/empty-state";
import { SearchField } from "@/shared/ui/search-field";
import { SkeletonText } from "@/shared/ui/skeleton";
import {
  useLiveKnowledge,
  type KnowledgeViewFile,
  type KnowledgeViewFolder,
} from "./knowledge-pane-live";
import styles from "./knowledge-pane.module.css";

/** App-wide icon-button recipe (knowledge-v2 detail-panel.tsx). */
const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

/* ── Static demo corpus, themed on the real seed (Dopl Guide KB) ────────── */

const DEMO_FOLDERS: KnowledgeViewFolder[] = [
  {
    id: "getting-started",
    name: "Getting started",
    files: [
      { id: "start-here", title: "Start here — what Dopl is" },
      { id: "welcome", title: "Welcome to the Dopl Playground" },
      { id: "session-ritual", title: "The session ritual" },
    ],
    children: [],
  },
  {
    id: "working-with-agents",
    name: "Working with agents",
    files: [
      { id: "mcp-tools", title: "The MCP tools" },
      { id: "ontology", title: "Building the ontology" },
    ],
    children: [],
  },
];
const DEMO_ROOT_FILES: KnowledgeViewFile[] = [
  { id: "knowledge-vs-skills", title: "Knowledge vs Skills" },
];

const DEMO_BASE_NAME = "Dopl Guide";
const DEMO_DOC = {
  folderName: "Getting started",
  title: "Welcome to the Dopl Playground",
  description:
    "A static tour of the knowledge surface — what a base, folder and file look like once a workspace is seeded.",
};

const TOOLBAR_GROUPS = [
  [
    { icon: Heading1, label: "Heading 1" },
    { icon: Heading2, label: "Heading 2" },
  ],
  [
    { icon: Bold, label: "Bold" },
    { icon: Italic, label: "Italic" },
  ],
  [
    { icon: List, label: "Bullet list" },
    { icon: ListOrdered, label: "Numbered list" },
  ],
] as const;

/** Tree indent recipe from knowledge-v2/list/tree-rows.tsx. */
const pad = (depth: number) => ({ paddingLeft: 28 + depth * 15 });

/**
 * Playground KNOWLEDGE page: the knowledge-v2 two-pane layout (list/tree pane
 * + document pane). Renders the static demo corpus until a playground session
 * exists AND its workspace's tree has answered; from then on the rail and doc
 * pane show the REAL workspace's knowledge via `useLiveKnowledge` (GET polls
 * with the guest bearer). Toolbar/search/add-row chrome stays cosmetic.
 */
export function KnowledgePane() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const live = useLiveKnowledge(selectedId);

  const folders = live.active ? live.folders : DEMO_FOLDERS;
  const rootFiles = live.active ? live.rootFiles : DEMO_ROOT_FILES;
  const baseName = live.active ? live.baseName : DEMO_BASE_NAME;
  // Demo doc pane is fixed on the "welcome" doc, so demo selection is
  // highlight-only; live selection falls back to the first real file.
  const activeFileId = live.active
    ? live.selectedFileId
    : (selectedId ?? "welcome");
  const doc = live.active
    ? live.doc
    : { ...DEMO_DOC, excerpt: DEMO_DOC.description };

  const toggleFolder = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={cn("page-float", styles.shell)}>
      {/* ── List pane: crumb + the opened base's tree ── */}
      <div className={styles.listPane}>
        <nav className={styles.paneCrumbs} aria-label="Knowledge base breadcrumb">
          <button type="button" className={styles.crumbBtn}>
            Knowledge
          </button>
          <ChevronRight size={12} className={styles.crumbSep} />
          <span className={styles.crumbCurrent}>{baseName}</span>
        </nav>

        <div className={styles.listBody}>
          <div className={styles.tree}>
            {folders.map((folder) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                depth={0}
                collapsed={collapsed}
                onToggle={toggleFolder}
                activeFileId={activeFileId}
                onSelect={setSelectedId}
              />
            ))}
            {rootFiles.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                depth={0}
                isSelected={file.id === activeFileId}
                onSelect={() => setSelectedId(file.id)}
              />
            ))}

            <div className={styles.addRow}>
              <button type="button" className={styles.addBtn}>
                <FilePlus size={13} /> New file
              </button>
              <button type="button" className={styles.addBtn}>
                <FolderPlus size={13} /> New folder
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail pane: header band, toolbar band, document body ── */}
      <div className={styles.detailPane}>
        <div className={styles.detailTop}>
          <span className={styles.detailTopTitle}>
            <nav className={styles.crumbs} aria-label="Breadcrumb">
              <button type="button" className={styles.crumbBtn}>
                {baseName}
              </button>
              {doc?.folderName ? (
                <>
                  <ChevronRight size={12} className={styles.crumbSep} />
                  <button type="button" className={styles.crumbBtn}>
                    {doc.folderName}
                  </button>
                </>
              ) : null}
              <ChevronRight size={12} className={styles.crumbSep} />
              <span className={styles.crumbCurrent}>{doc?.title ?? baseName}</span>
            </nav>
          </span>
          <div className={styles.headSpacer} />
          <div className="hidden w-52 lg:block">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search this base"
              size="sm"
            />
          </div>
          <button className={ICON_BTN} type="button" aria-label="Download knowledge base">
            <Download size={16} />
          </button>
          <button className={ICON_BTN} type="button" aria-label="Knowledge base settings">
            <Settings size={16} />
          </button>
          <span className={styles.divider} />
          <button
            className={cn(ICON_BTN, "hover:text-danger")}
            type="button"
            aria-label="Delete knowledge base"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div className={styles.detailToolbarBand}>
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {TOOLBAR_GROUPS.map((group, gi) => (
              <Fragment key={gi}>
                {gi > 0 ? (
                  <span className="mx-1 h-4 w-px shrink-0 bg-border-strong" />
                ) : null}
                {group.map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    type="button"
                    title={label}
                    aria-label={label}
                    className="flex h-7 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary"
                  >
                    <Icon size={13} />
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>

        <div className={styles.detailBody}>
          {live.active && !doc ? (
            <EmptyState
              icon={FileText}
              title="No files in this base yet"
              description="Point your agent at this workspace and file something in — it shows up here."
            />
          ) : doc ? (
            /* Doc header card (doc-pane.tsx): overview strip + title/description. */
            <article className="flex flex-col">
              <div className="mx-auto mt-4 mb-1 w-[calc(100%-3rem)] max-w-3xl overflow-hidden rounded-[14px] border border-border-strong">
                <div className="flex items-center gap-3 bg-card-surface-subtle px-4 py-1.5">
                  <span className="flex-1 text-label font-semibold uppercase tracking-wide text-text-secondary">
                    Overview
                  </span>
                  <span className="font-mono text-micro text-text-muted">
                    {live.active && live.doc?.updatedAt
                      ? formatRelativeTime(live.doc.updatedAt)
                      : "Saved"}
                  </span>
                </div>
                <div className="border-t border-border-subtle bg-bg-inset px-4 pt-2.5 pb-2">
                  <p className="text-display font-semibold leading-snug tracking-tight text-text-primary">
                    {doc.title}
                  </p>
                  {doc.excerpt ? (
                    <p className="mt-1 text-body leading-relaxed text-text-secondary">
                      {doc.excerpt}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className={cn("mx-auto w-full max-w-3xl px-6 pt-6", styles.docBody)}>
                {live.active ? (
                  live.doc?.paragraphs ? (
                    live.doc.paragraphs.map((paragraph, i) => (
                      <p key={i} className="whitespace-pre-wrap">
                        {paragraph}
                      </p>
                    ))
                  ) : (
                    <SkeletonText lines={5} />
                  )
                ) : (
                  <DemoDocBody />
                )}
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The demo doc's fixed body — the pre-session tour copy, verbatim. */
function DemoDocBody() {
  return (
    <>
      <p>
        This pane is a faithful, static mirror of Dopl&rsquo;s knowledge
        surface. In the real app every workspace seeds with a Dopl Guide
        base like this one — a shared corpus that members and their
        agents read from and file into as they work.
      </p>
      <p>
        The left rail is the base&rsquo;s tree: folders group related
        files, and selecting a file opens it here with the same
        document typography agents see over MCP. Nothing on this page
        fetches — click around the tree to get a feel for the layout.
      </p>
      <p>A few things the live page does that this demo only hints at:</p>
      <ul>
        <li>Inline rename, move and delete on every folder and file.</li>
        <li>Rich-text editing with conflict-safe autosave and presence.</li>
        <li>Full-text search scoped to the open base.</li>
        <li>Agent-facing descriptions, surfaced in MCP tree listings.</li>
      </ul>
      <p>
        When you&rsquo;re ready, create a workspace and the real thing
        seeds itself — guide included.
      </p>
    </>
  );
}

/** Folder row + its files + nested child folders (live trees can nest). */
function FolderNode({
  folder,
  depth,
  collapsed,
  onToggle,
  activeFileId,
  onSelect,
}: {
  folder: KnowledgeViewFolder;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  activeFileId: string | null;
  onSelect: (id: string) => void;
}) {
  const isOpen = !collapsed.has(folder.id);
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={styles.treeRow}
        style={pad(depth)}
        onClick={() => onToggle(folder.id)}
      >
        <ChevronRight
          size={13}
          className={cn(styles.treeChevron, isOpen && styles.treeChevronOpen)}
        />
        {isOpen ? (
          <FolderOpen size={14} className="leaf" />
        ) : (
          <Folder size={14} className="leaf" />
        )}
        <span className={styles.treeLabel}>{folder.name}</span>
      </div>
      {isOpen
        ? folder.files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              depth={depth + 1}
              isSelected={file.id === activeFileId}
              onSelect={() => onSelect(file.id)}
            />
          ))
        : null}
      {isOpen
        ? folder.children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              activeFileId={activeFileId}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

/** File row — the entry-row shape from tree-rows.tsx, selection only. */
function FileRow({
  file,
  depth,
  isSelected,
  onSelect,
}: {
  file: KnowledgeViewFile;
  depth: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(styles.treeRow, isSelected && styles.treeRowActive)}
      style={pad(depth)}
      onClick={onSelect}
    >
      <span className={styles.treeChevron} />
      <FileText size={14} className="leaf" />
      <span className={styles.treeLabel}>{file.title}</span>
    </div>
  );
}
