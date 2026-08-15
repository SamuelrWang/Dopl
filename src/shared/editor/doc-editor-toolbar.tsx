"use client";

import { type Editor, useEditorState } from "@tiptap/react";
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

/** Toolbar for the KB doc editor. Table group appears only inside a table. */

interface ToolbarProps {
  editor: Editor;
  /** `float` = viewport-fixed bottom pill (skills editor).
   *  `header` = flat inline row in a panel header band (knowledge-v2). */
  variant?: "float" | "header";
  /** Tailwind classes for the fixed pill's horizontal inset at md+, so the
   *  bar centers over the content panel, not the viewport. `float` only. */
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
  variant = "float",
  toolbarInset = "md:left-[570px] md:right-[6px]",
}: ToolbarProps) {
  // ⚠ Subscribe to the transaction stream, not parent renders: the `header`
  // variant renders outside the `useEditor` owner and would never update.
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      h1: editor.isActive("heading", { level: 1 }),
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      blockquote: editor.isActive("blockquote"),
      table: editor.isActive("table"),
      link: editor.isActive("link"),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  });

  const baseGroups: ReadonlyArray<ReadonlyArray<ToolbarItem>> = [
    [
      {
        icon: Heading1,
        label: "Heading 1",
        active: s.h1,
        run: () =>
          editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        icon: Heading2,
        label: "Heading 2",
        active: s.h2,
        run: () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        icon: Heading3,
        label: "Heading 3",
        active: s.h3,
        run: () =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        icon: Bold,
        label: "Bold (⌘B)",
        active: s.bold,
        run: () => editor.chain().focus().toggleBold().run(),
      },
      {
        icon: Italic,
        label: "Italic (⌘I)",
        active: s.italic,
        run: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        icon: UnderlineIcon,
        label: "Underline (⌘U)",
        active: s.underline,
        run: () => editor.chain().focus().toggleUnderline().run(),
      },
      {
        icon: Strikethrough,
        label: "Strikethrough",
        active: s.strike,
        run: () => editor.chain().focus().toggleStrike().run(),
      },
    ],
    [
      {
        icon: List,
        label: "Bullet list",
        active: s.bulletList,
        run: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        icon: ListOrdered,
        label: "Numbered list",
        active: s.orderedList,
        run: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        icon: Quote,
        label: "Quote",
        active: s.blockquote,
        run: () => editor.chain().focus().toggleBlockquote().run(),
      },
    ],
    [
      {
        icon: TableIcon,
        label: "Insert table",
        active: s.table,
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
        active: s.link,
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
        disabled: !s.canUndo,
      },
      {
        icon: Redo2,
        label: "Redo (⇧⌘Z)",
        run: () => editor.chain().focus().redo().run(),
        disabled: !s.canRedo,
      },
    ],
  ];

  const inTable = s.table;
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

  const rows = groups.map((group, gi) => (
    <div key={gi} className="flex items-center gap-1">
      {gi > 0 && (
        <span
          className={cn(
            "mx-1 h-4 w-px",
            variant === "header" ? "bg-border-strong" : "bg-black/10"
          )}
          aria-hidden
        />
      )}
      {group.map((item) => (
        <ToolbarButton key={item.label} variant={variant} {...item} />
      ))}
    </div>
  ));

  // Header variant: scrolls horizontally on narrow panels, no button clipped.
  if (variant === "header") {
    return (
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {rows}
      </div>
    );
  }

  // Float variant — fixed pill, bottom. Default inset derives from: app rail
  // 74 + surface margin 4 + sidebar 204 + KB tree 288 = 570px left, 6px right
  // (surface margin). Centers over the panel, not the viewport, at md+.
  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 left-0 right-0 z-[5] flex justify-center px-4",
        toolbarInset
      )}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-[14px] border border-black/[0.08] bg-[var(--panel-surface)] px-2 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_18px_rgba(0,0,0,0.12)]">
        {rows}
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  active,
  disabled,
  run,
  variant = "float",
}: ToolbarItem & { variant?: "float" | "header" }) {
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
        "flex h-7 w-8 shrink-0 items-center justify-center rounded-md",
        variant === "header"
          ? // Flat icon button — app-wide compact-chrome idiom.
            active
            ? "concave-sel cursor-pointer text-text-primary"
            : "text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary"
          : cn("text-text-primary", active ? "btn-pressed" : "btn-light"),
        !disabled && "cursor-pointer",
        disabled && "opacity-40"
      )}
    >
      <Icon size={13} />
    </button>
  );
}
