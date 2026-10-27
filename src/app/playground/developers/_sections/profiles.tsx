"use client";

import { useState } from "react";
import type { ContextProfile, ProfileOverflow } from "@dopl/contracts/device-sdk";
import { ContextProfileSchema } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { IDENTITY_NAME_TEXT, LABEL_TEXT_MUTED } from "@/shared/ui/section-heading";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { usePortal } from "../_components/portal-context";
import { Card, Chip, KIND_LABEL, Muted, PageHeader } from "../_components/ui";
import type { DemoProfile } from "../_data/fixtures";

const overflowLabel = (o: ProfileOverflow) => (typeof o === "string" ? o : `send_to ${o.send_to}`);

function matchLabel(p: ContextProfile): string {
  const { kind, model, posture } = p.match;
  return [kind && KIND_LABEL[kind], model, posture].filter(Boolean).join(" · ");
}

export function ProfilesSection() {
  const { fx } = usePortal();
  return (
    <>
      <PageHeader title="Context profiles" />
      <div className="flex flex-col gap-4">
        {fx.profiles.map((p) =>
          p.source === "project" ? <OverrideCard key={p.profile.id} row={p} /> : <ProfileCard key={p.profile.id} row={p} />
        )}
      </div>
    </>
  );
}

function ProfileHead({ row }: { row: DemoProfile }) {
  const p = row.profile;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className={IDENTITY_NAME_TEXT}>{matchLabel(p)}</h2>
        <span className="font-mono text-micro text-text-muted">
          {p.id} v{p.version ?? 1}
        </span>
      </div>
      <Chip mono={false}>{row.source === "project" ? "Project override" : "Dopl default"}</Chip>
    </div>
  );
}

function Facts({ p }: { p: ContextProfile }) {
  const out = p.output;
  const facts: Array<[string, string]> = [
    ["Output", [out.format, out.max_lines && `${out.max_lines} lines`, out.max_chars && `${out.max_chars} chars`].filter(Boolean).join(" · ")],
    ["Overflow", overflowLabel(p.overflow)],
    ["Confirmation", Object.entries(p.confirmation ?? {}).map(([t, m]) => `${t} ${m}`).join(" · ") || "—"],
  ];
  return (
    <>
      <dl className="card-well grid grid-cols-3 gap-x-4 px-3.5 py-3">
        {facts.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className={LABEL_TEXT_MUTED}>{k}</dt>
            <dd className="font-mono text-small text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-1">
        {p.allowed_capabilities.map((c) => (
          <Chip key={c}>{c}</Chip>
        ))}
      </div>
    </>
  );
}

function ProfileCard({ row }: { row: DemoProfile }) {
  return (
    <Card>
      <ProfileHead row={row} />
      <p className="text-lead text-text-secondary">{row.profile.prompt_append}</p>
      <Facts p={row.profile} />
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
    <Card className="border-border-strong">
      <ProfileHead row={row} />
      {editing ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_TEXT_MUTED}>prompt_append</span>
            <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={cn(RAISED_INPUT, "resize-y px-3 py-2")} />
          </label>
          <div className="flex gap-3">
            {(
              [
                ["max_lines", maxLines, setMaxLines],
                ["max_chars", maxChars, setMaxChars],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="flex w-32 flex-col gap-1.5">
                <span className={LABEL_TEXT_MUTED}>{label}</span>
                <input inputMode="numeric" value={value} onChange={(e) => set(e.target.value)} className={cn(RAISED_INPUT, "h-8 px-3 font-mono")} />
              </label>
            ))}
          </div>
          {!check.success && <span className="text-small text-danger">{check.error.issues[0]?.message}</span>}
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
          <p className="text-lead text-text-secondary">{p.prompt_append}</p>
          <Facts p={p} />
          <div className="flex items-center justify-between">
            <Muted>display_template {p.display_template ?? "—"}</Muted>
            <button type="button" className={pillButton("outline", "sm")} onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
