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
import { cn } from "@/shared/lib/utils";
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
  /** Read-only mode — disables editing entirely (e.g. a viewer's KB). */
  readOnly?: boolean;
  /** Horizontal inset (Tailwind classes) for the fixed toolbar pill, so it
   *  centers over the host panel. */
  toolbarInset?: string;
  /** Suppress the built-in floating toolbar — host renders its own via
   *  `onEditor`. */
  hideToolbar?: boolean;
  /** Receives the live editor instance (null on teardown) so a host can
   *  render the toolbar outside this component. */
  onEditor?: (editor: Editor | null) => void;
}

/**
 * Inline rich-text editor for KB entries. Always editable — no view/edit
 * switch. Data layer stores markdown: `marked` in once, `turndown` back out
 * on every edit via `onChange`. Parent owns the autosave debounce.
 */
export function DocEditor({
  initialMarkdown,
  resetKey,
  onChange,
  readOnly,
  toolbarInset,
  hideToolbar,
  onEditor,
}: Props) {
  const initialHtml = useMemo(() => {
    const result = marked.parse(initialMarkdown, { async: false, gfm: true });
    return typeof result === "string" ? result : "";
  }, [initialMarkdown]);

  // useState lazy-init so the Turndown constructor runs once, not per render.
  const [turndown] = useState<TurndownService>(() => {
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
      linkStyle: "inlined",
    });
    td.addRule("table", makeTableRule());
    td.addRule("link", makeLinkRule()); // ⚠ overrides built-in inlineLink — see makeLinkRule
    return td;
  });

  // ⚠ Latest onChange in a ref: Tiptap's `onUpdate` closes over the first one
  // passed in, so parent closure updates would be missed.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false, // own Link extension below, for click-control
        underline: false, // dedicated Underline extension drives it
      }),
      Underline,
      Link.configure({
        // Plain click = caret (no surprise navigation while editing);
        // ⌘/Ctrl+click opens it, via handleDOMEvents below.
        openOnClick: false,
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
      handleDOMEvents: {
        click: (_view, event) => {
          if (!(event.metaKey || event.ctrlKey)) return false;
          const anchor = (event.target as HTMLElement).closest("a[href]");
          if (!(anchor instanceof HTMLAnchorElement)) return false;
          window.open(anchor.href, "_blank", "noopener,noreferrer");
          event.preventDefault();
          return true;
        },
      },
    },
    onUpdate({ editor }) {
      const md = turndown.turndown(editor.getHTML());
      onChangeRef.current?.(md);
    },
  });

  // New resetKey → reload content. ⚠ `emitUpdate: false` or the load bubbles
  // a spurious save. Skip entirely when the new HTML round-trips to the
  // markdown already held: prop churn must never blow away unsaved edits.
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

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Publish editor to host; clear on teardown so no stale editor is held.
  useEffect(() => {
    onEditor?.(editor ?? null);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  if (!editor) return null;

  // Tiptap's contenteditable ignores clicks outside the prose (below the last
  // line, right of the max-width column). Focus the NEAREST position — never
  // "end", which scrolls a long doc to the bottom under the reader.
  // ⚠ scrollIntoView: false for the same reason.
  const focusNearestToClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    if (e.target !== e.currentTarget) return;
    const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    const pos =
      hit?.pos ??
      // Outside prose bounds entirely: snap to nearest edge.
      (e.clientY > editor.view.dom.getBoundingClientRect().bottom
        ? "end"
        : "start");
    editor.chain().focus(pos, { scrollIntoView: false }).run();
  };

  return (
    <div className="flex flex-col" onClick={focusNearestToClick}>
      {!hideToolbar && <Toolbar editor={editor} toolbarInset={toolbarInset} />}
      <div
        className={cn(
          "mx-auto w-full max-w-3xl px-6 min-h-[60vh] cursor-text",
          // Floating pill needs bottom clearance; a header toolbar does not.
          hideToolbar ? "pb-16" : "pb-28"
        )}
        onClick={focusNearestToClick}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** Autosave status indicator — rendered in the page header. */
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

const PROSE_CLASSES = [
  "prose max-w-none text-text-primary/90 focus:outline-none",
  "prose-p:my-3 prose-p:leading-[1.7] prose-p:text-[16px]",
  "prose-headings:text-text-primary prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-h1:text-[24px] prose-h1:mt-7 prose-h1:mb-2",
  "prose-h2:text-[19px] prose-h2:mt-6 prose-h2:mb-1.5",
  "prose-h3:text-[16px] prose-h3:mt-5 prose-h3:mb-1",
  "prose-h4:text-[15px] prose-h4:mt-4 prose-h4:mb-1",
  "prose-strong:text-text-primary prose-strong:font-semibold",
  "prose-em:text-text-primary/85 prose-em:italic",
  "prose-blockquote:not-italic prose-blockquote:font-normal",
  "prose-blockquote:text-text-primary/85 prose-blockquote:border-l-2 prose-blockquote:border-l-violet-400/40",
  "prose-blockquote:pl-3.5 prose-blockquote:my-3 prose-blockquote:py-0.5",
  "[&_blockquote_p]:my-1 [&_blockquote_p]:text-[16px] [&_blockquote_p:before]:hidden [&_blockquote_p:after]:hidden",
  "prose-ul:my-2.5 prose-ol:my-2.5 prose-li:my-0.5 prose-li:text-[16px] prose-li:leading-[1.7]",
  "prose-ul:pl-5 prose-ol:pl-5",
  "[&_li::marker]:text-text-secondary/50",
  // ⚠ Tiptap wraps each li's content in a <p>, inheriting prose-p my-3.
  "[&_li>p]:my-0 [&_li>p]:leading-[1.65]",
  "prose-code:text-[12.5px] prose-code:text-text-primary prose-code:bg-surface-raised-3 prose-code:border prose-code:border-border-subtle",
  "prose-code:px-1 prose-code:py-px prose-code:rounded prose-code:font-mono",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:bg-surface-raised-2 prose-pre:border prose-pre:border-border-subtle",
  "prose-pre:rounded-lg prose-pre:my-3 prose-pre:text-[12.5px]",
  "prose-a:text-violet-300 prose-a:no-underline hover:prose-a:underline",
  "prose-hr:border-border-default prose-hr:my-6",
  "[&_table]:my-3 [&_table]:border-collapse [&_table]:w-full [&_table]:text-[13px]",
  "[&_thead]:bg-surface-raised-1",
  "[&_th]:text-left [&_th]:font-semibold [&_th]:text-text-primary [&_th]:px-3 [&_th]:py-1.5",
  "[&_th]:border [&_th]:border-border-default",
  "[&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-border-subtle [&_td]:text-text-primary/90",
  "[&_tbody_tr:hover]:bg-surface-raised-1",
  "[&_.ProseMirror-selectednode]:outline [&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-violet-400/30",
  "[&_.ProseMirror]:caret-text-text-primary",
  // ⚠ Tiptap wraps content in `.ProseMirror`, so prose `:first-child` hits
  // the wrapper, not the first block. Strip the margin by hand.
  "[&_.ProseMirror>*:first-child]:mt-0",
  "[&_.ProseMirror>*:last-child]:mb-0",
].join(" ");
