// THE SCOPE NARROW — `identity-resolve.js › narrow` over the `knowledge` key (2026-09-08).
//
// ⚠ IT DRIVES `narrow` DIRECTLY, WITHOUT THE FAKE TRANSPORT, which is what that export exists
// for ("exported so the whitelist can be driven directly"). `session-launch-identity.test.mjs`
// owns the LAUNCH — the resolve round trip, the approval gate, the funnel whitelist — and it is
// already at §1's 500-line cap; what is here is the BOUNDARY's own narrowing of one new key.
//
// ⚠ THE PROPERTY: the whitelist is CLOSED, and a scope's `scope` FAILS TO `'base'`. An unknown
// discriminator from a newer server renders the whole-base call, which is the WIDER instruction
// and therefore the one that cannot point an agent at a document that does not exist.
//
// Run: `node --test dopl-desktop-app/test/launch-identity-scopes.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { narrow } = require(
  fileURLToPath(new URL("../main/identity-resolve.js", import.meta.url))
);

const BODY = {
  name: "Code Auditor",
  instructions: "Audit the diff.",
  model: null,
  fields: [],
  knowledgeBases: [{ id: "kb-1", name: "Handbook" }],
  authoredByCaller: true,
  unreachableKnowledgeBaseCount: 0,
};

test("a scope is narrowed to FOUR keys — ids, names and the display path are dropped", () => {
  // ⚠ A LITERAL WHITELIST INSIDE THE WHITELIST, for the reason the outer one exists: the
  // server's ref also carries `folderId`, `entryId`, `folderName`, `entryTitle` and a DISPLAY
  // `path`, and none of them is read at render. A field the server adds later cannot arrive on
  // a session object and start being depended on by accident.
  const t = narrow({
    ...BODY,
    knowledge: [
      {
        scope: "folder",
        baseId: "kb-1",
        baseName: "Handbook",
        toolPath: "Deploys/Nightly",
        folderId: "f-1",
        folderName: "Nightly",
        path: "Handbook / Deploys / Nightly",
      },
    ],
  });
  assert.deepEqual(Object.keys(t.knowledge[0]).sort(), [
    "baseId",
    "baseName",
    "scope",
    "toolPath",
  ]);
  assert.equal(t.knowledge[0].scope, "folder");
  assert.equal(t.knowledge[0].toolPath, "Deploys/Nightly");
});

test("an unknown `scope` FAILS TO the whole base, which is the wider instruction", () => {
  const t = narrow({ ...BODY, knowledge: [{ scope: "subtree", baseId: "kb-1", baseName: "H" }] });
  assert.equal(t.knowledge[0].scope, "base");
});

test("an older SERVER that sends no `knowledge` yields an array, never undefined", () => {
  // ⚠ §13's older-peer rule from the other side. A consumer distinguishing "absent" from
  // "empty" is a consumer with two code paths for one state — the same rule the launch
  // contract's own "nulls travel as null" case states for the scalar fields.
  assert.deepEqual(narrow(BODY).knowledge, []);
  assert.deepEqual(narrow({}).knowledge, []);
});

test("`knowledgeBases` SURVIVES beside it — dropping it would silence an older server", () => {
  const t = narrow({ ...BODY, knowledge: [{ scope: "base", baseId: "kb-1", baseName: "H" }] });
  assert.deepEqual(t.knowledgeBases, [{ id: "kb-1", name: "Handbook" }]);
});

test("a BASE scope carries the four card keys, and a folder scope carries none of them", () => {
  // ⚠ **THE CARD IS BASE-SCOPE ONLY, AND THE BOUNDARY ENFORCES IT RATHER THAN TRUSTING THE
  // SERVER** (A4, 2026-09-18). A folder or entry scope already names the exact thing it points
  // at, so a card over one is noise on top of an answer — and a key that reaches no renderer is
  // a key somebody later starts depending on.
  const card = {
    baseSlug: "handbook",
    baseSummary: "How we work.",
    baseFolders: [{ name: "Deploys", summary: "release steps" }],
    baseFolderCount: 1,
  };
  const t = narrow({
    ...BODY,
    knowledge: [
      { scope: "base", baseId: "kb-1", baseName: "Handbook", toolPath: "", ...card },
      // ⚠ The same keys on a FOLDER scope are dropped, even though the server does not send them
      // there: the whitelist is the fence, not the sender's good manners.
      { scope: "folder", baseId: "kb-1", baseName: "Handbook", toolPath: "Deploys", ...card },
    ],
  });
  assert.deepEqual(Object.keys(t.knowledge[0]).sort(), [
    "baseFolderCount",
    "baseFolders",
    "baseId",
    "baseName",
    "baseSlug",
    "baseSummary",
    "scope",
    "toolPath",
  ]);
  assert.deepEqual(t.knowledge[0].baseFolders, [{ name: "Deploys", summary: "release steps" }]);
  assert.deepEqual(Object.keys(t.knowledge[1]).sort(), [
    "baseId",
    "baseName",
    "scope",
    "toolPath",
  ]);
});
