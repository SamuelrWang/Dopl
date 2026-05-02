"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SourceIcon } from "@/features/knowledge/components/source-icon";
import type { SourceProvider } from "@/features/knowledge/source-types";
import {
  parseSkillBody,
  type Inline,
  type SkillBlock,
} from "@/features/skills/skill-body";

interface Props {
  body: string;
  workspaceSlug: string;
}

const KNOWN_PROVIDERS = new Set<SourceProvider>([
  "slack",
  "google-drive",
  "gmail",
  "notion",
  "github",
]);

function isKnownProvider(provider: string): provider is SourceProvider {
  return KNOWN_PROVIDERS.has(provider as SourceProvider);
}

/**
 * Renders a skill body. Markdown links with the `dopl://` URI scheme
 * become typed chips; `## Heading` lines become section headers; plain
 * text is preserved as paragraphs.
 *
 * Anything outside the recognized syntax (links to other URIs, inline
 * formatting) is currently rendered as raw text — by design for v1.
 * The full markdown renderer can swap in once the editor lands.
 */
export function SkillBodyRender({ body, workspaceSlug }: Props) {
  const { blocks } = parseSkillBody(body);
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <BlockRender key={i} block={block} workspaceSlug={workspaceSlug} />
      ))}
    </div>
  );
}

function BlockRender({
  block,
  workspaceSlug,
}: {
  block: SkillBlock;
  workspaceSlug: string;
}) {
  if (block.kind === "section") {
    return (
      <h3 className="pt-3 text-[11px] font-mono uppercase tracking-wider text-text-secondary/70">
        {block.heading}
      </h3>
    );
  }
  return (
    <p className="text-sm leading-relaxed text-text-primary/90">
      {block.inlines.map((inline, i) => (
        <InlineRender key={i} inline={inline} workspaceSlug={workspaceSlug} />
      ))}
    </p>
  );
}

function InlineRender({
  inline,
  workspaceSlug,
}: {
  inline: Inline;
  workspaceSlug: string;
}) {
  if (inline.kind === "text") {
    return <span>{inline.text}</span>;
  }
  if (inline.kind === "kb") {
    return (
      <KbChip slug={inline.slug} label={inline.label} workspaceSlug={workspaceSlug} />
    );
  }
  return (
    <ConnectorChip
      provider={inline.provider}
      field={inline.field}
      label={inline.label}
    />
  );
}

interface KbChipProps {
  slug: string;
  label: string;
  workspaceSlug: string;
}

export function KbChip({ slug, label, workspaceSlug }: KbChipProps) {
  return (
    <Link
      href={`/${workspaceSlug}/knowledge/${slug}`}
      className={cn(
        "inline-flex items-baseline gap-1 align-baseline px-1.5 py-px rounded",
        "bg-violet-500/10 border border-violet-500/20 text-violet-300",
        "text-[12.5px] font-medium hover:bg-violet-500/20 transition-colors cursor-pointer"
      )}
    >
      <BookOpen size={10} className="self-center text-violet-300/80" />
      {label || slug}
    </Link>
  );
}

interface ConnectorChipProps {
  provider: string;
  field?: string;
  label: string;
}

export function ConnectorChip({ provider, field, label }: ConnectorChipProps) {
  const showIcon = isKnownProvider(provider);
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 align-baseline px-1.5 py-px rounded",
        "bg-white/[0.04] border border-white/[0.08] text-text-primary",
        "text-[12.5px] font-medium"
      )}
    >
      {showIcon && (
        <span className="self-center">
          <SourceIcon provider={provider as SourceProvider} size="sm" />
        </span>
      )}
      <span>{label || provider}</span>
      {field && (
        <span className="font-mono text-[11px] text-text-secondary/70">
          .{field}
        </span>
      )}
    </span>
  );
}
