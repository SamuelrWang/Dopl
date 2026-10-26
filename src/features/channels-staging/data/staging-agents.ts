/**
 * STAGING DATA — every agent the /channels staging page knows: the landing demo's six
 * (`banner-demo/demo-data.ts › AGENT_INDEX`, imported, not copied) plus invented extras for
 * the channels the demo only lists in its column (deploys, flaky-tests, api-v2-migration,
 * design-review). Same naming style as the demo: short Title Case, named for the job.
 *
 * Also the identity face table (owner photo + runtime badge + colour) that
 * `banner-demo/demo-identities.ts › identityFace` answers for the demo's six, extended to
 * the extras. Pure data: no fetch, no bridge.
 */

import type { AgentColorKey } from "@dopl/contracts";
import type { AgentRosterEntry } from "@/features/channels/components/view-model";
import { pickAgentColor } from "@/features/channels/lib/agent-color-pick";
import { webRuntimeLogo } from "@/shared/ui/runtime-logo";
import {
  AGENT_COLORS,
  AGENT_INDEX,
  AGENT_RUNTIME,
  FACE,
  PRIOR_AGENT_COLOR,
  U,
} from "@/features/marketing/components/banner-demo/demo-data";
import {
  identityFace as demoIdentityFace,
  type IdentityFace,
} from "@/features/marketing/components/banner-demo/demo-identities";

export type { IdentityFace };

/** 8-char instance ids, `^[a-z][a-z0-9]{7}$`, like the demo's. */
export const EXTRA_AGENT_IDS = {
  deployWatch: "dwatch01",
  quarantine: "qrunner1",
  schemaDiff: "schemad1",
  clientGen: "clientg1",
  uiCritic: "uicrit01",
  tokenSync: "tokensy1",
} as const;

/** Colours for the extras, walked through the product's own picker after the demo's seven. */
const EXTRA_COLORS: AgentColorKey[] = (() => {
  const taken = new Set<string>([...Object.values(AGENT_COLORS), PRIOR_AGENT_COLOR]);
  const out: AgentColorKey[] = [];
  for (let i = 0; i < Object.keys(EXTRA_AGENT_IDS).length; i += 1) {
    const key = pickAgentColor(taken) ?? "agent-01";
    taken.add(key);
    out.push(key);
  }
  return out;
})();

type Extra = {
  id: string;
  owner: string;
  runtime: RuntimeKey;
  entry: AgentRosterEntry;
};

/** Product runtime ids (`shared/ui/runtime-logo.tsx` badges them). */
type RuntimeKey = "claude" | "codex" | "grok";

const EXTRAS: Extra[] = [
  {
    id: EXTRA_AGENT_IDS.deployWatch,
    owner: U.samuel,
    runtime: "claude",
    entry: {
      displayName: "Deploy Watch",
      description: "Posts every build and release, and flags a red one",
      color: EXTRA_COLORS[0],
    },
  },
  {
    id: EXTRA_AGENT_IDS.quarantine,
    owner: U.samuel,
    runtime: "claude",
    entry: {
      displayName: "Quarantine Runner",
      description: "Reruns a flaky test until it can say why",
      color: EXTRA_COLORS[1],
    },
  },
  {
    id: EXTRA_AGENT_IDS.schemaDiff,
    owner: U.anthony,
    runtime: "grok",
    entry: {
      displayName: "Schema Diff",
      description: "Compares the v1 and v2 payloads field by field",
      color: EXTRA_COLORS[2],
    },
  },
  {
    id: EXTRA_AGENT_IDS.clientGen,
    owner: U.samuel,
    runtime: "claude",
    entry: {
      displayName: "Client Gen",
      description: "Regenerates the typed client from the v2 spec",
      color: EXTRA_COLORS[3],
    },
  },
  {
    id: EXTRA_AGENT_IDS.uiCritic,
    owner: U.grace,
    runtime: "codex",
    entry: {
      displayName: "UI Critic",
      description: "Reviews a screen against the design language",
      color: EXTRA_COLORS[4],
    },
  },
  {
    id: EXTRA_AGENT_IDS.tokenSync,
    owner: U.samuel,
    runtime: "claude",
    entry: {
      displayName: "Token Sync",
      description: "Keeps the design tokens and the CSS in step",
      color: EXTRA_COLORS[5],
    },
  },
];

/** Agents launched from the staging composer at runtime (in-memory, this tab only). */
const LAUNCHED = new Map<string, Extra>();

/** Every agent: the demo's six + the extras. `indexMembers` reads this for pills and handles. */
export function stagingAgentIndex(): ReadonlyMap<string, AgentRosterEntry> {
  return new Map<string, AgentRosterEntry>([
    ...AGENT_INDEX,
    ...EXTRAS.map((e) => [e.id, e.entry] as const),
    ...[...LAUNCHED.values()].map((e) => [e.id, e.entry] as const),
  ]);
}

export function extraAgent(id: string): Extra | undefined {
  return EXTRAS.find((e) => e.id === id) ?? LAUNCHED.get(id);
}

/** Register a staging-launched agent so pills, faces and handles resolve it. */
export function registerLaunchedAgent(
  id: string,
  owner: string,
  entry: AgentRosterEntry
): void {
  LAUNCHED.set(id, { id, owner, runtime: "claude", entry });
}

/** What an agent runs on: an extra's own pick, else the demo's. */
export function stagingAgentRuntime(agentId: string): string {
  return extraAgent(agentId)?.runtime ?? AGENT_RUNTIME[agentId] ?? "claude";
}

/** `demo-identities.ts › identityFace`, extended to the extras. */
export function stagingIdentityFace(agentId: string | null | undefined): IdentityFace {
  const extra = agentId ? extraAgent(agentId) : undefined;
  if (!extra) return demoIdentityFace(agentId);
  return {
    photo: FACE[extra.owner as keyof typeof FACE] ?? null,
    color: extra.entry.color ?? null,
    logo: webRuntimeLogo(extra.runtime) ?? undefined,
  };
}
