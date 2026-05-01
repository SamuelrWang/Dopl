"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { findKnowledgeBase } from "@/features/knowledge/data";
import { SourceIcon } from "@/features/knowledge/components/source-icon";
import type { SourceProvider } from "@/features/knowledge/data";

interface Props {
  body: string;
  workspaceSlug: string;
}

/**
 * Render the skill body, which uses a tiny template syntax:
 *
 *   {kb:slug}                  → KB chip linking to /{ws}/knowledge/{slug}
 *   {connector:provider}       → connector chip
 *   {connector:provider.field} → connector chip with sub-field rendered as
 *                                a small monospaced suffix
 *   {section:Heading}          → inline section header
 *
 * Anything outside `{...}` is plain text. Empty lines split paragraphs.
 */
export function SkillBodyRender({ body, workspaceSlug }: Props) {
  const blocks = splitBlocks(body);

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.kind === "section") {
          return (
            <h3
              key={i}
              className="pt-3 text-[11px] font-mono uppercase tracking-wider text-text-secondary/70"
            >
              {block.heading}
            </h3>
          );
        }
        return (
          <p
            key={i}
            className="text-sm leading-relaxed text-text-primary/90"
          >
            {renderInline(block.text, workspaceSlug)}
          </p>
        );
      })}
    </div>
  );
}

// ── Token + block parsing ──────────────────────────────────────────

interface ParagraphBlock {
  kind: "paragraph";
  text: string;
}

interface SectionBlock {
  kind: "section";
  heading: string;
}

type Block = ParagraphBlock | SectionBlock;

function splitBlocks(body: string): Block[] {
  const paragraphs = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const blocks: Block[] = [];
  for (const p of paragraphs) {
    const sectionMatch = p.match(/^\{section:([^}]+)\}$/);
    if (sectionMatch) {
      blocks.push({ kind: "section", heading: sectionMatch[1].trim() });
    } else {
      blocks.push({ kind: "paragraph", text: p });
    }
  }
  return blocks;
}

const TOKEN_PATTERN = /\{(kb|connector):([^}]+)\}/g;

function renderInline(text: string, workspaceSlug: string) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++}>{text.slice(lastIndex, match.index)}</span>,
      );
    }
    const [, kind, payload] = match;
    if (kind === "kb") {
      parts.push(
        <KbChip key={key++} slug={payload} workspaceSlug={workspaceSlug} />,
      );
    } else if (kind === "connector") {
      const [provider, ...fieldParts] = payload.split(".");
      parts.push(
        <ConnectorChip
          key={key++}
          provider={provider as SourceProvider}
          field={fieldParts.length > 0 ? fieldParts.join(".") : undefined}
        />,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}

// ── Chip components ───────────────────────────────────────────────

interface KbChipProps {
  slug: string;
  workspaceSlug: string;
}

export function KbChip({ slug, workspaceSlug }: KbChipProps) {
  const kb = findKnowledgeBase(slug);
  const name = kb?.name ?? slug;
  return (
    <Link
      href={`/${workspaceSlug}/knowledge/${slug}`}
      className={cn(
        "inline-flex items-baseline gap-1 align-baseline px-1.5 py-px rounded",
        "bg-violet-500/10 border border-violet-500/20 text-violet-300",
        "text-[12.5px] font-medium hover:bg-violet-500/20 transition-colors cursor-pointer",
      )}
    >
      <BookOpen size={10} className="self-center text-violet-300/80" />
      {name}
    </Link>
  );
}

interface ConnectorChipProps {
  provider: SourceProvider;
  field?: string;
}

export function ConnectorChip({ provider, field }: ConnectorChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 align-baseline px-1.5 py-px rounded",
        "bg-white/[0.04] border border-white/[0.08] text-text-primary",
        "text-[12.5px] font-medium",
      )}
    >
      <span className="self-center">
        <SourceIcon provider={provider} size="sm" />
      </span>
      <span>{provider === "google-drive" ? "Drive" : capitalize(provider)}</span>
      {field && (
        <span className="font-mono text-[11px] text-text-secondary/70">
          .{field}
        </span>
      )}
    </span>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
