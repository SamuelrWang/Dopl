/**
 * Unit tests for the new-workspace seed orchestrator. Every feature seed
 * + the KB existence check are mocked, so these assert the orchestration
 * contract itself: idempotency, dependency ordering, cross-ref threading,
 * and best-effort isolation (one surface failing doesn't stop the rest).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/features/knowledge/server/repository", () => ({
  findBaseBySlug: vi.fn(),
}));
vi.mock("@/features/knowledge/server/service-seed", () => ({
  seedWorkspace: vi.fn(),
}));
vi.mock("@/features/skills/server/service-seed", () => ({
  seedWorkspace: vi.fn(),
}));
vi.mock("@/features/ontology/server/service-seed", () => ({
  seedWorkspace: vi.fn(),
}));
vi.mock("@/features/workflows/server/service-seed", () => ({
  seedWorkspace: vi.fn(),
}));
vi.mock("@/features/chats/server/service-seed", () => ({
  seedWorkspace: vi.fn(),
}));

import { findBaseBySlug } from "@/features/knowledge/server/repository";
import { seedWorkspace as seedKnowledge } from "@/features/knowledge/server/service-seed";
import { seedWorkspace as seedSkills } from "@/features/skills/server/service-seed";
import { seedWorkspace as seedOntology } from "@/features/ontology/server/service-seed";
import { seedWorkspace as seedWorkflow } from "@/features/workflows/server/service-seed";
import { seedWorkspace as seedChat } from "@/features/chats/server/service-seed";
import { seedNewWorkspace } from "./seed-workspace";

const WS = "ws-1";
const USER = "user-1";

const mFindBase = vi.mocked(findBaseBySlug);
const mKnowledge = vi.mocked(seedKnowledge);
const mSkills = vi.mocked(seedSkills);
const mOntology = vi.mocked(seedOntology);
const mWorkflow = vi.mocked(seedWorkflow);
const mChat = vi.mocked(seedChat);

function primeHappyPath() {
  mFindBase.mockResolvedValue(null);
  mKnowledge.mockResolvedValue({
    basesCreated: 1,
    guide: {
      baseId: "kb-1",
      slug: "dopl-guide",
      entryIdByKey: {
        "what-is-dopl": { id: "e1", title: "Start here" },
        "the-session-ritual": { id: "e2", title: "Ritual" },
      },
    },
  });
  mSkills.mockResolvedValue({
    skillsCreated: 4,
    skillIdBySlug: {
      "archive-a-session-to-chats": { id: "s1", name: "Archive" },
      "file-knowledge-well": { id: "s2", name: "File" },
    },
  });
  mOntology.mockResolvedValue({ clusterId: "c1", objectsCreated: 11, relationshipsCreated: 3 });
  mWorkflow.mockResolvedValue({ workflowId: "w1", stepCount: 5 });
  mChat.mockResolvedValue({ chatId: "ch1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  primeHappyPath();
});

describe("seedNewWorkspace — idempotency", () => {
  it("no-ops when the Dopl Guide base already exists", async () => {
    mFindBase.mockResolvedValue({ id: "kb-existing" } as never);
    const result = await seedNewWorkspace(WS, USER);
    expect(result.seeded).toBe(false);
    expect(mKnowledge).not.toHaveBeenCalled();
    expect(mSkills).not.toHaveBeenCalled();
    expect(mOntology).not.toHaveBeenCalled();
    expect(mWorkflow).not.toHaveBeenCalled();
    expect(mChat).not.toHaveBeenCalled();
  });

  it("bails without inserting if the existence check throws", async () => {
    mFindBase.mockRejectedValue(new Error("db down"));
    const result = await seedNewWorkspace(WS, USER);
    expect(result.seeded).toBe(false);
    expect(mKnowledge).not.toHaveBeenCalled();
  });
});

describe("seedNewWorkspace — dependency ordering + cross-refs", () => {
  it("seeds every surface once in dependency order", async () => {
    const result = await seedNewWorkspace(WS, USER);

    expect(result.seeded).toBe(true);
    expect(mKnowledge).toHaveBeenCalledTimes(1);
    expect(mSkills).toHaveBeenCalledTimes(1);
    expect(mOntology).toHaveBeenCalledTimes(1);
    expect(mWorkflow).toHaveBeenCalledTimes(1);
    expect(mChat).toHaveBeenCalledTimes(1);

    // knowledge + skills resolve before ontology; ontology before workflow;
    // workflow before chat.
    const kOrder = mKnowledge.mock.invocationCallOrder[0];
    const sOrder = mSkills.mock.invocationCallOrder[0];
    const oOrder = mOntology.mock.invocationCallOrder[0];
    const wOrder = mWorkflow.mock.invocationCallOrder[0];
    const cOrder = mChat.mock.invocationCallOrder[0];
    expect(kOrder).toBeLessThan(oOrder);
    expect(sOrder).toBeLessThan(oOrder);
    expect(oOrder).toBeLessThan(wOrder);
    expect(wOrder).toBeLessThan(cOrder);
  });

  it("threads flattened knowledge/skill ids into ontology + workflow", async () => {
    await seedNewWorkspace(WS, USER);

    expect(mOntology).toHaveBeenCalledWith(
      { workspaceId: WS, userId: USER },
      {
        entryIdByKey: { "what-is-dopl": "e1", "the-session-ritual": "e2" },
        skillIdBySlug: {
          "archive-a-session-to-chats": "s1",
          "file-knowledge-well": "s2",
        },
      }
    );

    expect(mWorkflow).toHaveBeenCalledWith(WS, USER, {
      kbBaseId: "kb-1",
      entryIdByKey: { "what-is-dopl": "e1", "the-session-ritual": "e2" },
      skillIdBySlug: {
        "archive-a-session-to-chats": "s1",
        "file-knowledge-well": "s2",
      },
    });
  });

  it("reports counts from each surface", async () => {
    const result = await seedNewWorkspace(WS, USER);
    expect(result).toEqual({
      seeded: true,
      knowledgeBases: 1,
      skills: 4,
      objects: 11,
      relationships: 3,
      workflowSteps: 5,
      chats: 1,
    });
  });
});

describe("seedNewWorkspace — best-effort isolation", () => {
  it("continues seeding after one surface throws", async () => {
    mOntology.mockRejectedValue(new Error("ontology boom"));
    const result = await seedNewWorkspace(WS, USER);
    expect(result.seeded).toBe(true);
    expect(result.objects).toBe(0); // ontology failed
    expect(mWorkflow).toHaveBeenCalledTimes(1); // but workflow still ran
    expect(mChat).toHaveBeenCalledTimes(1); // and chat still ran
    expect(result.chats).toBe(1);
  });

  it("skips the workflow when knowledge produced no guide base", async () => {
    mKnowledge.mockResolvedValue({ basesCreated: 0, guide: null });
    const result = await seedNewWorkspace(WS, USER);
    expect(mWorkflow).not.toHaveBeenCalled();
    expect(result.workflowSteps).toBe(0);
    // Ontology still runs (with empty entry refs); chat still runs.
    expect(mOntology).toHaveBeenCalledTimes(1);
    expect(mChat).toHaveBeenCalledTimes(1);
  });
});
