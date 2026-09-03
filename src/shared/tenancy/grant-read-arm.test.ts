/**
 * 🔒 **THE PREFILTER AND THE PREDICATE AGREE — over every combination, not over
 * examples** (F-604, 2026-09-02).
 *
 * The grant arm costs a database read, so neither feature asks about a row the
 * cheaper arms have already decided: `needsGrantArm` selects the ids
 * `grantedResourceIds` is called with. That makes it a **deliberate mirror of
 * arms 1-3**, and a mirror is the shape this repo has been bitten by more than
 * any other (F-278: *"the copy is the one that will not notice"*).
 *
 * ⚠ **SO IT IS PINNED AS A PROPERTY AND NOT AS CASES.** For every
 * (credential × visibility × author) combination the two features admit, this
 * asserts the only thing that has to be true:
 *
 *   > **if a grant would change the answer, `needsGrantArm` said YES.**
 *
 * A prefilter that is too NARROW is a silent visibility bug — the row is
 * refused and no query was ever made to say otherwise. A prefilter that is too
 * WIDE is only a wasted query, so it is deliberately NOT an error here; making
 * it one would forbid a future arm from widening the set for a reason this file
 * cannot see.
 *
 * ⚠ **NO DATABASE, AND NOTHING MOCKED.** Both predicates are total functions of
 * a context, a row and a set. That is the whole reason the async lookup was kept
 * OUT of them.
 */

import { describe, it, expect } from "vitest";
import {
  canSeeBase,
  needsGrantArm as needsBaseGrantArm,
} from "@/features/knowledge/server/service-shared";
import {
  canSeeTemplate,
  needsGrantArm as needsTemplateGrantArm,
} from "@/features/agent-templates/server/service-shared";
import type { KnowledgeBase, KnowledgeContext } from "@/features/knowledge/types";
import type {
  AgentTemplate,
  AgentTemplateContext,
} from "@/features/agent-templates/types";
import { NO_GRANTS } from "./resource-grant-reach";

const ME = "u-me";
const PEER = "u-peer";
const ROW = "r-1";

/** The two axes `isSharedCredential` reads, in every shape it distinguishes. */
const CREDENTIALS = {
  "a person at their keyboard": { apiKeyWorkspaceId: null, credentialSubjectUserId: ME },
  "a container session for its operator": {
    apiKeyWorkspaceId: "ws-container",
    credentialSubjectUserId: ME,
  },
  "a shared workspace key": {
    apiKeyWorkspaceId: "ws-1",
    credentialSubjectUserId: null,
  },
  "an unfenced credential with no subject": {
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: null,
  },
} as const;

const AUTHORS = { mine: ME, "a peer's": PEER } as const;
const GRANTED: ReadonlySet<string> = new Set([ROW]);

function baseCtx(cred: (typeof CREDENTIALS)[keyof typeof CREDENTIALS]): KnowledgeContext {
  return {
    workspaceId: "ws-1",
    userId: ME,
    source: "agent",
    role: "member",
    ...cred,
  } as KnowledgeContext;
}

function templateCtx(
  cred: (typeof CREDENTIALS)[keyof typeof CREDENTIALS]
): AgentTemplateContext {
  return {
    workspaceId: "ws-1",
    userId: ME,
    source: "agent",
    role: "member",
    ...cred,
  } as AgentTemplateContext;
}

describe("🔒 the grant prefilter never hides a row the grant arm would admit", () => {
  it.each(["public", "private"] as const)(
    "knowledge_bases — %s, across every credential and author",
    (visibility) => {
      for (const [credName, cred] of Object.entries(CREDENTIALS)) {
        for (const [authorName, createdBy] of Object.entries(AUTHORS)) {
          const ctx = baseCtx(cred);
          const base = { id: ROW, visibility, createdBy } as KnowledgeBase;
          const moved =
            canSeeBase(ctx, base, GRANTED) !== canSeeBase(ctx, base, NO_GRANTS);
          expect(
            !moved || needsBaseGrantArm(ctx, base),
            `${credName} × ${visibility} × ${authorName}`
          ).toBe(true);
        }
      }
    }
  );

  it.each(["workspace", "private", "team"] as const)(
    "agent_templates — %s, across every credential and author",
    (visibility) => {
      for (const [credName, cred] of Object.entries(CREDENTIALS)) {
        for (const [authorName, createdBy] of Object.entries(AUTHORS)) {
          const ctx = templateCtx(cred);
          const template = { id: ROW, visibility, createdBy } as AgentTemplate;
          const share = {
            myTeamIds: new Set<string>(),
            byTemplate: new Map<string, string[]>(),
            grantedIds: NO_GRANTS,
          };
          const moved =
            canSeeTemplate(ctx, template, { ...share, grantedIds: GRANTED }) !==
            canSeeTemplate(ctx, template, share);
          expect(
            !moved || needsTemplateGrantArm(ctx, template),
            `${credName} × ${visibility} × ${authorName}`
          ).toBe(true);
        }
      }
    }
  );

  it("the property is not vacuous — a grant DOES move at least one combination", () => {
    // ⚠ Without this, a `canSee*` that ignored its grant set entirely would
    // satisfy every assertion above by never moving.
    const ctx = baseCtx(CREDENTIALS["a person at their keyboard"]);
    const peersPrivate = {
      id: ROW,
      visibility: "private",
      createdBy: PEER,
    } as KnowledgeBase;
    expect(canSeeBase(ctx, peersPrivate, NO_GRANTS)).toBe(false);
    expect(canSeeBase(ctx, peersPrivate, GRANTED)).toBe(true);
    expect(needsBaseGrantArm(ctx, peersPrivate)).toBe(true);
  });

  it("🔒 a SHARED credential is not widened by a grant, on either surface", () => {
    // Arm 2 stands above arm 4 on purpose: a credential that stands for nobody
    // has no membership of the granted scope to read the grant THROUGH.
    const cred = CREDENTIALS["a shared workspace key"];
    const peersPrivate = {
      id: ROW,
      visibility: "private",
      createdBy: PEER,
    } as KnowledgeBase;
    expect(canSeeBase(baseCtx(cred), peersPrivate, GRANTED)).toBe(false);
    expect(
      canSeeTemplate(
        templateCtx(cred),
        { id: ROW, visibility: "private", createdBy: PEER } as AgentTemplate,
        {
          myTeamIds: new Set(),
          byTemplate: new Map(),
          grantedIds: GRANTED,
        }
      )
    ).toBe(false);
  });
});
