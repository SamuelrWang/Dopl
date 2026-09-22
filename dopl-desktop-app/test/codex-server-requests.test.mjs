import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const requests = require(join(HERE, "..", "main", "runtime", "codex", "server-requests.js"));

test("command and file requests show their measured inputs and return one-shot decisions", async () => {
  const seen = [];
  const decide = async (name, input) => {
    seen.push({ name, input });
    return name === "commandExecution" ? "allow" : "deny";
  };
  const command = await requests.answer({
    id: 1,
    method: "item/commandExecution/requestApproval",
    params: { itemId: "i1", command: "npm test", cwd: "/repo", reason: "verify" },
  }, decide);
  const file = await requests.answer({
    id: 2,
    method: "item/fileChange/requestApproval",
    params: { itemId: "i2", grantRoot: "/repo/src", reason: "edit source" },
  }, decide);

  assert.deepEqual(command, { decision: "accept" });
  assert.deepEqual(file, { decision: "decline" });
  assert.deepEqual(seen, [
    { name: "commandExecution", input: { command: "npm test", cwd: "/repo", reason: "verify" } },
    { name: "fileChange", input: { grantRoot: "/repo/src", reason: "edit source" } },
  ]);
});

test("permission grants are turn-scoped and denials grant an empty profile", async () => {
  const asked = { network: { enabled: true }, fileSystem: null };
  const allowed = await requests.answer({
    id: 3, method: "item/permissions/requestApproval",
    params: { itemId: "i3", permissions: asked, reason: "download dependency" },
  }, async () => "allow");
  const denied = await requests.answer({
    id: 4, method: "item/permissions/requestApproval",
    params: { itemId: "i4", permissions: asked },
  }, async () => "deny");

  assert.deepEqual(allowed, { permissions: asked, scope: "turn" });
  assert.deepEqual(denied, { permissions: { fileSystem: null, network: { enabled: false } }, scope: "turn" });
});

test("unsupported interactive requests fail closed with method-valid responses", async () => {
  assert.deepEqual(
    await requests.answer({ method: "mcpServer/elicitation/request", params: {} }, async () => "allow"),
    { action: "decline" },
  );
  assert.deepEqual(
    await requests.answer({ method: "item/tool/requestUserInput", params: {} }, async () => "allow"),
    { answers: {} },
  );
  await assert.rejects(
    requests.answer({ method: "future/request", params: {} }, async () => "allow"),
    (error) => error && error.rpcCode === -32601,
  );
});

test("a failed Dopl gate denies with the request method's valid shape", async () => {
  const boom = async () => { throw new Error("gate failed"); };
  assert.deepEqual(
    await requests.answer({ method: "item/commandExecution/requestApproval", params: {} }, boom),
    { decision: "decline" },
  );
  assert.deepEqual(
    await requests.answer({ method: "item/permissions/requestApproval", params: { permissions: {} } }, boom),
    { permissions: { fileSystem: null, network: { enabled: false } }, scope: "turn" },
  );
});
