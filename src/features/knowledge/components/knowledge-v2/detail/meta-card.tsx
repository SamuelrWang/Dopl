"use client";

import {
  CalendarCheck,
  CalendarDays,
  Flag,
  Maximize2,
  MoreHorizontal,
  Triangle,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import { TeamChip } from "@/features/members/components/team-bits";
import styles from "../knowledge-v2.module.css";

export interface MetaTeamRef {
  name: string;
  color: string | null;
}

export interface MetaCardProps {
  tint: string;
  /** Container label shown in the card header (the base name). */
  containerName: string;
  title: string;
  ownerLabel: string;
  ownerInitial: string;
  createdAt: string;
  updatedAt: string;
  scopeLabel: string;
  /** Who can reach this base — derived from visibility + access mode. */
  accessLabel: string;
  /** Teams granted access (teams-mode bases). Empty/undefined hides the row. */
  teams?: MetaTeamRef[];
}

/**
 * The nested card on the base overview: a bordered card with a gray header
 * (container icon + name + actions) over a white body holding the title,
 * owner line, and the access/visibility meta grid. Status is a static
 * placeholder; everything else (dates, visibility, access, teams) is real.
 */
export function MetaCard({
  tint,
  containerName,
  title,
  ownerLabel,
  ownerInitial,
  createdAt,
  updatedAt,
  scopeLabel,
  accessLabel,
  teams,
}: MetaCardProps) {
  return (
    <div className={styles.metaCard}>
      <div className={styles.metaCardHead}>
        <span className={styles.label}>{containerName}</span>
        <button className={styles.iconBtn} type="button" aria-label="Add member">
          <UserPlus size={16} />
        </button>
        <button className={styles.iconBtn} type="button" aria-label="More">
          <MoreHorizontal size={16} />
        </button>
        <span className={styles.divider} />
        <button className={styles.iconBtn} type="button" aria-label="Expand">
          <Maximize2 size={15} />
        </button>
      </div>

      <div className={styles.metaCardBody}>
        <div className={styles.metaTitle}>{title}</div>
        <div className={styles.metaAuthor}>
          <span className={styles.avatar} style={avatarStyle(tint)}>
            {ownerInitial}
          </span>
          {ownerLabel}
        </div>

        <div className={styles.metaFields}>
          <div className={styles.metaRow}>
            <span className={styles.metaKey}>
              <CalendarDays size={16} /> Date Created:
            </span>
            <span className={styles.metaVal}>{createdAt}</span>
          </div>

          <div className={styles.metaRow}>
            <span className={styles.metaKey}>
              <Triangle size={15} /> Status:
            </span>
            <span className={styles.metaVal}>
              <span className={styles.pill}>Active</span>
            </span>
          </div>

          <div className={styles.metaRow}>
            <span className={styles.metaKey}>
              <Flag size={15} /> Visibility:
            </span>
            <span className={styles.metaVal}>
              <span className={styles.pillBlue}>{scopeLabel}</span>
            </span>
          </div>

          <div className={styles.metaRow}>
            <span className={styles.metaKey}>
              <Users size={16} /> Access:
            </span>
            <span className={styles.metaVal}>{accessLabel}</span>
          </div>

          {teams && teams.length > 0 ? (
            <div className={styles.metaRowTop}>
              <span className={styles.metaKey}>
                <UsersRound size={16} /> Teams:
              </span>
              <span className={styles.metaTeams}>
                {teams.map((t) => (
                  <TeamChip key={t.name} name={t.name} color={t.color} />
                ))}
              </span>
            </div>
          ) : null}

          <div className={styles.metaRow}>
            <span className={styles.metaKey}>
              <CalendarCheck size={16} /> Last Updated:
            </span>
            <span className={styles.metaVal}>{updatedAt}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tinted initials chip used as the avatar fallback (no profile fetch yet). */
function avatarStyle(tint: string): React.CSSProperties {
  return {
    background: tint,
    color: "var(--text-on-invert)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "var(--text-micro)",
    fontWeight: 600,
  };
}
