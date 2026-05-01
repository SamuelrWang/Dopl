"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Link } from "@tiptap/extension-link";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { marked } from "marked";
import TurndownService from "turndown";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface Props {
  /** Initial content as markdown — converted to HTML once for Tiptap. */
  initialMarkdown: string;
  /** Reset key — changing this forces the editor to reload content. */
  resetKey?: string;
  /** Called with markdown whenever the user edits. Parent debounces. */
  onChange?: (markdown: string) => void;
  /** Read-only mode — disables editing entirely (e.g. trash view). */
  readOnly?: boolean;
}

/**
 * Inline rich-text editor for knowledge-base entries. The doc is always
 * editable — no view/edit mode switch. Keyboard shortcuts (⌘B, ⌘I,
 * ⌘U, ⌘Z, etc.) work through Tiptap's StarterKit. A persistent toolbar
 * sits above the editor for explicit formatting actions and table
 * insertion.
 *
 * Initial content is markdown for convenience (the data layer stores
 * markdown), converted to HTML once via `marked` and fed to Tiptap.
 * On every edit, Tiptap's HTML is converted back to markdown via
 * `turndown` and bubbled up via `onChange` — the parent owns the
 * autosave debounce.
 */
export function DocEditor({ initialMarkdown, resetKey, onChange, readOnly }: Props) {
  const initialHtml = useMemo(() => {
    const result = marked.parse(initialMarkdown, { async: false, gfm: true });
    return typeof result === "string" ? result : "";
  }, [initialMarkdown]);

  // Reuse one Turndown instance — lazy-init via useState so the
  // constructor runs once on mount (not every render).
  const [turndown] = useState<TurndownService>(() => {
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
    });
    td.addRule("table", makeTableRule());
    return td;
  });

  // Latest onChange in a ref — Tiptap's `onUpdate` closes over the
  // first one passed in, which would miss closure updates from the
  // parent.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We use our own Link extension below for click-control.
        link: false,
        // We disable underline from starter kit so the dedicated extension drives it.
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "text-violet-300 hover:underline",
        },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialHtml,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: PROSE_CLASSES,
      },
    },
    onUpdate({ editor }) {
      const md = turndown.turndown(editor.getHTML());
      onChangeRef.current?.(md);
    },
  });

  // When the parent passes a new resetKey (i.e. a different entry was
  // selected), reload the content. Pass `emitUpdate: false` so the
  // load doesn't trigger our `onUpdate` and bubble a spurious save.
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(initialHtml, { emitUpdate: false });
  }, [editor, resetKey, initialHtml]);

  // Sync editable mode if readOnly toggles.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) return null;

  return (
    <div className="flex flex-col">
      <Toolbar editor={editor} />
      <div className="max-w-3xl px-6 pb-10">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** Status indicator for autosave state — used in the page header. */
export function SaveStatusIndicator({ state }: { state: SaveStatus }) {
  const label = (() => {
    switch (state) {
      case "idle":
        return "";
      case "dirty":
        return "Unsaved";
      case "saving":
        return "Saving…";
      case "saved":
        return "Saved";
      case "error":
        return "Save failed";
    }
  })();
  if (!label) return null;
  return (
    <span
      className={
        state === "error"
          ? "text-xs text-red-400"
          : "text-xs text-text-secondary/60"
      }
    >
      {label}
    </span>
  );
}

/**
 * Tiny custom turndown rule for tables — turndown's default leaves
 * tables as raw HTML; we want GFM pipe tables back. Inline rather
 * than pulling in `turndown-plugin-gfm` for one feature.
 */
function makeTableRule(): TurndownService.Rule {
  return {
    filter: "table",
    replacement(_content, node) {
      const table = node as HTMLTableElement;
      const rows: string[][] = [];
      for (const row of Array.from(table.rows)) {
        rows.push(
          Array.from(row.cells).map((c) =>
            c.textContent?.trim().replace(/\|/g, "\\|") ?? ""
          )
        );
      }
      if (rows.length === 0) return "";
      const widths = rows[0].map(() => 3);
      const fmt = (cells: string[]) =>
        "| " +
        cells.map((c, i) => c.padEnd(widths[i] ?? 3, " ")).join(" | ") +
        " |";
      const sep = "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";
      const out = [fmt(rows[0]), sep, ...rows.slice(1).map(fmt)];
      return "\n\n" + out.join("\n") + "\n\n";
    },
  };
}

// ── Toolbar ─────────────────────────────────────────────────────────

interface ToolbarProps {
  editor: Editor;
}

function Toolbar({ editor }: ToolbarProps) {
  const groups: ReadonlyArray<ReadonlyArray<ToolbarItem>> = [
    [
      {
        icon: Heading1,
        label: "Heading 1",
        active: editor.isActive("heading", { level: 1 }),
        run: () =>
          editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        icon: Heading2,
        label: "Heading 2",
        active: editor.isActive("heading", { level: 2 }),
        run: () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        icon: Heading3,
        label: "Heading 3",
        active: editor.isActive("heading", { level: 3 }),
        run: () =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        icon: Bold,
        label: "Bold (⌘B)",
        active: editor.isActive("bold"),
        run: () => editor.chain().focus().toggleBold().run(),
      },
      {
        icon: Italic,
        label: "Italic (⌘I)",
        active: editor.isActive("italic"),
        run: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        icon: UnderlineIcon,
        label: "Underline (⌘U)",
        active: editor.isActive("underline"),
        run: () => editor.chain().focus().toggleUnderline().run(),
      },
      {
        icon: Strikethrough,
        label: "Strikethrough",
        active: editor.isActive("strike"),
        run: () => editor.chain().focus().toggleStrike().run(),
      },
    ],
    [
      {
        icon: List,
        label: "Bullet list",
        active: editor.isActive("bulletList"),
        run: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        icon: ListOrdered,
        label: "Numbered list",
        active: editor.isActive("orderedList"),
        run: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        icon: Quote,
        label: "Quote",
        active: editor.isActive("blockquote"),
        run: () => editor.chain().focus().toggleBlockquote().run(),
      },
    ],
    [
      {
        icon: TableIcon,
        label: "Insert table",
        active: editor.isActive("table"),
        run: () =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
            .run(),
      },
      {
        icon: LinkIcon,
        label: "Link",
        active: editor.isActive("link"),
        run: () => {
          const previous = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", previous ?? "https://");
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
          }
          editor
            .chain()
            .focus()
            .extendMarkRange("link")
            .setLink({ href: url })
            .run();
        },
      },
    ],
    [
      {
        icon: Undo2,
        label: "Undo (⌘Z)",
        run: () => editor.chain().focus().undo().run(),
        disabled: !editor.can().undo(),
      },
      {
        icon: Redo2,
        label: "Redo (⇧⌘Z)",
        run: () => editor.chain().focus().redo().run(),
        disabled: !editor.can().redo(),
      },
    ],
  ];

  return (
    <div
      className="sticky top-0 z-[3] flex items-center gap-1 px-6 py-1.5 border-b border-white/[0.06] mb-3"
      style={{ backgroundColor: "oklch(0.11 0 0)" }}
    >
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && (
            <span className="mx-1 h-4 w-px bg-white/[0.08]" aria-hidden />
          )}
          {group.map((item) => (
            <ToolbarButton key={item.label} {...item} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface ToolbarItem {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
}

function ToolbarButton({ icon: Icon, label, active, disabled, run }: ToolbarItem) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        run();
      }}
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      className={cn(
        "w-7 h-7 rounded flex items-center justify-center transition-colors",
        disabled
          ? "text-text-secondary/30 cursor-not-allowed"
          : active
            ? "bg-white/[0.08] text-text-primary cursor-pointer"
            : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary cursor-pointer",
      )}
    >
      <Icon size={13} />
    </button>
  );
}

// ── Prose styling — must match DocMarkdown exactly so the editor and
//    the read-only renderer look identical at every step. ─────────────

const PROSE_CLASSES = [
  // Outer container
  "prose max-w-none text-text-primary/90 focus:outline-none",
  // Paragraphs
  "prose-p:my-3 prose-p:leading-[1.65] prose-p:text-[14px]",
  // Headings
  "prose-headings:text-text-primary prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-h1:text-[18px] prose-h1:mt-7 prose-h1:mb-2",
  "prose-h2:text-[15px] prose-h2:mt-6 prose-h2:mb-1.5",
  "prose-h3:text-[14px] prose-h3:mt-5 prose-h3:mb-1",
  "prose-h4:text-[13px] prose-h4:mt-4 prose-h4:mb-1",
  // Bold + italic
  "prose-strong:text-text-primary prose-strong:font-semibold",
  "prose-em:text-text-primary/85 prose-em:italic",
  // Blockquote
  "prose-blockquote:not-italic prose-blockquote:font-normal",
  "prose-blockquote:text-text-primary/85 prose-blockquote:border-l-2 prose-blockquote:border-l-violet-400/40",
  "prose-blockquote:pl-3.5 prose-blockquote:my-3 prose-blockquote:py-0.5",
  "[&_blockquote_p]:my-1 [&_blockquote_p]:text-[14px] [&_blockquote_p:before]:hidden [&_blockquote_p:after]:hidden",
  // Lists
  "prose-ul:my-2.5 prose-ol:my-2.5 prose-li:my-0.5 prose-li:text-[14px] prose-li:leading-[1.65]",
  "prose-ul:pl-5 prose-ol:pl-5",
  "[&_li::marker]:text-text-secondary/50",
  // Tiptap wraps each list-item's content in a <p>, which then inherits
  // prose-p's my-3. Strip those vertical margins so list items are tight.
  "[&_li>p]:my-0 [&_li>p]:leading-[1.65]",
  // Inline code
  "prose-code:text-[12.5px] prose-code:bg-white/[0.06] prose-code:border prose-code:border-white/[0.06]",
  "prose-code:px-1 prose-code:py-px prose-code:rounded prose-code:font-mono",
  "prose-code:before:content-none prose-code:after:content-none",
  // Code blocks
  "prose-pre:bg-white/[0.04] prose-pre:border prose-pre:border-white/[0.06]",
  "prose-pre:rounded-lg prose-pre:my-3 prose-pre:text-[12.5px]",
  // Links
  "prose-a:text-violet-300 prose-a:no-underline hover:prose-a:underline",
  // HR
  "prose-hr:border-white/[0.08] prose-hr:my-6",
  // Tables — clean docs look
  "[&_table]:my-3 [&_table]:border-collapse [&_table]:w-full [&_table]:text-[13px]",
  "[&_thead]:bg-white/[0.03]",
  "[&_th]:text-left [&_th]:font-semibold [&_th]:text-text-primary [&_th]:px-3 [&_th]:py-1.5",
  "[&_th]:border [&_th]:border-white/[0.08]",
  "[&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-white/[0.06] [&_td]:text-text-primary/90",
  "[&_tbody_tr:hover]:bg-white/[0.02]",
  // Selected node ring (subtle)
  "[&_.ProseMirror-selectednode]:outline [&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-violet-400/30",
  // Editing affordance: faint cursor color
  "[&_.ProseMirror]:caret-text-primary",
  // Tiptap wraps content in a `.ProseMirror` div, which means the
  // prose `:first-child` selector targets the wrapper, not the actual
  // first paragraph/heading. Manually strip the top margin so the
  // first content block sits flush against the toolbar instead of
  // pushing down by one prose-p margin.
  "[&_.ProseMirror>*:first-child]:mt-0",
  "[&_.ProseMirror>*:last-child]:mb-0",
].join(" ");
