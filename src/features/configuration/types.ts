export type ConfigMode = "manager" | "employee";

export type ConnectionStatus = "auto" | "connected" | "action-needed";

export type MemberSetupStatus = "complete" | "drifted" | "not-started";

export type GuardrailKind = "allow" | "ask" | "block";

export interface ProfileSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  tags: string[];
  runsPerWeek: number;
  lastUsed: string;
}

export interface ProfileConnection {
  id: string;
  name: string;
  category: string;
  required: boolean;
  status: ConnectionStatus;
  /** One-liner shown on the collapsed card. */
  tagline: string;
  /** Human explanation of how the team uses this tool. */
  teamUsage: string;
  /** The blurb the employee's agent reads — how this tool fits its workflows. */
  agentContext: string;
  /** Terminal command that sets the connection up, when one exists. */
  setupCommand: string | null;
  /** Plain-language setup guidance (OAuth flow, where creds come from). */
  setupNote: string;
  scopes: string[];
}

export interface ProfileKnowledgeBase {
  id: string;
  name: string;
  entryCount: number;
  enabled: boolean;
  tint: string;
  updatedAt: string;
  visibility: string;
  summary: string;
}

export interface GuardrailRule {
  id: string;
  kind: GuardrailKind;
  text: string;
}

export interface MemberStatus {
  id: string;
  name: string;
  role: string;
  initial: string;
  status: MemberSetupStatus;
  lastSync: string;
  agentActivity: string;
}

export interface AgentProfile {
  teamName: string;
  version: number;
  updatedAt: string;
  publishedBy: string;
  instructions: string;
  skills: ProfileSkill[];
  connections: ProfileConnection[];
  knowledgeBases: ProfileKnowledgeBase[];
  guardrails: GuardrailRule[];
  members: MemberStatus[];
}
