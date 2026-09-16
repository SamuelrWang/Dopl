# DIRECTION-DROP-TRACE

Investigation, 2026-09-15. Read-only. No code changed.

**Symptom as reported:** private directions (`dopl_channel op="manage" action="direct"`) to agent
`k2k2q9fh` in channel `bb0f57db` never arrive — 3/3 filed, all `pending`, `claimed=no`, all expired
unclaimed. Suspected cause: the naming rework (`36bd2c67`) changed the directive claim/match key, so
post-rework spawns never match their pending directions.

## Verdict

**The naming rework is not involved. The private direct lane has never delivered a single
direction on this machine, since the day it shipped.**

The lane's standing consent — `orchestratorDirectEnabled` — is **absent from the electron-store**,
so `getOrchestratorDirect()` returns `false`, and gate 1 of the delivery funnel returns silently
before any claim is attempted. It is absent because **no UI was ever built that can set it.**

Location of the drop:

```
dopl-desktop-app/main/agent-directions.js:198
  async function handle(raw, workspaceId) {
    if (!armed || !enabled()) return;   // ← every direction dies here
```

`enabled()` (`agent-directions.js:49-55`) reads `channelPrefs.getOrchestratorDirect()`, which is
`orchestrator-consent.js:118-124`:

```
const ORCHESTRATOR_DIRECT_KEY = 'orchestratorDirectEnabled'; // a bare boolean
function getOrchestratorDirect() {
  try { return store.get(ORCHESTRATOR_DIRECT_KEY) === true; }
  catch (_err) { return false; }
}
```

Store state on this machine (`~/Library/Application Support/dopl-desktop/config.json`):

| key | value |
|---|---|
| `orchestratorLaunchEnabled` | `true` |
| `orchestratorDirectEnabled` | **absent** |

The two lanes are deliberately separate toggles (`orchestrator-consent.js:15-18, 100-116` — "ONE
TOGGLE PER CAPABILITY, NEVER ONE FOR THE FAMILY"). The launch one is armed; the direct one is not,
and cannot be.

`agent-directions.js:26-28` makes the failure invisible by design:

> ⚠ **OFF MEANS SILENT.** No claim, no decide, no diag per row — the row expires and the
> orchestrator sees that.

So: row filed → realtime frame arrives → gate 1 drops it → no claim, no refusal, no per-row log →
row lazy-expires → caller reads `pending, claimed=no`. Exactly the reported shape.

## Why the toggle cannot be set

The consent has a complete plumbing chain except its last link:

| layer | file | present? |
|---|---|---|
| store getter/setter | `main/orchestrator-consent.js:116-138` | ✅ |
| IPC pair (`appWindowOnly`) | `main/channel-dir-ipc.js:361-366` | ✅ |
| preload bridge `dopl.orchestratorDirect` | `renderer/app-preload.js:196-199` | ✅ |
| bridge type | `src/shared/lib/spa-bridge.ts:97` | ✅ |
| React hook | `src/features/channels/hooks/use-orchestrator-direct.ts` | ❌ **does not exist** |
| Settings switch | `src/features/channels/components/settings-agent.tsx` | ❌ **launch lane only** |

`settings-agent.tsx:87,172-216` imports and renders exactly one orchestrator switch,
`useOrchestratorLaunch()`. There is no sibling for the direct lane, and `git log --all` finds no
`use-orchestrator-direct.ts` that ever existed. `grep` over `dopl-desktop-app/renderer` finds the
bridge declared at `app-preload.js:196` and **called by nothing**.

The setter is reachable only by a hand-edit of `config.json` or a devtools `ipcRenderer.invoke`.
By Samuel's own rule the operator is the only party who may grant this — and the app gives them no
way to.

## Evidence: the claim has never happened, for anyone

Queried `channel_agent_directions` directly (service role, read-only):

- **38 rows total**, earliest `2026-08-31T23:18:02Z` — the day the lane shipped (`0e2930f4`,
  2026-08-31, "direction lane, escalation cards…").
- **`claimed_at IS NOT NULL` → 0 rows.** Zero. Ever.
- **Status spread: 38/38 `pending`.** No `delivered`, no `refused`.

Contrast, same machine, same socket, same operator, same realtime workspace filter:

- `channel_launch_directives`: **140 of 142 claimed.** The launch lane works because its toggle
  is on.

### The three reported rows

| direction id | agent | created | status | claimed_at |
|---|---|---|---|---|
| `884f1249-…f5e6` | `k2k2q9fh` | 23:32:56Z | pending | null |
| `50c19229-…4a` | `k2k2q9fh` | 23:35:37Z | pending | null |
| `fe18f03a-…b3` | `k2k2q9fh` | 23:51:25Z | pending | null |

(a fourth, `d875926d-…f59c`, 23:46:35Z, same agent, same state — not in the brief)

All well-formed: `agent_id` is a valid 8-char instance id, `channel_id` is the right channel,
`operator_user_id` = `2dac1943…` (Samuel), `task_id` null (channel-level), `sender_agent_id`
`c65ym2fl`. **Nothing about these rows is malformed and nothing about them is post-rework-specific.**

### The "working contrast" cases did not work either

Prime's widened report names `7891a3da` (20:39Z, agent `o9wj5bzn`) as the last direction
*delivered and acted on*, and puts the cutoff at ~22:38Z when the rework went live. The table
disagrees:

| direction id | agent | created | status | claimed_at |
|---|---|---|---|---|
| `7891a3da-…2d0` | `o9wj5bzn` | **20:39:38Z** | **pending** | **null** |
| `a2301e64-…f656` | `o9wj5bzn` | 20:31:19Z | pending | null |
| `200c09dc-…f57b` | `cn19np53` | 20:27:04Z | pending | null |
| `23d72712-…a93f` | `cn19np53` | 20:04:28Z | pending | null |
| `4b17cd9a-…2439` | `z9imv68v` | 18:50:44Z | pending | null |
| `af64c1a9-…7ed` | `jdk64wmb` | **2026-09-06** | pending | null |

**There is no cutoff at 22:38Z.** The pre-rework agents that appeared to act on directions were
reached some other way — room `@`-mentions, their launch body, or the operator's own composer —
which is exactly what Prime observed empirically ("only room posts deliver") and then attributed to
the wrong cause. `k2k2q9fh` being the first post-rework spawn is coincidence.

### Ruled out explicitly

- **Claim/match key changed by the rework** — the claim (`agent-directions.js:239-256`) keys on the
  direction's own **uuid**, never on an agent name or id. `36bd2c67` touched no file on this lane:
  its desktop footprint is `agent-identity-commit.js`, `agent-name-unique.js`,
  `launch-directive-*.js`, `prompt-framing*.js`, `runtime/claude/axis-b.js`. `agent-directions.js`,
  `agent-direction-wire.js`, `realtime-mailboxes.js` and every `service-directions.ts` /
  `repository-directions.ts` path are untouched by it (`git log` on those paths stops at `94b2d26f`).
- **Wire narrowing dropping the row** (`agent-direction-wire.js:121-153`, the F-284 shape) — would
  require a bad `id`, `channel_id` or `agent_id`. All three are valid on all three rows;
  `k2k2q9fh` passes `AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/`.
- **Owner re-check (gate 3)** — `operator_user_id` on all rows is the signed-in user.
- **Migration `20261006120000`** — adds `agent_name` / `applied_agent_name` to
  `channel_launch_directives` only. It does not touch `channel_agent_directions`.
- **Server-side refusal at create** — rows were filed, so membership, thread, `agentIsAnotherMembers`
  and the presence gate all passed (`service-directions.ts:createAgentDirection`).
- **Rate bound / delivery refusal** — both run *after* the claim and would write `refused`, not leave
  `pending`.

## Affected population

**Every private direction ever filed against any machine whose operator has not hand-set
`orchestratorDirectEnabled`.** Since nothing in the shipped app can set it, that is in practice
**every machine, and every direction since 2026-08-31** — 38/38 here.

This is wider than the brief assumed (not "post-rework spawns") and wider than Prime's revision
(not "since 22:38Z"). The direct lane has been dead on arrival for 15 days. The MCP surface
advertises it, the server files rows for it, the TTL expires them, and no machine has ever been
able to consent to claiming one.

Blast radius is time and confusion only: no direction body was lost — the rows are all still in the
table with their `body` intact.

## Fix proposal

**No code written pending ruling.** Three pieces, in order.

**1. Build the missing consent control (the actual fix).**
Add `src/features/channels/hooks/use-orchestrator-direct.ts` as a mirror of
`use-orchestrator-launch.ts` (same bridge-absent handling, same optimistic-revert-on-`{ok:false}`
contract), and a second switch beside the launch one in `settings-agent.tsx`. Keep them two
switches — `orchestrator-consent.js:15-18` is explicit that one flag for the family is wrong.
Copy needs to state the grant plainly: *"Let your own agents send private directions to agents
already running on this Mac."* Everything below the hook already exists and is tested
(`test/_ipc-ops-table.mjs:80-81,203-204` already covers both IPC ops).

**2. Make the silence honest on this lane — needs Samuel's ruling, it is a doctrine change.**
`agent-directions.js:26-28` justifies silence with *"a refusal from a machine that has not opted in
would itself admit the machine is listening."* That argument is sound on a lane with a third-party
caller. **It does not hold here:** `operator_user_id` is `ctx.userId` and is never a parameter
(`service-directions.ts:41-45`), so the only party who can file a direction against this machine is
the operator themselves. There is nobody to conceal the machine from, and the concealment cost 15
days of directions that looked delivered.
Minimal honest version: have the desktop publish a `directLaneArmed` bit on the presence/session
projection it already pushes, and have `opDirectAgent` answer *"your machine has not armed the
direct lane — turn it on in Settings › Agents"* instead of filing a row that is guaranteed to
expire. Fails closed (unknown ⇒ file the row, today's behaviour).

**3. Regression guard.**
A test that asserts the SPA renders a control for every `dopl.*` consent bridge the preload exposes.
This bug is precisely a bridge with no caller, and a lint-shaped check is what would have caught it
at `0e2930f4`. `scripts/check-*-drift.ts` is the established pattern in this repo.

**Immediate unblock, if wanted before any of the above:** set `orchestratorDirectEnabled` to `true`
in `~/Library/Application Support/dopl-desktop/config.json` and restart the desktop app. That arms
the lane with the code exactly as it stands. It is a hand-edit, not a fix, and it re-arms nothing on
any other machine.

## Files read

`dopl-desktop-app/main/`: `agent-directions.js`, `agent-direction-wire.js`, `orchestrator-consent.js`,
`channel-prefs.js`, `channel-dir-ipc.js`, `realtime-mailboxes.js`, `directive-agent-ops.js`,
`realtime.js` · `dopl-desktop-app/renderer/app-preload.js` ·
`src/features/channels/`: `server/service-directions.ts`, `components/settings-agent.tsx`,
`hooks/use-orchestrator-launch.ts` · `src/shared/lib/spa-bridge.ts` ·
`packages/mcp-server/src/tools/`: `channel-dispatch-agents.ts`, `channel-ops-direct.ts`,
`channel-agent-id.ts` ·
`supabase/migrations/20261006120000_channel_launch_directives_agent_name.sql` ·
`git show 36bd2c67`, `git log` on the direction paths ·
`channel_agent_directions` + `channel_launch_directives` (read-only REST queries).
