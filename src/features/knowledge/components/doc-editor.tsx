"use client";

import { useEditor, EditorContent } from "@tiptap/react";
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
import { Toolbar } from "./doc-editor-toolbar";
import { makeLinkRule, makeTableRule } from "./doc-editor-turndown";

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
  /** Horizontal inset (Tailwind classes) for the fixed toolbar pill, so it
   *  centers over the host panel. Defaults to the v1 KB-detail layout. */
  toolbarInset?: string;
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
export function DocEditor({
  initialMarkdown,
  resetKey,
  onChange,
  readOnly,
  toolbarInset,
}: Props) {
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
      linkStyle: "inlined",
    });
    td.addRule("table", makeTableRule());
    // Force an explicit link rule. Turndown's built-in "inlineLink" works
    // most of the time, but Tiptap's Link mark adds extra attrs (class,
    // target) that have, in practice, caused the default rule to skip
    // the anchor — leaving the link text behind without an href on
    // round-trip. An explicit rule keyed only on `a[href]` is robust.
    td.addRule("link", makeLinkRule());
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
        // `true` opens links on plain click; users edit the URL via
        // the Link toolbar button (or ⌘K). For an always-editable doc
        // this beats the silent-no-op `false` default.
        openOnClick: true,
        autolink: true,
        HTMLAttributes: {
          class: "text-violet-300 hover:underline",
          target: "_blank",
          rel: "noopener noreferrer",
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
  //
  // Defense-in-depth: skip the call entirely when the new HTML
  // round-trips to the same markdown the editor already holds. The
  // parent (DocPane) only changes `initialMarkdown` on mount and on
  // explicit user-driven reload, but we want a hard guarantee that no
  // accidental prop churn can blow away unsaved edits.
  const lastSeededHtmlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (lastSeededHtmlRef.current === initialHtml) return;
    const currentMd = turndown.turndown(editor.getHTML());
    if (currentMd === initialMarkdown) {
      lastSeededHtmlRef.current = initialHtml;
      return;
    }
    editor.commands.setContent(initialHtml, { emitUpdate: false });
    lastSeededHtmlRef.current = initialHtml;
  }, [editor, resetKey, initialHtml, initialMarkdown, turndown]);

  // Sync editable mode if readOnly toggles.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) return null;

  // Tiptap's contenteditable only handles clicks landing inside the
  // prose. Clicks on the surrounding "page" area (below the last
  // line, or to the right of the constrained max-width column) are
  // ignored, which feels broken — users expect any click on the
  // visible page to position the caret. Wire an onClick on the
  // wrapper that focuses the editor at end IF the click target is
  // the wrapper itself (not an element inside the prose). Bumping
  // the min-height ensures there's a generous click target even
  // when content is short.
  return (
    <div
      className="flex flex-col"
      onClick={(e) => {
        if (readOnly) return;
        if (e.target !== e.currentTarget) return;
        editor.commands.focus("end");
      }}
    >
      <Toolbar editor={editor} toolbarInset={toolbarInset} />
      <div
        className="mx-auto w-full max-w-3xl px-6 pb-28 min-h-[60vh] cursor-text"
        onClick={(e) => {
          if (readOnly) return;
          // Only fire when the click landed on this wrapper (not on
          // the prose itself, which Tiptap handles natively to
          // position the caret at the click point).
          if (e.target !== e.currentTarget) return;
          editor.commands.focus("end");
        }}
      >
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
          ? "text-small text-red-400"
          : "text-small text-text-secondary/60"
      }
    >
      {label}
    </span>
  );
}

// ── Prose styling — must match DocMarkdown exactly so the editor and
//    the read-only renderer look identical at every step. ─────────────

const PROSE_CLASSES = [
  // Outer container
  "prose max-w-none text-text-primary/90 focus:outline-none",
  // Paragraphs
  "prose-p:my-3 prose-p:leading-[1.7] prose-p:text-[16px]",
  // Headings
  "prose-headings:text-text-primary prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-h1:text-[24px] prose-h1:mt-7 prose-h1:mb-2",
  "prose-h2:text-[19px] prose-h2:mt-6 prose-h2:mb-1.5",
  "prose-h3:text-[16px] prose-h3:mt-5 prose-h3:mb-1",
  "prose-h4:text-[15px] prose-h4:mt-4 prose-h4:mb-1",
  // Bold + italic
  "prose-strong:text-text-primary prose-strong:font-semibold",
  "prose-em:text-text-primary/85 prose-em:italic",
  // Blockquote
  "prose-blockquote:not-italic prose-blockquote:font-normal",
  "prose-blockquote:text-text-primary/85 prose-blockquote:border-l-2 prose-blockquote:border-l-violet-400/40",
  "prose-blockquote:pl-3.5 prose-blockquote:my-3 prose-blockquote:py-0.5",
  "[&_blockquote_p]:my-1 [&_blockquote_p]:text-[16px] [&_blockquote_p:before]:hidden [&_blockquote_p:after]:hidden",
  // Lists
  "prose-ul:my-2.5 prose-ol:my-2.5 prose-li:my-0.5 prose-li:text-[16px] prose-li:leading-[1.7]",
  "prose-ul:pl-5 prose-ol:pl-5",
  "[&_li::marker]:text-text-secondary/50",
  // Tiptap wraps each list-item's content in a <p>, which then inherits
  // prose-p's my-3. Strip those vertical margins so list items are tight.
  "[&_li>p]:my-0 [&_li>p]:leading-[1.65]",
  // Inline code
  "prose-code:text-[12.5px] prose-code:text-text-primary prose-code:bg-surface-raised-3 prose-code:border prose-code:border-border-subtle",
  "prose-code:px-1 prose-code:py-px prose-code:rounded prose-code:font-mono",
  "prose-code:before:content-none prose-code:after:content-none",
  // Code blocks
  "prose-pre:bg-surface-raised-2 prose-pre:border prose-pre:border-border-subtle",
  "prose-pre:rounded-lg prose-pre:my-3 prose-pre:text-[12.5px]",
  // Links
  "prose-a:text-violet-300 prose-a:no-underline hover:prose-a:underline",
  // HR
  "prose-hr:border-border-default prose-hr:my-6",
  // Tables — clean docs look
  "[&_table]:my-3 [&_table]:border-collapse [&_table]:w-full [&_table]:text-[13px]",
  "[&_thead]:bg-surface-raised-1",
  "[&_th]:text-left [&_th]:font-semibold [&_th]:text-text-primary [&_th]:px-3 [&_th]:py-1.5",
  "[&_th]:border [&_th]:border-border-default",
  "[&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-border-subtle [&_td]:text-text-primary/90",
  "[&_tbody_tr:hover]:bg-surface-raised-1",
  // Selected node ring (subtle)
  "[&_.ProseMirror-selectednode]:outline [&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-violet-400/30",
  // Editing affordance: faint cursor color
  "[&_.ProseMirror]:caret-text-text-primary",
  // Tiptap wraps content in a `.ProseMirror` div, which means the
  // prose `:first-child` selector targets the wrapper, not the actual
  // first paragraph/heading. Manually strip the top margin so the
  // first content block sits flush against the toolbar instead of
  // pushing down by one prose-p margin.
  "[&_.ProseMirror>*:first-child]:mt-0",
  "[&_.ProseMirror>*:last-child]:mb-0",
].join(" ");
