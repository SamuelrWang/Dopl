// What a real `codex app-server` answers to `thread/start|resume` for the params Dopl sent: the REQUIRED
// echo fields of `ThreadStartResponse` (schema measured on codex-cli 0.155.1 — approvalPolicy,
// approvalsReviewer, cwd, model, sandbox as a typed object). Unit fakes spread this into their answer so
// they exercise the fail-CLOSED echo check (`policy.js › assertThreadTook`) the way the real server does.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const policy = require(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "main", "runtime", "codex", "policy.js"));

export function threadEcho(params) {
  const p = params || {};
  const asked = p.approvalPolicy !== undefined ? p.approvalPolicy : (p.config && p.config.approval_policy);
  return {
    approvalPolicy: asked === undefined ? "on-request" : asked,
    approvalsReviewer: p.approvalsReviewer ? "auto_review" : "user",
    cwd: p.cwd,
    model: p.model || "gpt-x",
    modelProvider: "openai",
    sandbox: { type: policy.SANDBOX_ECHO[p.sandbox] || "workspaceWrite", networkAccess: false, writableRoots: [] },
  };
}
