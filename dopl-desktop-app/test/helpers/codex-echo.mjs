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

/** What `config/read` answers for a child spawned with Dopl's `-c key=<toml>` argv: those values, as the
 *  real server reports its `sessionFlags` layer (measured 0.155.1). Parses only the TOML subset
 *  `proc-config.js › toml` writes. */
export function configEcho(args) {
  const config = {};
  const a = Array.isArray(args) ? args : [];
  for (let i = 0; i < a.length - 1; i += 1) {
    if (a[i] !== "-c") continue;
    const at = a[i + 1].indexOf("=");
    const key = a[i + 1].slice(0, at);
    const text = a[i + 1].slice(at + 1);
    try { config[key] = JSON.parse(text.replace(/" = /g, '": ')); } catch (_) { /* not one of Dopl's restriction flags */ }
  }
  return { config, origins: {} };
}
