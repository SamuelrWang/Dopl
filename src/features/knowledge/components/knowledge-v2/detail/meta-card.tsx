"use client";

import type { ReactNode } from "react";
import { KB_BASE_DESCRIPTION_MAX } from "@/config";
import { SettingsPanel } from "@/shared/layout/settings-modal/sections/settings-panel";
import { StatusPill } from "@/shared/ui/status-pill";
import { TeamChip } from "@/features/members/components/team-bits";
import { InPlaceDescription, InPlaceTitle } from "@/shared/ui/in-place-fields";
import { StorageMeter } from "../storage-meter";

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
 * The base's head and details — the resting face of the detail column. The name
 * and description are edited in place (the document head's faces, persisted via
 * the base PATCH route); the derived facts are a label/value grid in one white
 * card, storage last.
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
    <>
      <header className="flex flex-col gap-1 px-1">
        <InPlaceTitle
          label="Name"
          value={name}
          readOnly={!canEdit}
          onChange={onNameChange}
          onBlur={onFlush}
          placeholder="Untitled knowledge base"
        />
        <InPlaceDescription
          label="Description for agents"
          multiline
          value={description}
          onChange={onDescriptionChange}
          onBlur={onFlush}
          max={KB_BASE_DESCRIPTION_MAX}
          readOnly={!canEdit}
          placeholder="What's in this knowledge base? Agents see this when listing bases."
        />
      </header>

      <SettingsPanel id="kb-details" label="Details">
        <div className="white-card px-3.5 py-1">
          <dl>
            <Fact label="Visibility">
              <StatusPill>{scopeLabel}</StatusPill>
            </Fact>
            <Fact label="Access">{accessLabel}</Fact>
            {teams && teams.length > 0 ? (
              <Fact label="Teams">
                <span className="flex flex-wrap gap-1.5">
                  {teams.map((t) => (
                    <TeamChip key={t.name} name={t.name} color={t.color} />
                  ))}
                </span>
              </Fact>
            ) : null}
            <Fact label="Created">{createdAt}</Fact>
            <Fact label="Last updated">{updatedAt}</Fact>
          </dl>
          {/* Collapses when the meter renders nothing (either half unknown). */}
          <div className="border-t border-border-default py-3 empty:hidden">
            <StorageMeter
              usedBytes={storageBytes ?? null}
              limitBytes={storageLimit ?? null}
            />
          </div>
        </div>
      </SettingsPanel>
    </>
  );
}

/** One label / value row of the details grid; each row draws its own hairline, none on the first. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-3 border-t border-border-default py-2.5 first:border-t-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="min-w-0 text-body text-text-primary">{children}</dd>
    </div>
  );
}
