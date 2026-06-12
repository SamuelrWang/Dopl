"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { TeamChip } from "@/features/members/components/team-bits";
import { kbScope, KB_SCOPE_LABEL } from "../../scope";
import type { KnowledgeBase } from "../../types";
import { knowledgeBaseSegment } from "../../url";
import styles from "@/shared/layout/app-shell/app-shell.module.css";

/** Minimal team ref for the admin card pills. */
export interface KbTeamRef {
  teamId: string;
  name: string;
  color: string | null;
}

const MAX_TEAM_PILLS = 3;

interface Props {
  workspaceSegment: string;
  bases: KnowledgeBase[];
  /** Present only for admins: kbId → teams granted on that KB. */
  kbTeams?: Record<string, KbTeamRef[]>;
  onCreate: () => void;
}

/**
 * Right-hand main panel of the knowledge-landing preview: the hero banner
 * and the grid of knowledge bases (each card routes into the existing KB
 * tree view) plus a dashed "create" tile. The dark top titlebar lives one
 * level up in the preview shell, spanning the full dark area.
 */
export function LandingContent({
  workspaceSegment,
  bases,
  kbTeams,
  onCreate,
}: Props) {
  return (
    <main className={styles.main}>
        <div className={styles.scroll}>
          <div className={styles.head}>
            <div className={styles.title}>
              <h1>Knowledge</h1>
              <span className={styles.tag}>Beta</span>
            </div>
          </div>

          <section className={styles.hero}>
            <div className={styles.heroBlobs}>
              <span style={{ width: 62, height: 62, top: 42, right: 118 }} />
              <span style={{ width: 66, height: 66, top: 36, right: 34 }} />
              <span style={{ width: 70, height: 70, top: 170, right: 178 }} />
              <span style={{ width: 72, height: 72, top: 172, right: 74 }} />
              <span style={{ width: 70, height: 70, top: 286, right: 130 }} />
              <span style={{ width: 70, height: 70, top: 288, right: 26 }} />
            </div>
            <div className={styles.heroInner}>
              <h2>Everything your agents know, in one place</h2>
              <p>
                Build a knowledge base to give your agents durable, searchable
                context — then connect them over MCP.
              </p>
              <div className={styles.heroActions}>
                <button type="button" className={styles.tryit} onClick={onCreate}>
                  New knowledge base
                </button>
                <Link className={styles.howit} href="/docs">
                  How it works
                </Link>
              </div>
            </div>
          </section>

          {/* Section heading removed — the hero already titles the page;
              keep the Create New shortcut right-aligned above the grid. */}
          <div className={styles.sectionHead} style={{ justifyContent: "flex-end" }}>
            <button type="button" className={styles.createNew} onClick={onCreate}>
              Create New
            </button>
          </div>

          {bases.length === 0 ? (
            <p className={styles.empty}>
              No knowledge bases yet — create your first one to get started.
            </p>
          ) : null}

          <div className={styles.cards}>
            {bases.map((kb) => {
              const scope = kbScope(kb);
              // Pills are an admin-only affordance: members just get the
              // scope label (kbTeams is undefined for them).
              const teams =
                scope === "team" ? (kbTeams?.[kb.id] ?? null) : null;
              return (
                <Link
                  key={kb.id}
                  href={`/${workspaceSegment}/knowledge/${knowledgeBaseSegment(kb)}`}
                  className={styles.card}
                >
                  <h3>{kb.name}</h3>
                  {kb.description ? (
                    <p className={styles.cardDesc}>{kb.description}</p>
                  ) : null}
                  {teams && teams.length > 0 ? (
                    <div
                      className={`${styles.lightScope} flex flex-wrap items-center gap-1.5 pt-3`}
                    >
                      {teams.slice(0, MAX_TEAM_PILLS).map((t) => (
                        <TeamChip key={t.teamId} name={t.name} color={t.color} />
                      ))}
                      {teams.length > MAX_TEAM_PILLS ? (
                        <span className="text-[11px] text-text-secondary">
                          +{teams.length - MAX_TEAM_PILLS}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className={styles.cardMeta}>
                    <span>{KB_SCOPE_LABEL[scope]}</span>
                    <span>Updated {formatRelative(kb.updatedAt)}</span>
                  </div>
                </Link>
              );
            })}

            <button type="button" className={`${styles.card} ${styles.cardNew}`} onClick={onCreate}>
              <span className={styles.plus}>
                <Plus size={24} strokeWidth={2} />
              </span>
              <h3>Create your own</h3>
              <p className={styles.cardDesc}>Start a new knowledge base</p>
            </button>
          </div>
        </div>
      </main>
  );
}

/** Cheap relative-time formatter. Good enough for "Updated 2h ago". */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}
