export type ConfigMode = "build" | "member";

/** What the build pane's outline has selected. */
export type GuideSelection =
  | { type: "mission" }
  | { type: "guardrails" }
  | { type: "step"; id: string }
  | { type: "rollout" };

export type ArtifactKind = "file" | "knowledge-base" | "skill";

export type GuardrailPolicy = "always" | "ask" | "never";

export type AdoptionStatus = "complete" | "drifted" | "not-started";

/** A tool/MCP server each member's agent must be connected to. */
export interface ConnectStep {
  kind: "connect";
  id: string;
  name: string;
  category: string;
  required: boolean;
  /** One-liner under the name — outline caption + member card subtitle. */
  summary: string;
  /** Human explanation of how the team uses this tool. */
  whyText: string;
  /** Where the member goes to connect ("" = no link). */
  linkLabel: string;
  linkHref: string;
  /** Terminal command that sets the connection up ("" = none). */
  setupCommand: string;
  /** Plain-language setup guidance shown to the member. */
  memberNote: string;
  /** Blurb served to the member's agent over MCP once connected. */
  agentContext: string;
  scopes: string[];
  /** Mocked per-member state for the Member view preview. */
  sampleDone: boolean;
}

/** A field/section the created artifact should include. */
export interface StructureField {
  name: string;
  hint: string;
}

/** Something each member's agent creates by following a prompt. */
export interface TaskStep {
  kind: "task";
  id: string;
  title: string;
  artifact: ArtifactKind;
  estMinutes: number;
  /** One-liner under the title — outline caption + member card subtitle. */
  summary: string;
  /** Longer what-and-why shown to the member. */
  detail: string;
  /** The prompt the member pastes to their agent. */
  agentPrompt: string;
  /** Acceptance criteria — how the agent knows it's finished. */
  doneWhen: string[];
  /** Template fields the artifact should include (may be empty). */
  structure: StructureField[];
  /** Mocked per-member state for the Member view preview. */
  sampleDone: boolean;
}

export type SetupStep = ConnectStep | TaskStep;

export interface GuardrailRule {
  id: string;
  policy: GuardrailPolicy;
  text: string;
}

export interface MemberAdoption {
  id: string;
  name: string;
  role: string;
  status: AdoptionStatus;
  lastSync: string;
  activity: string;
}

/** One template the mission editor can append. */
export interface MissionStarter {
  label: string;
  text: string;
}

/** The whole team profile the configuration page edits. */
export interface AgentGuide {
  teamName: string;
  version: number;
  updatedAt: string;
  publishedBy: string;
  /** Edits since the published version (mocked). */
  draftCount: number;
  /** Base instructions prepended to every agent session. */
  mission: string;
  steps: SetupStep[];
  guardrails: GuardrailRule[];
  members: MemberAdoption[];
  /** Served live over MCP — managed in their own tabs, listed here read-only. */
  autoServed: { skills: string[]; knowledgeBases: string[] };
}
