"use client";

import { CalendarCheck, CalendarDays, Flag, Users, UsersRound } from "lucide-react";
import { KB_BASE_DESCRIPTION_MAX } from "@/config";
import { cn } from "@/shared/lib/utils";
import {
  SECTION_PANEL_GROUND,
  SectionPanel,
} from "@/shared/ui/section-panel";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { TeamChip } from "@/features/members/components/team-bits";
import { StorageMeter } from "../storage-meter";
import styles from "../knowledge-v2.module.css";

export interface MetaTeamRef {
  name: string;
  color: string | null;
}

export interface MetaCardProps {
  /** Editable base name; persisted by the parent's save hook. */
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
  /** Stored bytes; `null` = unknown → meter hidden, not an empty track. */
  storageBytes?: number | null;
  /** Per-base storage cap in bytes; `null` = unknown. */
  storageLimit?: number | null;
}

/**
 * THE BASE'S DETAILS — the resting face of the detail column: two editable
 * fields (name + description) over a read-only meta grid and the storage bar.
 * Name/description persist via the base PATCH route; the rest is derived from
 * the base row.
 *
 * ⚠ IT IS A FLAT `SectionPanel` NOW, NOT A CARD (Samuel's ruling, 2026-08-28).
 * It was a 14px-radius bordered box with its own `--card-surface-subtle` header
 * STRIP — a framed surface inside a pane that was itself framed inside a panel.
 * The section language here is the one both /home faces already share
 * (`shared/ui/section-panel.tsx`), and the GROUND is the kit's default for a
 * workspace page; on /home the record pane repaints it in one rule
 * (`pages/home/home.module.css › .frame :global([data-section-panel])`), so
 * this file never names that palette.
 *
 * ⚠ THE FIELDS ARE RAISED, NOT PRESSED IN. They wore `.concave-field`; they
 * wear `shared/ui/wells.ts › RAISED_INPUT` — Samuel's reference text-control
 * face — with height and padding supplied HERE, which is that recipe's own
 * division of labour. Do not add a `.concave-*` class back to this file: a
 * pressed-in well on a flat panel is the mismatch the overhaul removed.
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
  storageBytes,
  storageLimit,
}: MetaCardProps) {
  return (
    <SectionPanel id="kb-details" label="Details" className={SECTION_PANEL_GROUND}>
      <div className="flex flex-col gap-4 px-1 pt-0.5">
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Name</span>
          <input
            type="text"
            className={cn(RAISED_INPUT, "h-9 px-3 font-medium")}
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
            className={cn(RAISED_INPUT, "px-3 py-2", styles.fieldBlock)}
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

        {/* Storage sits UNDER the meta grid rather than inside it: it is the
            only value here that is a quantity against a ceiling, and the grid's
            key/value rows have nowhere to put a bar. Renders nothing when
            either half is unknown. */}
        <StorageMeter
          usedBytes={storageBytes ?? null}
          limitBytes={storageLimit ?? null}
          className="mt-0"
        />
      </div>
    </SectionPanel>
  );
}
