/**
 * 🔒 **THE CLIENT'S WIRE TYPES DO NOT FALL BEHIND THE SERVER'S.** Every `@dopl/client` interface
 * below says it mirrors a same-named server interface; this fails when the SERVER type has a
 * top-level field the client twin lacks.
 *
 * Found 2026-10-11 (cleanup X04): `AgentIdentity`, `IdentityKnowledgeRef` and `Ontology` had
 * silently fallen 1, 4 and 3 fields behind (since 2026-09-09 / 09-23), and
 * `OntologySnapshot.truncated` was added server-side with only a comment asking for the twin.
 *
 * ⚠ READ AS SOURCE TEXT, NOT IMPORTED — on purpose. This package's `rootDir` is `src` and it may
 * not import the app (INVARIANTS §13), and interfaces do not exist at runtime anyway. So the
 * comparison is on FIELD NAMES parsed out of both files: top-level fields only, comments
 * stripped, `extends` clauses NOT followed (an inherited server field is invisible here, which
 * is the lenient direction). Types of fields are not compared.
 *
 * ⚠ ONE-WAY: a client-only field is allowed (the client may describe a header or an older
 * server's key); a server-only field is the drift. Make the new field OPTIONAL on the client
 * (INVARIANTS §8: a cached older payload lacks it), then this goes green.
 *
 * MUTATION-VERIFY: delete `sharedChannelCount?` from `ontology-types.ts › Ontology` → red.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Walk up to the repo root (the directory holding both `src/features` and `packages`). */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "src", "features")) && existsSync(join(dir, "packages"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repo root not found from " + fileURLToPath(import.meta.url));
}
const ROOT = repoRoot();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Top-level field names of `export interface <name>`, or null when it is not declared there. */
function fieldsOf(source: string, name: string): Set<string> | null {
  const head = new RegExp(`^export interface ${name}(?:<[^>]*>)?(?:\\s+extends\\s+[^{]+)?\\s*\\{`, "m");
  const m = head.exec(source);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (depth > 0 && i < source.length) {
    const ch = source[i++];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  const body = source
    .slice(start, i - 1)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const fields = new Set<string>();
  let level = 0;
  let line = "";
  for (const ch of body) {
    if ("{(<[".includes(ch)) level++;
    else if ("})>]".includes(ch)) level--;
    if ((ch === ";" || ch === "\n") && level === 0) {
      const f = /^\s*(?:readonly\s+)?(\w+)\??\s*:/.exec(line);
      if (f) fields.add(f[1]);
      line = "";
    } else line += ch;
  }
  return fields;
}

const C = "packages/dopl-client/src/";
/** `[interface, client file, server file]` — every same-named pair, measured 2026-10-11. */
const TWINS: Array<[string, string, string]> = [
  ["AccessMatrix", "member-types.ts", "src/features/teams/types.ts"],
  ["AccessMatrixResource", "member-types.ts", "src/features/teams/types.ts"],
  ["AccountChannelStatus", "account-types.ts", "src/features/channels/types-account.ts"],
  ["AccountStatus", "account-types.ts", "src/features/channels/types-account.ts"],
  ["AccountStatusClips", "account-types.ts", "src/features/channels/types-account.ts"],
  ["AccountWaitingItem", "account-types.ts", "src/features/channels/types-account.ts"],
  ["AgentIdentity", "agent-identity-types.ts", "src/features/agent-identities/types.ts"],
  ["ChannelContainer", "types.ts", "src/features/channels/types-list.ts"],
  ["ChannelPendingLink", "home-types.ts", "src/shared/links/types.ts"],
  ["DisplayAnswerStamp", "display-types.ts", "src/features/display/core/types.ts"],
  ["HomeChannelCreateResult", "home-types.ts", "src/features/home/types.ts"],
  ["IdentityField", "agent-identity-types.ts", "src/features/agent-identities/types.ts"],
  ["IdentityKnowledgeBaseRef", "agent-identity-types.ts", "src/features/agent-identities/types.ts"],
  ["IdentityKnowledgeFolderBrief", "agent-identity-types.ts", "src/features/agent-identities/types.ts"],
  ["IdentityKnowledgeRef", "agent-identity-types.ts", "src/features/agent-identities/types.ts"],
  ["KnowledgeBase", "knowledge-types.ts", "src/features/knowledge/types.ts"],
  ["KnowledgeEntry", "knowledge-types.ts", "src/features/knowledge/types.ts"],
  ["KnowledgeFolder", "knowledge-types.ts", "src/features/knowledge/types.ts"],
  ["KnowledgeTreeSnapshot", "knowledge-types.ts", "src/features/knowledge/types.ts"],
  ["MemberTeamRef", "member-types.ts", "src/features/teams/types.ts"],
  ["Ontology", "ontology-types.ts", "src/features/ontology/types.ts"],
  ["OntologyListItem", "ontology-types.ts", "src/features/ontology/server/dto.ts"],
  ["OntologyObject", "ontology-types.ts", "src/features/ontology/types.ts"],
  ["OntologyObjectSummary", "ontology-types.ts", "src/features/ontology/server/dto.ts"],
  ["OntologySnapshot", "ontology-types.ts", "src/features/ontology/types.ts"],
  ["OntologySummary", "ontology-types.ts", "src/features/ontology/server/dto.ts"],
  ["ResolvedSkill", "skill-types.ts", "src/features/skills/types.ts"],
  ["ResolvedSkillReference", "skill-types.ts", "src/features/skills/types.ts"],
  ["Skill", "skill-types.ts", "src/features/skills/types.ts"],
  ["SkillConnector", "skill-types.ts", "src/features/skills/types.ts"],
  ["SkillFile", "skill-types.ts", "src/features/skills/types.ts"],
  ["TeamGrant", "member-types.ts", "src/features/teams/types.ts"],
];

describe("@dopl/client twins carry every field their server type has", () => {
  for (const [name, clientFile, serverFile] of TWINS) {
    it(`🔒 ${name} (${clientFile} ⊇ ${serverFile})`, () => {
      const client = fieldsOf(read(C + clientFile), name);
      const server = fieldsOf(read(serverFile), name);
      // Controls: a rename or move on either side must fail loudly, not compare two empty sets.
      expect(client, `${name} not declared in ${C}${clientFile}`).not.toBeNull();
      expect(server, `${name} not declared in ${serverFile}`).not.toBeNull();
      expect(server!.size, `parsed no fields from server ${name}`).toBeGreaterThan(0);
      const missing = [...server!].filter((f) => !client!.has(f)).sort();
      expect(missing, `client ${name} lacks server field(s); add them as OPTIONAL`).toEqual([]);
    });
  }
});
