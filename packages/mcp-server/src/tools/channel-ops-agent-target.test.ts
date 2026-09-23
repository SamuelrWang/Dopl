/**
 * **`to` ON THE MANAGE LANE IS AN AGENT INSTANCE ID — AND A NAME HANDLE IS REFUSED BY NAME**
 * (S51, 2026-09-18).
 *
 * ⚠ **ITS OWN FILE BECAUSE `channel-ops-agent.test.ts` IS AT THE §1 CAP** (500 lines over
 * `packages/`, the `size-check` CI job — which reads test files too). The seam is the one
 * `channel-ops-launch-body.test.ts` draws against its own sibling: that suite asserts what a
 * RESULT TEACHES once a directive exists, this one asserts THE CALL THAT IS NEVER MADE.
 *
 * ⚠ **THE PROMISE WAS REAL AND THE LANE COULD NOT KEEP IT.** `to`'s describe offered *"an
 * agent (`@agent-<id>` or its handle)"* across the whole field. The handle half is TRUE on
 * `op="send"` — `service-writes-metadata-recipient.ts › resolveToRecipients` resolves a name
 * — and false here: `bareAgentId` stripped the `@` without validating, so `@my-agent` reached
 * `AgentDirectiveCreateSchema.agentId`'s anchored eight-character grammar and came back as a
 * bare `VALIDATION_FAILED: Request body failed validation`, which names no field.
 *
 * ⚠ **REFUSE, DO NOT RESOLVE.** No client method maps a name to an instance id, and
 * `channel_sessions.name` IS the id on every current desktop (`channel-session-handle.ts`
 * documents that at length) — so a local resolver would be inventing a lookup rather than
 * restating one.
 *
 * ⚠ THE FIXTURES BELOW ARE COPIED FROM THE SIBLING SUITE, not shared — the arrangement that
 * file's own header argues for: a client stub and a directive factory, small, pure, and
 * loudly broken by any change to `LaunchDirective`.
 */

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
    // 🔒 NOTHING WENT OUT — the whole point of moving the refusal in front of the create.
    expect(createAgentDirective).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    const out = res.content[0].text as string;
    expect(out).toContain("field=to");
    expect(out).toContain("reason=not_an_agent_id");
    // ⚠ THE RETRY NAMES THE OP THAT HANDS BACK THE ID, because unlike a too-long field this
    // one has a next call that fixes it.
    expect(out).toContain('retry=dopl_channel(op="status")');
    expect(out).toContain("Nothing was filed");
    // ⚠ AND IT SAYS WHICH LANE THE HANDLE DOES WORK ON. "That is not an id" alone teaches a
    // caller that its own `op="send"` addressing was wrong too, which it was not.
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
    // ⚠ **THE OTHER HALF OF THE FIX, AND THE ONE A CALLER READS FIRST.** A refusal that is
    // right while the describe is still wrong just moves the surprise one call later.
    const described = CHANNEL_INPUT_SHAPE.to.description ?? "";
    expect(described).toContain('op="manage"');
    expect(described).toContain("`@agent-<id>` ONLY");
    // ⚠ PINNED IN BOTH DIRECTIONS: the SEND half of the promise is true and must not be
    // deleted in the name of tightening the manage half.
    expect(described).toContain("agent handle");
  });
});
