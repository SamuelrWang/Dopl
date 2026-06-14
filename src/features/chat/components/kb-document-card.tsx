"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
} from "lucide-react";
import { MarkdownMessage } from "@/shared/design";

interface KbDocumentCardProps {
  title: string;
  knowledgeBase: string;
  knowledgeBaseSlug: string;
  body: string;
  entryId: string;
  updatedAt: string | null;
}

/**
 * Inline card rendered in the private chat when the model calls
 * `render_knowledge_entry`. A faithful, read-only render of ONE knowledge-
 * base entry: the body is fetched server-side under the caller's access,
 * so what shows here is always the true entry — never a model
 * reproduction.
 *
 * Distinct from the artifact cards (`AgentPromptCard` / `ContextFileCard`):
 * those are model-authored bundles the user can promote to the canvas.
 * This is a window onto something that already lives in the workspace, so
 * its actions are copy + open-in-Knowledge — no promote.
 *
 * Header band is the app's dark ink color (matches the slide-out drawers),
 * with a knowledge-blue accent so it reads as a document at a glance.
 */
export function KbDocumentCard({
  title,
  knowledgeBase,
  knowledgeBaseSlug,
  body,
  updatedAt,
}: KbDocumentCardProps) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  // Chat lives at /[workspaceSlug]/chat — lift the segment to build the
  // Knowledge deep link without threading it through every prop.
  const pathname = usePathname();
  const segment = pathname?.split("/").filter(Boolean)[0] ?? "";
  const kbHref =
    segment && knowledgeBaseSlug
      ? `/${segment}/knowledge/${knowledgeBaseSlug}`
      : undefined;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can select-all manually
    }
  }

  return (
    <div className="rounded-lg border border-sky-400/20 bg-surface-raised-1 overflow-hidden">
      {/* Dark header band — KB path + entry title. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left bg-[var(--surface-cta)] hover:brightness-110 transition-[filter]"
      >
        <BookOpen size={14} className="shrink-0 text-sky-300" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-white/45">
            <span className="truncate max-w-[180px]">{knowledgeBase}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">Knowledge</span>
          </span>
          <span className="block text-[12.5px] font-medium text-white truncate">
            {title}
          </span>
        </span>
        <span className="shrink-0 text-white/45">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
        aria-hidden={!open}
      >
        <div className="overflow-hidden min-h-0">
          <div className="px-3.5 py-3 max-h-[420px] overflow-y-auto text-[12.5px]">
            <MarkdownMessage content={body} />
          </div>
          <div className="flex items-center gap-2 px-2 py-2 border-t border-border-subtle bg-surface-raised-1">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11.5px] text-text-secondary hover:bg-surface-raised-3 hover:text-text-primary transition-colors cursor-pointer"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            {kbHref && (
              <a
                href={kbHref}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-[11.5px] text-text-secondary hover:bg-surface-raised-3 hover:text-text-primary transition-colors cursor-pointer"
              >
                <ExternalLink size={12} /> Open in Knowledge
              </a>
            )}
            {updatedAt && (
              <span className="ml-auto text-[10px] font-mono text-text-secondary/40">
                Snapshot · updated {formatDate(updatedAt)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact, locale-stable date for the freshness hint (e.g. "Jun 6, 2026"). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
