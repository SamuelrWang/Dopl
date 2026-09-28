import { describe, expect, it } from "vitest";
import {
  appKey,
  appName,
  disconnectAgentApp,
  listAgentApps,
  type AgentAppStore,
  type GrantRow,
} from "./agent-apps";

const NOW = "2026-09-28T12:00:00.000Z";
const FUTURE = "2026-12-01T00:00:00.000Z";
const PAST = "2026-09-01T00:00:00.000Z";

const grant = (over: Partial<GrantRow>): GrantRow => ({
  id: "g",
  client_id: "dopl_client_x",
  client_name: "Claude",
  last_used_at: null,
  created_at: "2026-09-20T00:00:00.000Z",
  access_expires_at: PAST,
  refresh_expires_at: FUTURE,
  ...over,
});

function store(rows: GrantRow[]) {
  const revoked: string[] = [];
  const s: AgentAppStore = {
    async listGrants() {
      return rows.filter((r) => !revoked.includes(r.id));
    },
    async revokeTokens(_u, ids) {
      revoked.push(...ids);
      return ids.length;
    },
  };
  return { s, revoked };
}

describe("agent app grouping", () => {
  it("folds every registration of one app into one row, most recently used first", async () => {
    const { s } = store([
      grant({ id: "a", client_id: "c1", client_name: "Claude Code", last_used_at: "2026-09-27T00:00:00.000Z" }),
      grant({ id: "b", client_id: "c2", client_name: "Claude Code", last_used_at: "2026-09-28T01:00:00.000Z" }),
      grant({ id: "c", client_id: "c3", client_name: "Codex", last_used_at: "2026-09-26T00:00:00.000Z" }),
      grant({ id: "d", client_id: "c4", client_name: "Cursor", refresh_expires_at: PAST }),
    ]);
    const { apps } = await listAgentApps(s, "u", NOW);
    expect(apps).toEqual([
      expect.objectContaining({ key: "claude-code", name: "Claude Code", connections: 2, last_used_at: "2026-09-28T01:00:00.000Z" }),
      expect.objectContaining({ key: "codex", connections: 1 }),
    ]);
  });

  it("names an unnamed client and keys names stably", () => {
    expect(appName(null)).toBe("MCP client");
    expect(appName("  ")).toBe("MCP client");
    expect(appKey("Claude Code")).toBe("claude-code");
    expect(appKey("Claude.ai (web)")).toBe("claude-ai-web");
    expect(appKey("!!")).toBe("mcp-client");
  });

  it("disconnect revokes every credential of that app only", async () => {
    const { s, revoked } = store([
      grant({ id: "a", client_name: "Codex" }),
      grant({ id: "b", client_name: "Codex", refresh_expires_at: PAST }),
      grant({ id: "c", client_name: "Claude" }),
    ]);
    expect(await disconnectAgentApp(s, "u", "codex", NOW)).toBe(2);
    expect(revoked).toEqual(["a", "b"]);
    expect(await disconnectAgentApp(s, "u", "nope", NOW)).toBe(0);
  });
});
