"use client";

/**
 * What it receives: rules set on the category, overridden per model, narrowed by segment. Every row
 * shows its value and where the value comes from. Publishing walks a version from draft to Test to
 * Live. Dopl never rewrites a message, so nothing here offers to.
 */
import { ChevronDown, Lock } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, ICON_SM, PillMenu, PopMenu, SplitButton, TwoLine } from "../_design/ui";
import { RuleRow, SplitLayout } from "../_design/ui-output";
import { Between, FilterRow, Grow, ListRow, MenuItem, Row, Text, Toast, Toolbar } from "../_design/ui-page";
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
import { since } from "../_components/ui";
import { FieldRow } from "./receives-fields";
import { ReceivesPreview } from "./receives-preview";

export { ReceivesPreview };

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

function VersionBar({ editor, say }: { editor: ReceivesEditor; say: (text: string) => void }) {
  const { state, modelId, categoryId } = editor;
  const testRules = state.versions.find((v) => v.n === state.test)?.rules;
  const dirty = !testRules || !rulesEqual(state.draft, testRules);
  const canPromote = state.test !== 0 && state.test !== state.live;
  const category = categoryById(categoryId).name;
  const scopes = [
    { value: "category", label: `${category}, all models` },
    { value: "model", label: `${modelById(modelId).name} only` },
  ];
  const publish = () => {
    const n = Math.max(0, ...state.versions.map((v) => v.n)) + 1;
    editor.write((s) => ({
      ...s,
      test: n,
      versions: [{ n, at: minsAgo(0), by: MEMBERS[2].name, note: `${countOverrides(s.draft)} overrides on ${category}`, rules: s.draft }, ...s.versions],
    }));
    say(`Published v${n} to Test`);
  };
  const promote = () => {
    editor.write((s) => ({ ...s, live: s.test }));
    say(`Promoted v${state.test} to Live`);
  };
  const publishLive = () => {
    const n = Math.max(0, ...state.versions.map((v) => v.n)) + 1;
    editor.write((s) => ({
      ...s,
      test: n,
      live: n,
      versions: [{ n, at: minsAgo(0), by: MEMBERS[2].name, note: `${countOverrides(s.draft)} overrides on ${category}`, rules: s.draft }, ...s.versions],
    }));
    say(`Published v${n} to Test and Live`);
  };
  return (
    <Toolbar>
      <Between>
        <FilterRow>
          <PillMenu stable label={scopes.find((o) => o.value === editor.scopeKind)!.label} value={editor.scopeKind} options={scopes} onChange={(v) => editor.setScopeKind(v as "category" | "model")} />
          <PillMenu stable label={SEGMENTS.find((o) => o.value === editor.segment)?.label ?? "Segment"} value={editor.segment} options={SEGMENTS} onChange={(v) => editor.setSegment(v as Segment)} />
          {dirty ? <Badge tone="warn">Draft has changes</Badge> : <Badge>Draft matches Test</Badge>}
        </FilterRow>
        <Row>
          <Badge tone="ring">Test v{state.test || "none"}</Badge>
          <Badge tone="ok" dot>Live v{state.live || "none"}</Badge>
          {dirty ? (
            <PopMenu
              right
              label="More publish options"
              trigger={(_, toggle) => (
                <SplitButton moreLabel="More publish options" more={<ChevronDown {...ICON_SM} />} onClick={publish} onMore={toggle}>
                  Publish to Test
                </SplitButton>
              )}
            >
              {(close) => (
                <MenuItem
                  onClick={() => {
                    publishLive();
                    close();
                  }}
                >
                  Publish and promote to Live
                </MenuItem>
              )}
            </PopMenu>
          ) : (
            <Button variant="ink" disabled={!canPromote} onClick={promote}>
              Promote to Live
            </Button>
          )}
        </Row>
      </Between>
    </Toolbar>
  );
}

function Versions({ editor, say }: { editor: ReceivesEditor; say: (text: string) => void }) {
  const { state } = editor;
  const rollback = (n: number) => {
    const version = state.versions.find((v) => v.n === n);
    if (!version) return;
    editor.write((s) => ({ ...s, live: n, test: n, draft: version.rules }));
    say(`Rolled back to v${n}`);
  };
  return (
    <Card>
      <Text kind="h3">Versions</Text>
      <div>
        {state.versions.map((v, i) => (
          <ListRow key={v.n} line={i < state.versions.length - 1}>
            <Text kind="mono">v{v.n}</Text>
            <TwoLine strong={false} title={v.note} sub={`${v.by}, ${since(v.at)}`} />
            <Grow />
            {v.n === state.live && <Badge tone="ok" dot>Live</Badge>}
            {v.n === state.test && <Badge tone="ring">Test</Badge>}
            {v.n !== state.live && (
              <Button size="sm" variant="ghost" onClick={() => rollback(v.n)}>
                Roll back
              </Button>
            )}
          </ListRow>
        ))}
      </div>
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
    <Card>
      <Between>
        <Text kind="h3">Safety floors</Text>
        <Lock {...ICON_SM} aria-hidden="true" />
      </Between>
      <div>
        {rows.map(([label, value]) => (
          <RuleRow key={label} label={label} actions={null}>
            <Text>{value}</Text>
          </RuleRow>
        ))}
      </div>
    </Card>
  );
}

export function ReceivesTab({ editor, onCapabilities }: { editor: ReceivesEditor; onCapabilities: () => void }) {
  const { state: portal } = usePortal();
  const [notice, setNotice] = useState<string | null>(null);
  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((now) => (now === text ? null : now)), 3200);
  };
  const caps = Object.values(portal.capabilities[editor.modelId] ?? {}).filter((c) => c?.on).length;
  const total = modelById(editor.modelId).capabilities.length;
  return (
    <>
      <VersionBar editor={editor} say={say} />
      <SplitLayout
        left={
          <>
            {FIELD_GROUPS.map((group) => (
              <Card key={group.title} label={group.title}>
                <Text kind="h3">{group.title}</Text>
                <div>
                  {group.fields.map((field) => (
                    <FieldRow key={field.key} field={field} editor={editor} />
                  ))}
                </div>
              </Card>
            ))}
            <Card>
              <Between>
                <TwoLine title={<Text kind="h3">What it may do</Text>} sub={`${caps} of ${total} capabilities allowed`} />
                <Button size="sm" onClick={onCapabilities}>
                  Open capabilities
                </Button>
              </Between>
            </Card>
            <Floors editor={editor} />
            <Versions editor={editor} say={say} />
          </>
        }
        right={<ReceivesPreview editor={editor} />}
      />
      {notice && <Toast>{notice}</Toast>}
    </>
  );
}
