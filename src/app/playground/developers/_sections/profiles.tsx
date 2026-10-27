"use client";

import { useState } from "react";
import type { ContextProfile, ProfileOverflow } from "@dopl/contracts/device-sdk";
import { ContextProfileSchema } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { usePortal } from "../_components/portal-context";
import { Card, Chip, Chips, Facts, KIND_LABEL, ov } from "../_components/ui";
import type { DemoProfile } from "../_data/fixtures";

const overflowLabel = (o: ProfileOverflow) => (typeof o === "string" ? o : `send_to ${o.send_to}`);

function matchLabel(p: ContextProfile): string {
  const { kind, model, posture } = p.match;
  return [kind && KIND_LABEL[kind], model, posture].filter(Boolean).join(" · ");
}

export function ProfilesSection() {
  const { fx } = usePortal();
  return (
    <div className="grid grid-cols-2 items-start gap-3.5">
      {fx.profiles.map((p) =>
        p.source === "project" ? <OverrideCard key={p.profile.id} row={p} /> : <ProfileCard key={p.profile.id} row={p} />
      )}
    </div>
  );
}

function Source({ row }: { row: DemoProfile }) {
  return row.source === "project" ? <StatusPill dot>Project override</StatusPill> : <StatusPill>Dopl default</StatusPill>;
}

function Body({ p }: { p: ContextProfile }) {
  const out = p.output;
  return (
    <>
      <span className={cn(ov.rowMeta, "font-mono")}>
        {p.id} v{p.version ?? 1}
      </span>
      <p className="text-body text-text-secondary">{p.prompt_append}</p>
      <Facts
        facts={[
          ["Output", [out.format, out.max_lines && `${out.max_lines} lines`, out.max_chars && `${out.max_chars} chars`].filter(Boolean).join(" · ")],
          ["Overflow", overflowLabel(p.overflow)],
          ["Confirmation", Object.entries(p.confirmation ?? {}).map(([t, m]) => `${t} ${m}`).join(" · ") || "—"],
        ]}
      />
      <Chips>
        {p.allowed_capabilities.map((c) => (
          <Chip key={c}>{c}</Chip>
        ))}
      </Chips>
    </>
  );
}

function ProfileCard({ row }: { row: DemoProfile }) {
  return (
    <Card title={matchLabel(row.profile)} aside={<Source row={row} />}>
      <Body p={row.profile} />
    </Card>
  );
}

/** The project's own profile: editable in local state, validated by the real contract schema. */
function OverrideCard({ row }: { row: DemoProfile }) {
  const { saveOverride } = usePortal();
  const p = row.profile;
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(p.prompt_append);
  const [maxLines, setMaxLines] = useState(String(p.output.max_lines ?? ""));
  const [maxChars, setMaxChars] = useState(String(p.output.max_chars ?? ""));

  const draft: ContextProfile = {
    ...p,
    prompt_append: prompt,
    output: {
      ...p.output,
      max_lines: maxLines.trim() ? Number(maxLines) : undefined,
      max_chars: maxChars.trim() ? Number(maxChars) : undefined,
    },
  };
  const check = ContextProfileSchema.safeParse(draft);

  return (
    <Card
      title={matchLabel(p)}
      aside={
        <>
          <Source row={row} />
          {!editing && (
            <button type="button" className={pillButton("outline", "sm")} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </>
      }
    >
      {editing ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={ov.cellLabel}>prompt_append</span>
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={cn(RAISED_INPUT, "resize-y px-3 py-2")} />
          </label>
          <div className="flex gap-3">
            {(
              [
                ["max_lines", maxLines, setMaxLines],
                ["max_chars", maxChars, setMaxChars],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="flex w-32 flex-col gap-1.5">
                <span className={ov.cellLabel}>{label}</span>
                <input inputMode="numeric" value={value} onChange={(e) => set(e.target.value)} className={cn(RAISED_INPUT, "h-8 px-3 font-mono")} />
              </label>
            ))}
          </div>
          {!check.success && <span className="text-caption text-danger">{check.error.issues[0]?.message}</span>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!check.success}
              className={cn(pillButton("ink", "md"), "disabled:opacity-60")}
              onClick={() => {
                if (!check.success) return;
                saveOverride(check.data);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button type="button" className={pillButton("quiet", "md")} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <Body p={p} />
          <span className={cn(ov.rowMeta, "font-mono")}>display_template {p.display_template ?? "—"}</span>
        </>
      )}
    </Card>
  );
}
