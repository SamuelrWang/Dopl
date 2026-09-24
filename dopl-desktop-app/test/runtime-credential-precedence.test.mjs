// DOPL-OWNED CREDENTIALS ONLY. "Signed in" is the credential the next session will actually use: Dopl's
// own token (Claude) or Dopl's own auth.json in the private CODEX_HOME (Codex). The operator's own CLI
// login and any inherited vendor key are ignored by the answer AND stripped from the child env.
// Every operator home here is a temp fixture; nothing reads or writes the real `~/.claude` or `~/.codex`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWithStubs, real } from "./helpers/module-sandbox.mjs";

const cliSpawn = real("./runtime/cli-spawn");
const configHome = real("./runtime/codex/config-home");

const INHERITED = {
  ANTHROPIC_API_KEY: "sk-ant-api-inherited",
  ANTHROPIC_AUTH_TOKEN: "inherited",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-inherited",
  OPENAI_API_KEY: "sk-openai-inherited",
  CODEX_API_KEY: "inherited",
  CODEX_ACCESS_TOKEN: "inherited",
};

// An operator fully signed in to their OWN Claude Code and Codex, with vendor keys in their shell.
function operatorWorld() {
  const root = mkdtempSync(join(tmpdir(), "dopl-cred-precedence-"));
  const home = join(root, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", ".credentials.json"), '{"claudeAiOauth":{"accessToken":"operator"}}');
  writeFileSync(join(home, ".claude.json"), '{"oauthAccount":{"accountUuid":"op-1"}}');
  mkdirSync(join(home, ".codex"));
  writeFileSync(join(home, ".codex", "auth.json"), '{"tokens":"operator"}');
  const saved = { HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME };
  for (const k of Object.keys(INHERITED)) saved[k] = process.env[k];
  Object.assign(process.env, INHERITED, { HOME: home, CODEX_HOME: join(home, ".codex") });
  const userData = join(root, "user-data");
  return {
    userData,
    done: () => {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const claudeCredential = (token) => loadWithStubs("runtime/claude/credential.js", {
  "../../claude-token": { getStoredOAuthToken: () => token },
});

test("Claude: the operator's own login and inherited keys never count as signed in", () => {
  const w = operatorWorld();
  try {
    assert.deepEqual(claudeCredential(null).credentialState(), { usable: false, source: null });
  } finally { w.done(); }
});

test("Claude: Dopl's token is the credential, and the ONLY one the child env carries", () => {
  const w = operatorWorld();
  try {
    const cred = claudeCredential("sk-ant-oat01-dopl");
    assert.deepEqual(cred.credentialState(), { usable: true, source: "dopl-token" });
    const env = cred.withCredential(cliSpawn.scrubbedEnv(process.env));
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-dopl", "Dopl's, not the inherited one");
    for (const key of Object.keys(INHERITED).filter((k) => k !== "CLAUDE_CODE_OAUTH_TOKEN")) {
      assert.equal(env[key], undefined, `${key} is stripped`);
    }
  } finally { w.done(); }
});

test("Codex: the operator's own auth.json and inherited keys never count; Dopl's auth.json does", () => {
  const w = operatorWorld();
  try {
    const env = configHome.isolatedEnv(cliSpawn.scrubbedEnv(process.env), w.userData);
    assert.equal(configHome.hasAuth(w.userData), false, "signed in to Codex in their own home, not for Dopl");
    for (const key of Object.keys(INHERITED)) assert.equal(env[key], undefined, `${key} is stripped`);
    writeFileSync(join(env.CODEX_HOME, "auth.json"), '{"tokens":"dopl"}', { mode: 0o600 });
    assert.equal(configHome.hasAuth(w.userData), true);
  } finally { w.done(); }
});

test("the strip list is the one shared builder's, and it covers every credential either CLI reads", () => {
  assert.deepEqual([...cliSpawn.INHERITED_CREDENTIAL_ENV].sort(), [
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR", "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "CODEX_ACCESS_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY",
  ]);
  const kept = cliSpawn.scrubbedEnv({ PATH: "/bin", HOME: "/h", ANTHROPIC_BASE_URL: "https://x", ...INHERITED });
  assert.deepEqual(kept, { PATH: "/bin", HOME: "/h", ANTHROPIC_BASE_URL: "https://x" });
});
