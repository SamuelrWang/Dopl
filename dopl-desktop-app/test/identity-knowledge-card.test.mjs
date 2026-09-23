// THE ATTACHED-BASE CARD — `prompt-framing-agent-identity.js › baseCard`, reached through
// `identityRoleFraming` (A4, 2026-09-18).
//
// ⚠ **WHAT THE CARD IS FOR.** A role block naming a base and a `get_tree` call makes the agent go
// LOOKING for the right corner of it before it can start, and the looking is the unreliable step
// (Samuel: *"if the agent has to search things then that becomes unreliable"*). The card spends a
// FIXED budget on what the base answers and its top-level folders, so the first call is the right
// one.
//
// 🔒 ⚠ **FIXED SIZE IS THE WHOLE CONTRACT, AND THESE ARE THE CASES THAT KEEP IT ONE.** A card that
// grew with the base would be a per-session prompt that grows with the workspace — the thing the
// 2,048-character MCP `instructions` prefix is capped to prevent, reintroduced one attachment at a
// time. So: ≤400 characters per base, ZERO entries at any size, and a degrade order that drops
// whole facts rather than cutting one in half.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// ⚠ `main/` IS COMMONJS — the same bridge every other truth table in this directory uses.
const require = createRequire(import.meta.url);
const { identityRoleFraming } = require('../main/prompt-framing-agent-identity');

const NONCE = 'abc123';
const BASE_ID = '11111111-2222-3333-4444-555555555555';

/** The ATTACHED KNOWLEDGE section of a rendered role block, as lines. */
function knowledgeLines(identity) {
  const lines = identityRoleFraming({ identity, profile: 'full' }, NONCE);
  const start = lines.indexOf('ATTACHED KNOWLEDGE:');
  assert.notEqual(start, -1, 'the role block should carry an ATTACHED KNOWLEDGE section');
  return lines.slice(start + 1);
}

/** The card itself: the head line and the indented facts hanging off it. */
function cardOf(identity) {
  const lines = knowledgeLines(identity);
  const head = lines.findIndex((l) => l.startsWith('- '));
  const rest = lines.slice(head + 1);
  const end = rest.findIndex((l) => !l.startsWith('  '));
  return [lines[head], ...rest.slice(0, end === -1 ? rest.length : end)];
}

const scope = (over = {}) => ({
  scope: 'base',
  baseId: BASE_ID,
  baseName: 'Deploys',
  toolPath: '',
  baseSlug: 'deploys',
  baseSummary: 'How this service is released, rolled back and paged for.',
  baseFolders: [
    { name: 'Runbooks', summary: 'step-by-step, one per incident class' },
    { name: 'Postmortems' },
  ],
  baseFolderCount: 2,
  ...over,
});

const identity = (over = {}) => ({
  name: 'Release Captain',
  instructions: 'Ship it.',
  fields: [],
  knowledgeBases: [],
  knowledge: [scope()],
  authoredByCaller: true,
  ...over,
});

test('the card names the base, its id, its slug, what it answers, and its folders', () => {
  const card = cardOf(identity());
  const text = card.join('\n');
  // ⚠ THE HEAD IS THE EXACT CALL, UNCHANGED — every other fact hangs off it.
  assert.match(card[0], /mcp__dopl__dopl_kb, op "get_tree", base "11111111-2222-3333-4444-555555555555"/);
  assert.match(text, /\[slug: deploys\]/);
  assert.match(text, /How this service is released/);
  assert.match(text, /Folders: Runbooks \(step-by-step, one per incident class\); Postmortems/);
});

test('🔒 a base with FORTY entries renders the same card, and lists none of them', () => {
  // ⚠ THE ACCEPTANCE TEST FOR THE WHOLE ITEM. Entries are not carried on the payload at all, so
  // this is the case that fails if anybody ever puts them there: a card is the same size whether
  // the base holds four documents or four hundred.
  const entries = Array.from({ length: 40 }, (_, i) => `Runbook ${i + 1}`);
  const card = cardOf(
    identity({
      knowledge: [
        scope({
          baseFolders: [{ name: 'Runbooks', summary: entries.join(', ') }],
          baseFolderCount: 1,
        }),
      ],
    })
  );
  const text = card.join('\n');
  assert.ok(text.length <= 400, `card is ${text.length} chars; the cap is 400`);
  for (const title of entries) {
    assert.ok(!text.includes(title), `the card must not list the entry ${title}`);
  }
  // ⚠ And what survived is still ACTIONABLE — the head never degrades away.
  assert.match(card[0], /op "get_tree", base "/);
});

test('the degrade order drops WHOLE facts: clauses, then the folder list, then the summary', () => {
  const long = (n) => 'x'.repeat(n);

  // 1. Clauses go first — the names survive, so the routing fact survives.
  const clauses = cardOf(
    identity({
      knowledge: [
        scope({
          baseSummary: 'short',
          baseFolders: [
            { name: 'Runbooks', summary: long(200) },
            { name: 'Postmortems', summary: long(200) },
          ],
          baseFolderCount: 2,
        }),
      ],
    })
  ).join('\n');
  assert.ok(clauses.length <= 400);
  assert.match(clauses, /Folders: Runbooks; Postmortems/);
  assert.ok(!clauses.includes('xxx'), 'the clause text should be gone, not clipped');
  assert.match(clauses, /short/);

  // 2. Then the folder list entirely — the summary is the cheaper fact to keep.
  const folders = cardOf(
    identity({
      knowledge: [
        scope({
          baseSummary: 'short',
          baseFolders: Array.from({ length: 30 }, (_, i) => ({ name: `Folder-${long(10)}-${i}` })),
          baseFolderCount: 30,
        }),
      ],
    })
  ).join('\n');
  assert.ok(folders.length <= 400);
  assert.ok(!folders.includes('Folders:'), 'the folder list should be dropped whole');
  assert.match(folders, /short/);

  // 3. Then the summary, and the head alone is what is left.
  const head = cardOf(
    identity({ knowledge: [scope({ baseSummary: long(600), baseFolders: [], baseFolderCount: 0 })] })
  );
  assert.equal(head.length, 1);
  assert.match(head[0], /op "get_tree", base "/);
});

test('🔒 a folder list that is not PROVABLY complete is not printed at all', () => {
  // ⚠ A capped or partly-dropped list rendered as "Folders:" claims a shape the base does not
  // have. The count is the completeness signal, and a mismatch deletes the fact.
  const text = cardOf(
    identity({
      knowledge: [scope({ baseFolders: [{ name: 'Runbooks' }], baseFolderCount: 9 })],
    })
  ).join('\n');
  assert.ok(!text.includes('Folders:'));
  assert.match(text, /\[slug: deploys\]/);
});

test('🔒 an OLDER SERVER payload renders exactly the line it always did', () => {
  // ⚠ The §11 rule: unknown is not empty. A build that predates the card sends `{id, name}` and no
  // card facts, so the card degrades to the one-line form — never to a card asserting the base has
  // no folders and answers nothing.
  const lines = knowledgeLines(
    identity({ knowledge: [], knowledgeBases: [{ id: BASE_ID, name: 'Deploys' }] })
  );
  assert.equal(lines[0], `- Deploys  (mcp__dopl__dopl_kb, op "get_tree", base "${BASE_ID}")`);
  assert.ok(!lines[1].startsWith('  '), 'no card facts should be invented for an older payload');
});

test('a slug the sanitizer would ALTER is dropped, never rendered changed', () => {
  // ⚠ The slug is an ADDRESS — `dopl_kb`'s `base` takes it in place of the id — so a value that
  // does not survive the id-token belt unchanged would be a different, probably non-existent base.
  for (const bad of ['has space', 'UPPER CASE', 'back`tick', 'x'.repeat(200)]) {
    const text = cardOf(identity({ knowledge: [scope({ baseSlug: bad })] })).join('\n');
    assert.ok(!text.includes('[slug:'), `a slug of ${JSON.stringify(bad)} must be dropped`);
  }
});

test('a FOLDER or ENTRY scope keeps its own one line — a card over it would be noise', () => {
  const lines = knowledgeLines(
    identity({
      knowledge: [
        { scope: 'folder', baseId: BASE_ID, baseName: 'Deploys', toolPath: 'Runbooks' },
        { scope: 'entry', baseId: BASE_ID, baseName: 'Deploys', toolPath: 'Runbooks/Rollback.md' },
      ],
    })
  );
  assert.match(lines[0], /op "list_dir", base "[^"]+", path "Runbooks"/);
  assert.match(lines[1], /op "read_file", base "[^"]+", path "Runbooks\/Rollback.md"/);
  assert.ok(!lines[2].startsWith('  '), 'a sub-base scope gets no card');
});

test('an identity with NO knowledge still renders no section at all', () => {
  const lines = identityRoleFraming(
    { identity: identity({ knowledge: [], knowledgeBases: [] }), profile: 'full' },
    NONCE
  );
  assert.ok(!lines.includes('ATTACHED KNOWLEDGE:'));
});
