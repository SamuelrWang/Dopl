"use client";

/**
 * DetailPanel — floating right-side overlay on the published cluster
 * detail page. Visually matches `FixedChatPanel` on /canvas:
 *   - Rounded 2xl, soft inset-top highlight, hard drop shadow
 *   - Detached from viewport edges (the shell positions it with a
 *     16px gap on all sides), not flush
 *   - Mono/micro font scale matching the canvas panel chrome —
 *     [10px] uppercase headers, [11px] primary text, [9px] meta
 *
 * Shows cluster info, creator profile, entries list, brain summary,
 * and the import CTA button. The Chat tab delegates to CommunityChat
 * (unchanged).
 */

import { useState } from "react";
import Link from "next/link";
import type { PublishedClusterDetail } from "@/lib/community/types";
import { CommunityChat } from "./community-chat";

type Tab = "info" | "chat";

interface DetailPanelProps {
  cluster: PublishedClusterDetail;
  isOwner: boolean;
  /**
   * True when the visitor has an authenticated session. When false, the
   * CTA renders as a "Sign in to import" link instead of a fork button
   * so we don't silently redirect on click (bad UX for public viewers).
   */
  isAuthenticated: boolean;
}

export function DetailPanel({ cluster, isOwner, isAuthenticated }: DetailPanelProps) {
  const [forking, setForking] = useState(false);
  const [forked, setForked] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("info");

  async function handleFork() {
    setForking(true);
    setForkError(null);
    try {
      const res = await fetch(`/api/community/${cluster.slug}/fork`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // 401 shouldn't happen now that the unauthenticated path renders
        // a Sign-In link instead of the fork button — but if it does
        // (e.g. the session expired between load and click), show an
        // inline message rather than hard-redirecting to /login, which
        // would blow away any scroll/state the visitor had on the page.
        if (res.status === 401) {
          setForkError("Your session expired. Sign in to import this cluster.");
          return;
        }
        throw new Error(data.error || "Failed to import");
      }
      setForked(true);
    } catch (err) {
      setForkError(err instanceof Error ? err.message : "Failed to import");
    } finally {
      setForking(false);
    }
  }

  return (
    <div
      className="h-full flex flex-col overflow-hidden rounded-2xl bg-[var(--panel-surface)] border border-white/[0.08]"
      style={{
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* ── Top bar (mirrors FixedChatPanel chrome) ────────────────── */}
      <div
        className="shrink-0 h-10 flex items-center justify-between px-4 gap-2"
        style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/50 truncate min-w-0">
          {cluster.title}
        </span>
        {isOwner && (
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-amber-400/70 bg-amber-400/[0.08] border border-amber-400/[0.15] px-1.5 py-0.5 rounded-[3px]">
            Editing
          </span>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex"
        style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
      >
        <TabButton
          active={activeTab === "info"}
          onClick={() => setActiveTab("info")}
        >
          Info
        </TabButton>
        <TabButton
          active={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
        >
          Chat
        </TabButton>
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      {/*
        Both tabs stay mounted; we toggle visibility via `hidden` so
        chat state (messages, input draft, in-flight stream) survives
        tab switches. Previously the chat unmounted on every Info
        click, vaporizing the conversation.
      */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto ${activeTab === "info" ? "" : "hidden"}`}
      >
        <InfoBody
          cluster={cluster}
          isOwner={isOwner}
          isAuthenticated={isAuthenticated}
          forking={forking}
          forked={forked}
          forkError={forkError}
          onFork={handleFork}
        />
      </div>
      <div
        className={`flex-1 min-h-0 overflow-hidden ${activeTab === "chat" ? "" : "hidden"}`}
      >
        <CommunityChat cluster={cluster} />
      </div>
    </div>
  );
}

// ── Tab button (FixedChatPanel-style) ─────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 h-9 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? "text-white/90 bg-white/[0.04]"
          : "text-white/30 hover:text-white/60 hover:bg-white/[0.02]"
      }`}
      style={
        active
          ? { boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.25)" }
          : undefined
      }
    >
      {children}
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

// When the curator never wrote a description, fall back to the cluster
// brain. The brain is structured as a Claude skill (frontmatter + ##
// headers + body), so we strip the YAML frontmatter, drop heading lines,
// and pick the first non-empty paragraph. Truncated to keep the panel
// from ballooning. Returns "" if nothing usable can be extracted.
function synopsisFromBrain(brain: string | null | undefined): string {
  if (!brain) return "";
  let text = brain;

  // Strip leading YAML frontmatter (--- ... ---).
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) text = text.slice(end + 4);
  }

  // Walk paragraph by paragraph; first non-heading, non-bullet block wins.
  const blocks = text.split(/\n\s*\n/);
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    if (block.startsWith("#")) continue;
    if (block.startsWith("-") || block.startsWith("*")) continue;
    const cleaned = block.replace(/\s+/g, " ").trim();
    if (cleaned.length < 30) continue;
    return cleaned.length > 320 ? cleaned.slice(0, 317) + "…" : cleaned;
  }
  return "";
}

// ── Info body ─────────────────────────────────────────────────────────

function InfoBody({
  cluster,
  isOwner,
  isAuthenticated,
  forking,
  forked,
  forkError,
  onFork,
}: {
  cluster: PublishedClusterDetail;
  isOwner: boolean;
  isAuthenticated: boolean;
  forking: boolean;
  forked: boolean;
  forkError: string | null;
  onFork: () => void;
}) {
  // Prefer the curator-written description. If empty, synthesize a
  // short blurb from the cluster brain — strip the structured-skill
  // headers and pick the first meaningful paragraph so the visitor
  // gets a real overview of what they're looking at instead of a
  // blank section.
  const synopsis =
    cluster.description?.trim() || synopsisFromBrain(cluster.brain_instructions);

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Title + synopsis */}
      <div>
        <h1 className="text-sm font-medium text-white/90 leading-snug mb-1.5">
          {cluster.title}
        </h1>
        {synopsis && (
          <p className="text-[11px] text-white/55 leading-relaxed whitespace-pre-line">
            {synopsis}
          </p>
        )}
      </div>

      {/* Stats row — all mono, muted */}
      <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-white/30">
        <div className="flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
          </svg>
          <span>{cluster.fork_count} imports</span>
        </div>
        <span className="text-white/20">·</span>
        <span>{cluster.panel_count} entries</span>
        {cluster.category && (
          <>
            <span className="text-white/20">·</span>
            <span>{cluster.category}</span>
          </>
        )}
      </div>

      {/* Creator */}
      <div
        className="p-3 rounded-[4px] border border-white/[0.06] bg-white/[0.02]"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}
      >
        <div className="flex items-center gap-2.5 mb-2">
          {cluster.author.avatar_url ? (
            <img
              src={cluster.author.avatar_url}
              alt=""
              className="w-7 h-7 rounded-full"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-neutral-700 flex items-center justify-center text-white/40 text-[11px] font-medium">
              {(cluster.author.display_name || "?")[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-white/80 font-medium truncate">
              {cluster.author.display_name || "Anonymous"}
            </div>
            {cluster.author.bio && (
              <div className="text-[10px] text-white/30 line-clamp-1">
                {cluster.author.bio}
              </div>
            )}
          </div>
        </div>
        {(cluster.author.website_url ||
          cluster.author.twitter_handle ||
          cluster.author.github_username) && (
          <div className="flex items-center gap-3 flex-wrap">
            {cluster.author.website_url && (
              <a
                href={cluster.author.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] uppercase tracking-wider text-white/30 hover:text-white/70 transition-colors"
              >
                Website
              </a>
            )}
            {cluster.author.twitter_handle && (
              <a
                href={`https://x.com/${cluster.author.twitter_handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] uppercase tracking-wider text-white/30 hover:text-white/70 transition-colors"
              >
                @{cluster.author.twitter_handle}
              </a>
            )}
            {cluster.author.github_username && (
              <a
                href={`https://github.com/${cluster.author.github_username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] uppercase tracking-wider text-white/30 hover:text-white/70 transition-colors"
              >
                GitHub
              </a>
            )}
          </div>
        )}
      </div>

      {/* CTA */}
      {isOwner ? (
        <Link
          href="/community/posts"
          className="w-full h-9 flex items-center justify-center rounded-[4px] border border-white/[0.1] text-white/60 text-[11px] font-medium uppercase tracking-wider hover:text-white/90 hover:border-white/[0.2] transition-colors"
        >
          Manage posts
        </Link>
      ) : isAuthenticated ? (
        <>
          <button
            onClick={onFork}
            disabled={forking || forked}
            className="w-full h-9 rounded-[4px] bg-white text-black text-[11px] font-medium uppercase tracking-wider hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {forked
              ? "Installed to canvas"
              : forking
                ? "Installing..."
                : "Install to my canvas"}
          </button>
          {forkError && (
            <p className="mt-2 text-[10px] text-red-400/80 text-center">
              {forkError}
            </p>
          )}
        </>
      ) : (
        // Unauthenticated visitor: surface the Sign-In requirement up
        // front as an explicit affordance. Previously this rendered as
        // the normal Import button that silently bounced the visitor
        // to /login on click (401 → window.location.href) — a surprise
        // redirect, which is the pattern the user flagged as bad UX.
        <Link
          href={`/login?redirectTo=/canvas&installCluster=${encodeURIComponent(cluster.slug)}`}
          className="w-full h-9 flex items-center justify-center rounded-[4px] bg-white text-black text-[11px] font-medium uppercase tracking-wider hover:bg-white/90 transition-colors"
        >
          Log in to install
        </Link>
      )}

      {/* What is Dopl? — orient first-time visitors who land on a
          shared cluster without context. Keep it short and tonally
          aligned with the rest of the chrome (mono header, muted body). */}
      <div
        className="p-3 rounded-[4px] border border-white/[0.06] bg-white/[0.02]"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}
      >
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
          What is Dopl?
        </div>
        <p className="text-[11px] text-white/55 leading-relaxed">
          Dopl is a knowledge base of proven AI and automation setups —
          agents, skills, workflows, and integrations. Browse what others
          have built, install one to your own canvas, and remix it for
          your own workflow.
        </p>
      </div>

      {/* Date */}
      <div
        className="pt-3 font-mono text-[9px] uppercase tracking-wider text-white/25"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
      >
        Published{" "}
        {new Date(cluster.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </div>
    </div>
  );
}
