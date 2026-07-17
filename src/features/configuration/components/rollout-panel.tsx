"use client";

import { RefreshCw, Send } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { SectionBox } from "@/shared/ui/section-box";
import type { AgentGuide } from "../types";
import {
  AdoptionPill,
  DetailHeader,
  DetailShell,
  IdentityBlock,
  KindTile,
} from "./config-fields";

/**
 * Rollout detail — publish state plus who on the team has actually run
 * the guide. Static preview: the publish button flips nothing yet.
 */
export function RolloutPanel({ guide }: { guide: AgentGuide }) {
  const setUp = guide.members.filter((m) => m.status === "complete").length;

  return (
    <DetailShell
      header={<DetailHeader kind="Rollout" meta={`v${guide.version} live`} />}
    >
      <IdentityBlock
        tile={<KindTile icon={Send} size="md" />}
        name="Publish & adoption"
        summary="Push the guide to every connected agent, then watch who's on it."
      />

      <SectionBox label="Publish" meta={`${guide.draftCount} unpublished changes`}>
        <div className="flex flex-col gap-3 p-3">
          <div className="bento flex flex-col divide-y divide-border-subtle px-3.5">
            <MetaRow label="Published version" value={`v${guide.version}`} />
            <MetaRow label="Last updated" value={guide.updatedAt} />
            <MetaRow label="Published by" value={guide.publishedBy} />
          </div>
          <button
            type="button"
            className="auth-btn-3d w-full rounded-lg px-3 py-2 text-lead font-semibold text-white"
          >
            Publish v{guide.version + 1} to the team
          </button>
          <p className="text-caption leading-relaxed text-text-muted">
            Publishing pushes instructions, agent context, and guardrails to
            every connected agent on its next run. Members on older versions
            show as out of date below.
          </p>
        </div>
      </SectionBox>

      <SectionBox
        label="Team adoption"
        meta={`${setUp} of ${guide.members.length} set up`}
      >
        <div className="divide-y divide-border-subtle">
          {guide.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <Avatar
                person={{
                  userId: m.id,
                  email: null,
                  displayName: m.name,
                  avatarUrl: null,
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-body font-semibold text-text-primary">
                    {m.name}
                  </span>
                  <span className="text-caption text-text-muted">{m.role}</span>
                </div>
                <div className="flex items-center gap-1.5 text-caption text-text-muted">
                  <span>{m.activity}</span>
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-1">
                    <RefreshCw size={9} /> {m.lastSync}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <AdoptionPill status={m.status} />
                {m.status !== "complete" && (
                  <button
                    type="button"
                    className="btn-light rounded-md px-2 py-0.5 text-caption font-medium text-text-primary"
                  >
                    Nudge
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionBox>
    </DetailShell>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-body">
      <span className="text-text-secondary">{label}</span>
      <span className="font-semibold text-text-primary">{value}</span>
    </div>
  );
}
