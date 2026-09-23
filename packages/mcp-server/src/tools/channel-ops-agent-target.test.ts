// `to` on the manage lane is an agent instance id: a name handle (valid on `op="send"`) is refused
// by name before anything is filed, instead of surfacing as a bare VALIDATION_FAILED.

import { describe, it, expect, vi } from "vitest";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import {
  AGENT,
  agentClient as client,
  agentDirective as directive,
  settled,
} from "./launch-fixtures";

describe("`to` on op=\"manage\" is an agent id, and a NAME handle is refused by name", () => {
  it("refuses a name handle on action=\"end\" and files NOTHING", async () => {
    const createAgentDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "done" }),
    }));
    const res = await opEndAgent(client({ createAgentDirective }), "general", "@my-agent", {
      waitMs: 0,
    });
    expect(createAgentDirective).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    const out = res.content[0].text as string;
    expect(out).toContain("field=to");
    expect(out).toContain("reason=not_an_agent_id");
    // Unlike a too-long field, this one has a next call that fixes it.
    expect(out).toContain('retry=dopl_channel(op="status")');
    expect(out).toContain("Nothing was filed");
    // Names the lane where a name handle does work, so the caller does not doubt its sends.
    expect(out).toContain("SEND");
  });

  it("refuses one on action=\"rename\" too — the three verbs share the check", async () => {
    const createAgentDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "done" }),
    }));
    const res = await opRenameAgent(
      client({ createAgentDirective }),
      "general",
      "@my-agent",
      "Research",
      { waitMs: 0 },
    );
    expect(createAgentDirective).not.toHaveBeenCalled();
    expect((res.content[0].text as string)).toContain("reason=not_an_agent_id");
  });

  it("still files a pasted @agent-<id> exactly as before — the fix narrows nothing legal", async () => {
    const c = settled({ status: "done" });
    const res = await opEndAgent(c, "general", `@agent-${AGENT}`, { waitMs: 0 });
    expect(res.isError).toBeFalsy();
    expect(c.createAgentDirective).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "end", agentId: AGENT }),
    );
  });

  it("and a BARE id, and an `agent-` prefix — all three pasted forms survive", async () => {
    for (const form of [AGENT, `agent-${AGENT}`, `@${AGENT}`]) {
      const c = settled({ status: "done" });
      await opEndAgent(c, "general", form, { waitMs: 0 });
      expect(c.createAgentDirective, form).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: AGENT }),
      );
    }
  });

  it("scopes the handle promise in the published describe, so the surface and the lane agree", () => {
    // A refusal that is right while the describe is wrong only moves the surprise one call later.
    const described = CHANNEL_INPUT_SHAPE.to.description ?? "";
    expect(described).toContain('op="manage"');
    expect(described).toContain("`@agent-<id>` ONLY");
    // The send half of the promise is true and must survive tightening the manage half.
    expect(described).toContain("agent handle");
  });
});
