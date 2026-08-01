/**
 * ENGAGEMENT, THE CLEAR SIDE — how an engagement ENDS, driven through the real
 * entry points (`disengageAgent`, `setAgentStatus`) plus the DTO that carries
 * the state out to a reader. The STAMP side — what creates an engagement, and
 * the loop brake on it — is `service-agents-engagement.test.ts`; both share one
 * room (`service-agents-engagement.fixtures.ts`) precisely because every rule
 * below is stated in terms of the OWNER and the ENGAGER.
 *
 * What this file pins:
 *  - **Disengaging is the one agent write that is not owner-only** — the human
 *    who engaged it may end it, because engagement is a relationship they
 *    created. Anyone else is a 403. The gate is visibility + identity, NOT
 *    membership, matching `renameAgent` / `setAgentStatus`; see the docblock on
 *    `disengageAgent` for why a membership check would be strictly worse here.
 *  - **Parking or dismissing clears engagement in the same statement**, so a
 *    stopped process never reads as "listening for Sam".
 *  - **`engaged_at` is a FACT the server records and never expires.** Nothing
 *    here sweeps it; the desktop applies `ENGAGEMENT_TTL_MS` against it.
 *
 * The other exit — a member LEAVING, which clears everything they engaged — is
 * a membership write and is pinned in `service-writes-members.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-participants");
vi.mock("./repository-agents");

import * as repoAgents from "./repository-agents";
import { ENGAGEMENT_TTL_MS } from "../constants";
import {
  ChannelAgentForbiddenError,
  ChannelAgentNotFoundError,
} from "./errors";
import { disengageAgent, listAgents, setAgentStatus } from "./service-agents";
import {
  agentRow,
  ctx,
  PEER,
  QUARTZ,
  resetEngagementFakes,
  THIRD,
  USER,
} from "./service-agents-engagement.fixtures";

beforeEach(() => {
  resetEngagementFakes();
});

describe("disengageAgent", () => {
  it("lets the OWNER clear it", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: USER, engaged_at: "2026-07-31T00:00:00Z", engaged_by: PEER })
    );

    await disengageAgent(ctx, "room", QUARTZ);

    expect(repoAgents.clearAgentEngagement).toHaveBeenCalledWith(QUARTZ);
  });

  it("lets the ENGAGER clear it, without owning it", async () => {
    // The relationship is theirs to end: they put the agent on standing duty
    // for their own messages, and taking it off is not reaching into the
    // owner's machine the way parking it would be.
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: PEER, engaged_at: "2026-07-31T00:00:00Z", engaged_by: USER })
    );

    await disengageAgent(ctx, "room", QUARTZ);

    expect(repoAgents.clearAgentEngagement).toHaveBeenCalledWith(QUARTZ);
  });

  it("403s a third party who neither owns nor engaged it", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: PEER, engaged_at: "2026-07-31T00:00:00Z", engaged_by: THIRD })
    );

    await expect(disengageAgent(ctx, "room", QUARTZ)).rejects.toThrow(
      ChannelAgentForbiddenError
    );
    expect(repoAgents.clearAgentEngagement).not.toHaveBeenCalled();
  });

  it("403s a non-owner on an agent nobody engaged", async () => {
    // Nothing to inherit the permission from — an idle agent belongs to its
    // owner alone.
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: PEER })
    );

    await expect(disengageAgent(ctx, "room", QUARTZ)).rejects.toThrow(
      ChannelAgentForbiddenError
    );
  });

  it("is idempotent for the owner of an already-idle agent", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: USER })
    );

    const agent = await disengageAgent(ctx, "room", QUARTZ);

    expect(agent.engagedAt).toBeNull();
    expect(agent.engagedBy).toBeNull();
  });

  it("404s an agent of ANOTHER channel (an id is not a passport)", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: USER, channel_id: "chan-other" })
    );

    await expect(disengageAgent(ctx, "room", QUARTZ)).rejects.toThrow(
      ChannelAgentNotFoundError
    );
  });

  it("404s an id that names no row", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(null);

    await expect(disengageAgent(ctx, "room", QUARTZ)).rejects.toThrow(
      ChannelAgentNotFoundError
    );
  });
});

describe("setAgentStatus — a stopped agent is not listening", () => {
  it("clears engagement on park", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: USER })
    );

    await setAgentStatus(ctx, "room", QUARTZ, "parked");

    expect(repoAgents.updateAgentStatus).toHaveBeenCalledWith(QUARTZ, "parked", {
      clearEngagement: true,
    });
  });

  it("clears engagement on dismiss", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: USER })
    );

    await setAgentStatus(ctx, "room", QUARTZ, "dismissed");

    expect(repoAgents.updateAgentStatus).toHaveBeenCalledWith(
      QUARTZ,
      "dismissed",
      { clearEngagement: true }
    );
  });

  it("does NOT clear it on active or summoned (those are engaged states)", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: USER })
    );

    await setAgentStatus(ctx, "room", QUARTZ, "active");
    await setAgentStatus(ctx, "room", QUARTZ, "summoned");

    expect(repoAgents.updateAgentStatus).toHaveBeenNthCalledWith(
      1,
      QUARTZ,
      "active",
      { clearEngagement: false }
    );
    expect(repoAgents.updateAgentStatus).toHaveBeenNthCalledWith(
      2,
      QUARTZ,
      "summoned",
      { clearEngagement: false }
    );
  });
});

describe("the ChannelAgent DTO carries engagement", () => {
  it("exposes engagedAt / engagedBy on the read path", async () => {
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([
      agentRow({ engaged_at: "2026-07-31T09:00:00Z", engaged_by: USER }),
    ]);

    const [agent] = await listAgents(ctx, "room");

    expect(agent.engagedAt).toBe("2026-07-31T09:00:00Z");
    expect(agent.engagedBy).toBe(USER);
  });

  it("reads an idle agent as null, never undefined", async () => {
    const [agent] = await listAgents(ctx, "room");

    expect(agent.engagedAt).toBeNull();
    expect(agent.engagedBy).toBeNull();
  });
});

describe("ENGAGEMENT_TTL_MS", () => {
  /**
   * The window is 60 minutes and lives in ONE place so the web and the desktop
   * cannot drift. It is deliberately NOT enforced here: no service read filters
   * on it, and nothing expires `engaged_at`. Expiry is the desktop's policy.
   */
  it("is 60 minutes", () => {
    expect(ENGAGEMENT_TTL_MS).toBe(60 * 60_000);
  });
});
