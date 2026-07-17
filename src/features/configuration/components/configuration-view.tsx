"use client";

import { useRef, useState } from "react";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { MOCK_GUIDE } from "../mock-data";
import type {
  AgentGuide,
  ConfigMode,
  ConnectStep,
  GuideSelection,
  SetupStep,
  TaskStep,
} from "../types";
import { ConnectEditor } from "./connect-editor";
import { GuideOutline } from "./guide-outline";
import { MemberGuide } from "./member-guide";
import { GuardrailsEditor, MissionEditor } from "./profile-editors";
import { RolloutPanel } from "./rollout-panel";
import { TaskEditor } from "./task-editor";

const MODES = [
  { key: "build", label: "Build" },
  { key: "member", label: "Member view" },
] as const;

/**
 * Configuration page root — static UI preview, everything edits local
 * state only (see ../mock-data.ts). Build mode is the manager's guide
 * builder; Member view is the checklist a teammate walks through.
 */
export function ConfigurationView() {
  const [mode, setMode] = useState<ConfigMode>("build");
  const [guide, setGuide] = useState<AgentGuide>(MOCK_GUIDE);
  const [selection, setSelection] = useState<GuideSelection>({
    type: "step",
    id: MOCK_GUIDE.steps[0]?.id ?? "",
  });
  const nextId = useRef(1);

  const patchGuide = (patch: Partial<AgentGuide>) =>
    setGuide((g) => ({ ...g, ...patch }));

  const patchStep = (id: string, patch: Partial<ConnectStep> | Partial<TaskStep>) =>
    setGuide((g) => ({
      ...g,
      steps: g.steps.map((s) => (s.id === id ? ({ ...s, ...patch } as SetupStep) : s)),
    }));

  const addStep = (kind: SetupStep["kind"]) => {
    const id = `st-new-${nextId.current++}`;
    const step: SetupStep =
      kind === "connect"
        ? {
            kind,
            id,
            name: "New tool",
            category: "",
            required: false,
            summary: "",
            whyText: "",
            linkLabel: "",
            linkHref: "",
            setupCommand: "",
            memberNote: "",
            agentContext: "",
            scopes: [],
            sampleDone: false,
          }
        : {
            kind,
            id,
            title: "New agent task",
            artifact: "file",
            estMinutes: 10,
            summary: "",
            detail: "",
            agentPrompt: "",
            doneWhen: [],
            structure: [],
            sampleDone: false,
          };
    setGuide((g) => ({ ...g, steps: [...g.steps, step] }));
    setSelection({ type: "step", id });
  };

  const deleteStep = (id: string) => {
    setGuide((g) => ({ ...g, steps: g.steps.filter((s) => s.id !== id) }));
    setSelection({ type: "mission" });
  };

  const addGuardrail = () => {
    setGuide((g) => ({
      ...g,
      guardrails: [
        ...g.guardrails,
        { id: `gr-new-${nextId.current++}`, policy: "ask", text: "" },
      ],
    }));
    setSelection({ type: "guardrails" });
  };

  return (
    <div className="page-float flex flex-col antialiased">
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3.5 py-2.5">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="shrink-0 text-title font-semibold tracking-tight text-text-primary">
            Configuration
          </h1>
          <span className="truncate text-caption text-text-muted">
            The setup guide for {guide.teamName}&apos;s agents
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setMode("build");
            setSelection({ type: "rollout" });
          }}
          className="shrink-0 text-caption text-text-muted transition-colors hover:text-text-primary"
        >
          v{guide.version} · {guide.draftCount} unpublished changes
        </button>
        <SegmentedControl
          options={MODES}
          value={mode}
          onChange={setMode}
          className="w-[230px] shrink-0"
        />
      </div>

      {mode === "build" ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <GuideOutline
            guide={guide}
            selection={selection}
            onSelect={setSelection}
            onAddStep={addStep}
            onAddGuardrail={addGuardrail}
          />
          <BuildDetail
            guide={guide}
            selection={selection}
            onPatchGuide={patchGuide}
            onPatchStep={patchStep}
            onDeleteStep={deleteStep}
          />
        </div>
      ) : (
        <MemberGuide guide={guide} />
      )}
    </div>
  );
}

function BuildDetail({
  guide,
  selection,
  onPatchGuide,
  onPatchStep,
  onDeleteStep,
}: {
  guide: AgentGuide;
  selection: GuideSelection;
  onPatchGuide: (patch: Partial<AgentGuide>) => void;
  onPatchStep: (id: string, patch: Partial<ConnectStep> | Partial<TaskStep>) => void;
  onDeleteStep: (id: string) => void;
}) {
  if (selection.type === "guardrails") {
    return <GuardrailsEditor guide={guide} onPatch={onPatchGuide} />;
  }
  if (selection.type === "rollout") {
    return <RolloutPanel guide={guide} />;
  }
  if (selection.type === "step") {
    const index = guide.steps.findIndex((s) => s.id === selection.id);
    const step = guide.steps[index];
    if (step) {
      return step.kind === "connect" ? (
        <ConnectEditor
          step={step}
          stepNumber={index + 1}
          onPatch={(patch) => onPatchStep(step.id, patch)}
          onDelete={() => onDeleteStep(step.id)}
        />
      ) : (
        <TaskEditor
          step={step}
          stepNumber={index + 1}
          onPatch={(patch) => onPatchStep(step.id, patch)}
          onDelete={() => onDeleteStep(step.id)}
        />
      );
    }
  }
  return <MissionEditor guide={guide} onPatch={onPatchGuide} />;
}
