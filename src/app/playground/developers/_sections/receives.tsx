"use client";

/**
 * What it receives: rules set on the category, overridden per model, narrowed by segment. Every row
 * shows its value and where the value comes from. Publishing walks a version from draft to Test to
 * Live. Dopl never rewrites a message, so nothing here offers to.
 */
import { useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { minsAgo } from "../_data/company";
import { MEMBERS } from "../_data/company";
import { categoryById, modelById, type CategoryId, type ModelId } from "../_data/catalog";
import {
  FIELD_GROUPS,
  SAMPLE_MESSAGES,
  SEGMENTS,
  countOverrides,
  rulesEqual,
  seedReceives,
  type ReceivesState,
  type RuleScope,
  type RuleSet,
  type Segment,
} from "../_data/receives";
import { usePortal } from "../_components/portal-store";
import { Card, FactChip, Filter, ov, since } from "../_components/ui";
import { FieldRow } from "./receives-fields";

export { ReceivesPreview } from "./receives-preview";

export interface ReceivesEditor {
  categoryId: CategoryId;
  modelId: ModelId;
  state: ReceivesState;
  scope: RuleScope;
  scopeKind: "category" | "model";
  setScopeKind: (kind: "category" | "model") => void;
  segment: Segment;
  setSegment: (segment: Segment) => void;
  sample: (typeof SAMPLE_MESSAGES)[number]["value"];
  setSample: (sample: (typeof SAMPLE_MESSAGES)[number]["value"]) => void;
  setDraft: (fn: (rules: RuleSet) => RuleSet) => void;
  write: (fn: (state: ReceivesState) => ReceivesState) => void;
}

export function useReceivesEditor(categoryId: CategoryId, modelId: ModelId): ReceivesEditor {
  const { state: portal, update } = usePortal();
  const state = portal.receives[categoryId] ?? seedReceives(categoryId);
  const [scopeKind, setScopeKind] = useState<"category" | "model">("category");
  const [segment, setSegment] = useState<Segment>("all");
  const [sample, setSample] = useState<ReceivesEditor["sample"]>("short");
  const write = (fn: (s: ReceivesState) => ReceivesState) =>
    update((s) => ({ ...s, receives: { ...s.receives, [categoryId]: fn(s.receives[categoryId] ?? seedReceives(categoryId)) } }));
  return {
    categoryId,
    modelId,
    state,
    scope: scopeKind === "category" ? "category" : modelId,
    scopeKind,
    setScopeKind,
    segment,
    setSegment,
    sample,
    setSample,
    setDraft: (fn) => write((s) => ({ ...s, draft: fn(s.draft) })),
    write,
  };
}

function VersionBar({ editor }: { editor: ReceivesEditor }) {
  const { state, modelId, categoryId } = editor;
  const testRules = state.versions.find((v) => v.n === state.test)?.rules;
  const dirty = !testRules || !rulesEqual(state.draft, testRules);
  const canPromote = state.test !== 0 && state.test !== state.live;
  const category = categoryById(categoryId).name;

  const publish = () => {
    const n = Math.max(0, ...state.versions.map((v) => v.n)) + 1;
    editor.write((s) => ({
      ...s,
      test: n,
      versions: [{ n, at: minsAgo(0), by: MEMBERS[2].name, note: `${countOverrides(s.draft)} overrides on ${category}`, rules: s.draft }, ...s.versions],
    }));
    toast({ title: `Published v${n} to Test` });
  };
  const promote = () => {
    editor.write((s) => ({ ...s, live: s.test }));
    toast({ title: `Promoted v${state.test} to Live` });
  };

  return (
    <section className={cn("white-card", ov.card)} aria-label="Rules">
      <div className="flex flex-wrap items-center gap-1.5">
        <Filter
          label="Set on"
          value={editor.scopeKind}
          options={[
            { value: "category", label: `${category}, all models` },
            { value: "model", label: `${modelById(modelId).name} only` },
          ]}
          onChange={editor.setScopeKind}
        />
        <Filter label="Segment" value={editor.segment} options={SEGMENTS} onChange={editor.setSegment} />
        <span className="ml-auto flex items-center gap-1.5">
          {dirty ? <StatusPill tone="attention">Draft has changes</StatusPill> : <StatusPill>Draft matches Test</StatusPill>}
          <FactChip>Test v{state.test || "none"}</FactChip>
          <FactChip>Live v{state.live || "none"}</FactChip>
          <button type="button" disabled={!dirty} className={cn(pillButton("outline", "md"), "disabled:opacity-60")} onClick={publish}>
            Publish to Test
          </button>
          <button type="button" disabled={!canPromote} className={cn(pillButton("ink", "md"), "disabled:opacity-60")} onClick={promote}>
            Promote to Live
          </button>
        </span>
      </div>
    </section>
  );
}

function Versions({ editor }: { editor: ReceivesEditor }) {
  const { state } = editor;
  const rollback = (n: number) => {
    const version = state.versions.find((v) => v.n === n);
    if (!version) return;
    editor.write((s) => ({ ...s, live: n, test: n, draft: version.rules }));
    toast({ title: `Rolled back to v${n}` });
  };
  return (
    <Card title="Versions" count={state.versions.length}>
      <ul className={ov.rows}>
        {state.versions.map((v) => (
          <li key={v.n} className={ov.row}>
            <span className={cn(ov.mono, "w-7")}>v{v.n}</span>
            <span className={ov.rowMain}>
              <span className={ov.rowTitle}>{v.note}</span>
              <span className={ov.rowMeta}>
                {v.by}, {since(v.at)}
              </span>
            </span>
            {v.n === state.live && (
              <StatusPill tone="live" dot bare>
                Live
              </StatusPill>
            )}
            {v.n === state.test && <StatusPill>Test</StatusPill>}
            {v.n !== state.live && (
              <button type="button" className={pillButton("quiet", "xs")} onClick={() => rollback(v.n)}>
                Roll back
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Floors({ editor }: { editor: ReceivesEditor }) {
  const model = modelById(editor.modelId);
  const rows = [
    ["Display limit", `${model.floor.maxLines} lines, ${model.floor.maxChars} characters on ${model.name}`],
    ["Risk tier T4", "Confirmed on every call"],
    ["Message text", "Passed through unchanged"],
    ["User blocks and quiet hours", "Always honoured"],
  ];
  return (
    <Card title="Safety floors" aside={<Lock size={12} aria-hidden="true" className="text-text-muted" />}>
      <ul className={ov.rows}>
        {rows.map(([label, value]) => (
          <li key={label} className={ov.row}>
            <span className={ov.rowMain}>
              <span className={ov.rowTitle}>{label}</span>
            </span>
            <span className="text-caption text-text-secondary">{value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ReceivesTab({ editor, onCapabilities }: { editor: ReceivesEditor; onCapabilities: () => void }) {
  const { state: portal } = usePortal();
  const caps = Object.values(portal.capabilities[editor.modelId] ?? {}).filter((c) => c?.on).length;
  const total = modelById(editor.modelId).capabilities.length;
  return (
    <>
      <VersionBar editor={editor} />
      {FIELD_GROUPS.map((group) => (
        <div key={group.title} className="contents">
          {group.title === "If too long" && (
            <Card title="What it may do">
              <div className={ov.row}>
                <span className={ov.rowMain}>
                  <span className={ov.rowTitle}>
                    {caps} of {total} capabilities allowed
                  </span>
                </span>
                <button type="button" className={pillButton("outline", "sm")} onClick={onCapabilities}>
                  Open capabilities
                </button>
              </div>
            </Card>
          )}
          <Card title={group.title}>
            <ul className={ov.rows}>
              {group.fields.map((field) => (
                <FieldRow key={field.key} field={field} editor={editor} />
              ))}
            </ul>
          </Card>
        </div>
      ))}
      <Floors editor={editor} />
      <Versions editor={editor} />
    </>
  );
}
