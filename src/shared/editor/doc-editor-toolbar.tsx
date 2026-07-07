"use client";

import { type Editor } from "@tiptap/react";
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
  ArrowDownToLine,
  ArrowUpToLine,
  ArrowRightToLine,
  ArrowLeftToLine,
  Trash,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * Toolbar for the KB doc editor. Extracted from `doc-editor.tsx` for
 * the §2 file-size cap. Behavior unchanged from the inlined version,
 * plus a new "table-active" group that only appears when the cursor
 * is inside a table — gives the user/agent affordances to add or
 * remove rows/columns without right-click menus.
 */

interface ToolbarProps {
  editor: Editor;
  /** Tailwind classes for the fixed pill's horizontal inset at md+, so the
   *  bar centers over the content panel rather than the viewport. Defaults
   *  to the v1 KB-detail layout offset. */
  toolbarInset?: string;
}

interface ToolbarItem {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
}

export function Toolbar({
  editor,
  toolbarInset = "md:left-[570px] md:right-[6px]",
}: ToolbarProps) {
  const baseGroups: ReadonlyArray<ReadonlyArray<ToolbarItem>> = [
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

  // Conditional table-editing group. Tiptap re-renders the toolbar on
  // every selection change (the `useEditor` hook's internal state
  // bumps), so `editor.isActive("table")` is fresh on each render.
  const inTable = editor.isActive("table");
  const tableGroup: ReadonlyArray<ToolbarItem> = inTable
    ? [
        {
          icon: ArrowUpToLine,
          label: "Insert row above",
          run: () => editor.chain().focus().addRowBefore().run(),
        },
        {
          icon: ArrowDownToLine,
          label: "Insert row below",
          run: () => editor.chain().focus().addRowAfter().run(),
        },
        {
          icon: ArrowLeftToLine,
          label: "Insert column left",
          run: () => editor.chain().focus().addColumnBefore().run(),
        },
        {
          icon: ArrowRightToLine,
          label: "Insert column right",
          run: () => editor.chain().focus().addColumnAfter().run(),
        },
        {
          icon: Trash,
          label: "Delete row",
          run: () => editor.chain().focus().deleteRow().run(),
        },
        {
          icon: Trash,
          label: "Delete column",
          run: () => editor.chain().focus().deleteColumn().run(),
        },
      ]
    : [];

  const groups = inTable ? [...baseGroups, tableGroup] : baseGroups;

  // Viewport-fixed so it stays pinned while the file panel scrolls. The
  // panel sits right of the app rail (74px) + surface margin (4px) + app
  // sidebar (204px) + KB tree (288px) = 570px, with the surface's 6px
  // right margin — so offset left/right to center over the panel (not the
  // viewport) at md+. Below md the tree/sidebars collapse.
  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 left-0 right-0 z-[5] flex justify-center px-4",
        toolbarInset
      )}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-[14px] border border-black/[0.08] bg-[var(--panel-surface)] px-2 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_18px_rgba(0,0,0,0.12)]">
        {groups.map((group, gi) => (
          <div key={gi} className="flex items-center gap-1">
            {gi > 0 && (
              <span className="mx-1 h-4 w-px bg-black/10" aria-hidden />
            )}
            {group.map((item) => (
              <ToolbarButton key={item.label} {...item} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
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
        "flex h-7 w-8 items-center justify-center rounded-md text-text-primary",
        active ? "btn-pressed cursor-pointer" : "btn-light",
        !disabled && !active && "cursor-pointer",
      )}
    >
      <Icon size={13} />
    </button>
  );
}
