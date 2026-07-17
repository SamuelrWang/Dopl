"use client";

import { CalendarCheck, CalendarDays, Flag, Users, UsersRound } from "lucide-react";
import { KB_BASE_DESCRIPTION_MAX } from "@/config";
import { cn } from "@/shared/lib/utils";
import { TeamChip } from "@/features/members/components/team-bits";
import styles from "../knowledge-v2.module.css";

export interface MetaTeamRef {
  name: string;
  color: string | null;
}

export interface MetaCardProps {
  /** Editable base name (live, persisted by the parent's save hook). */
  name: string;
  /** Editable agent-facing description. */
  description: string;
  /** Viewers get read-only fields; owners/editors can type. */
  canEdit: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  /** Flush a pending debounced save (called on blur). */
  onFlush: () => void;
  createdAt: string;
  updatedAt: string;
  scopeLabel: string;
  /** Who can reach this base — derived from visibility + access mode. */
  accessLabel: string;
  /** Teams granted access (teams-mode bases). Empty/undefined hides the row. */
  teams?: MetaTeamRef[];
}

/**
 * The base overview card: a label strip over a body holding the two editable
 * fields (name + description, in concave wells) and the read-only meta grid
 * (dates, visibility, access, teams). All values are real — name/description
 * persist via the base PATCH route; the rest is derived from the base row.
 */
export function MetaCard({
  name,
  description,
  canEdit,
  onNameChange,
  onDescriptionChange,
  onFlush,
  createdAt,
  updatedAt,
  scopeLabel,
  accessLabel,
  teams,
}: MetaCardProps) {
  return (
    <div className={styles.metaCard}>
      <div className={styles.metaCardHead}>
        <span className={styles.label}>Details</span>
      </div>

      <div className={styles.metaCardBody}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Name</span>
          <input
            type="text"
            className={cn("concave-field", styles.fieldInput)}
            value={name}
            readOnly={!canEdit}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onFlush}
            placeholder="Untitled knowledge base"
          />
        </label>

        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabelRow}>
            <span className={styles.fieldLabel}>Description</span>
            {canEdit ? (
              <span className={styles.fieldCount}>
                {description.length}/{KB_BASE_DESCRIPTION_MAX}
              </span>
            ) : null}
          </span>
          <textarea
            className={cn("concave-field", styles.fieldTextarea)}
            value={description}
            readOnly={!canEdit}
            onChange={(e) => onDescriptionChange(e.target.value)}
            onBlur={onFlush}
            rows={3}
            placeholder="What's in this knowledge base? Agents see this when listing bases."
          />
        </label>

        <div className={styles.metaFields}>
          <div className={styles.metaRow}>
            <span className={styles.metaKey}>
              <CalendarDays size={16} /> Date Created:
            </span>
            <span className={styles.metaVal}>{createdAt}</span>
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
