# Session handoff — 2026-08-05

Written for the session that picks this up. Two jobs: **(1) verify this work, (2) continue it.**

Everything below is committed on `master` and **NOT PUSHED** — 23 commits, `b1f3d76..2482017`.
The desktop version is deliberately still **1.8.7**; 1.9.0 has not been cut.

---

## 0. Read this first — two traps that produced false "all clear" in this session

**1. `cmd | tail` reports the PIPE's exit code, not the command's.** This produced a
false "lint clean" while eslint was failing, and nearly did it again for a test suite.
Always capture the real status:

```bash
npm run lint > /tmp/x.log 2>&1; echo "exit=$?"
```

**2. Desktop tests read `main/*.js` as SOURCE and slice pure blocks out of them — they
do not `require()` the module.** Twice this session a module was fatally broken with the
whole suite green:
- a deleted module's name left in `session-engine.js`'s `module.exports` object →
  `module.exports = {…}` is *evaluated* → `ReferenceError` → **the desktop had no session
  engine for two phases**;
- a duplicated `function nameForSession` (desktop eslint carried only `max-lines`, so
  `no-redeclare` never ran; source-slicing evaluates both declarations and returns the winner).

So **always** load the changed modules directly:

```bash
node -e "require('./dopl-desktop-app/main/session-engine.js')"; echo "exit=$?"
```

Guards now exist for both (`test/main-exports-defined.test.mjs`, `no-redeclare`), but the
*class* is structural — a source-slicing test can hide anything that breaks at load time.

---

## 1. Verify the work

```bash
cd ~/Downloads/setup-intelligence-engine

# module load (the trap above)
node -e "require('./dopl-desktop-app/main/session-engine.js');\
require('./dopl-desktop-app/main/session-summary.js');\
require('./dopl-desktop-app/main/session-state-push.js')"; echo "exit=$?"

npm test                                  # root  → 2185
cd dopl-desktop-app && npm test           # desktop → 2366
npm run lint                              # desktop → 0
cd .. && npm test -w @dopl/desktop-ui     # SPA → 143
cd packages/mcp-server && npx vitest run  # → 483   (NOTE: has a `test` script now)
cd ../.. && npm test -w @dopl/client      # → 48
npm run typecheck && npm run lint         # 0 errors, 2 KNOWN warnings
npx next build && npm run build:ui        # both clean
```

**Known pre-existing flake:** `src/shared/version/latest-release.test.ts` (real-timer,
fails under full-suite load, passes in isolation). Re-run before concluding anything.

**CI now runs all of this** (`.github/workflows/ci.yml`). Before this session, CI ran
**48 of 5 120 tests** — root had no `test` script and the workflow only touched
`@dopl/client`. That is exactly how the two invisible breakages above stayed green.

---

## 2. What was done, and why

Chronological. The *why* matters more than the *what* — several are Samuel's product
calls and should not be re-litigated (see §5).

### 2a. Min-version gate → 1.8.3 (first public SPA-shell release)
- **F-125** the forced-upgrade floor: `GET /api/version` serves a minimum build; the
  desktop blocks below it and drives the existing updater. Fail-open on every failure;
  two anti-brick guards. Needed because once the website retires, a Mac stuck on an old
  build is stuck forever — no deploy can reach it.
- **F-126** the anti-brick clamp *derives* "latest published" from the release feed
  (`latest-mac.yml`) rather than a hand-bumped env var, which went stale silently.
- **F-127** the landing page's Download button **had never worked** — it guessed a
  version-less asset name; electron-builder stamps the version in. Now `GET /download`
  reads the real name from the channel file. Later **tag-pinned** (F-131) because a
  cached name paired with GitHub's live `latest` 404'd for 10 minutes after every release.
- **F-128** `dopl://open` deep-link verb (the retirement needs it).

### 2b. Auth-first funnel (F-130)
Landing CTA → `/login` → `/get-started`, which auto-starts the download. Rationale:
capture the account *before* the install so drop-off is recoverable, and make the funnel
measurable. Found in passing: `use-login.ts` stamped `redirectTo=/canvas` on **every**
callback, so a plain signup was indistinguishable from a deep link.

### 2c. Channels correctness (1.8.4 → 1.8.6)
- **F-129** the SPA preload never exposed `sessions` → "Open thread" was gone from every
  DM in 1.8.x. The web component self-hides when the bridge is absent, so it failed
  *silently*. A **preload-parity test** now pins the two preloads against each other.
- **F-132** the listener's fetch copy never got the 401 repair → **channels was silently
  dead**; the only failure branch logged nothing. Root cause: the pre-1.8 remote page kept
  the cookie jar fresh, the SPA removed that page, and `getAuthCookie()` only repairs an
  EMPTY jar, never a STALE one. Recovery was sign-out/in — nothing else worked.
- **F-133** an agent's answer was **structurally undeliverable** (terminal-kind bodies were
  never pushed to the render entries), and the fresh-install trigger gate dropped every
  request (it probed for an *external* `claude` on PATH while sessions run the *bundled*
  binary — so any install without the CLI received nothing, silently).
- **F-138** "I set bypass and it still asks me" — **three mechanisms, one symptom**, which
  is why every previous fix failed. (i) a session *waiting on the peer* was treated as idle
  and parked after 15 min, and the park reset both postures; (ii) postures/grants did not
  survive; (iii) read-only channel ops gated in every posture. Samuel's rule: *within a
  session, what I set stays set.*
- **F-139** the gate hardcoded **one** MCP server name, so on a claude.ai-connector machine
  every Dopl tool was `unclassified` and gated forever — unfixable by any setting. **The
  security half:** the same blindness broke the hard-deny list (`deny` → `gate`).

### 2d. Web-app retirement
- **F-134** billing becomes its own page (`/billing/[segment]`), every money URL repointed
  off `/canvas`, plus two `proxy.ts` redirect bugs (query dropped from `redirectTo`;
  `redirectTo` ignored when already signed in).
- **F-135 — Stage B executed.** All product web pages 302 to `/get-started` behind
  `WEBSITE_RETIRED` (default ON, env-off override). **Nothing deleted.** Reversible two
  ways: `WEBSITE_RETIRED=0` in Vercel, or the `pre-retirement-2026-08-05` tag.
- **F-136** the retirement ate the deep link the onboarding detour was carrying —
  invite / join / MCP-OAuth / password-reset first-run arrivals landed on bare
  `/get-started`. Root cause class: **a seam between two individually-correct commits**,
  with no test crossing both layers.
- **Stage C live:** the version floor rides **code** (`DEFAULT_MIN_VERSION`), env is the
  override. `/api/version` serves `{"minSupported":"1.8.5","latest":"1.8.5"}`.

### 2e. The channels rollback — named agents out, sessions in (5 phases)
Scope doc: `docs/CHANNELS-ROLLBACK-PLAN.md` (history, not a status board).
Law: **`docs/ENGINEERING.md` §18**, per phase.

| | What | Why |
|---|---|---|
| **F-140** | One initiating behaviour; the `desktop-ui` stamp | Three different things happened depending on how a request was posted; the "shell" tier existed only because the app could not prove its own UI posted |
| **F-141** | The rip-out: summon, `@tagging`, engagement, breakout rooms | The model was not useful, and it carried three defects that *evaporate* with it rather than needing fixes |
| **F-142** | Session pills (working/idle/ended) | A session **is** an agent session; one projection module, phase-first for terminal states |
| **F-143** | Two composer pills | The syntax they replace was undiscoverable |
| **F-144** | Three MCP ops: spawn-with-handoff, message-a-session, read-session-state | Replaces what summon/`to_agent` covered |
| **F-145** | Review fixes | see §3 |
| **F-146** | Residue pass + CI | see §3 |
| **F-147** | The session-state writer | closes F-144's flagged gap |

**No destructive DB migration.** Historical messages keep their agent attribution and
still render. Cleanup drops are listed in dependency order in **F-141**.

---

## 3. What the three-lens review found (and what it says about this codebase)

Three read-only reviewers (correctness / cleanliness / security) ran over the whole
rollback. Verdict: architecture sound, execution had contained defects — **two of which
would have shipped broken.**

- **`read_sessions` would have 500'd**, not returned empty, while three code comments and
  a finding all claimed it degraded gracefully. Now degrades on `PGRST205` *and* has a writer.
- **The MCP layer silently stripped removed params.** P2's proudest design — "removed
  params are *refused*, not stripped" — was only true at the HTTP layer; the MCP SDK parses
  with a non-strict schema. Fixed properly by registering **strict** schemas via
  `registerTool` (probed against the real SDK, not assumed). All four test mocks now expose
  `registerTool` and deliberately **not** `tool`, so a revert is a TypeError.
- **The agent-attribution metadata strip had no test at all** — mutation-proven: deleting
  any of the three `delete metadata.…` lines left all 2 109 tests green. It is the *sole*
  defence against attributing your words to somebody's retired agent.
- **Three surviving behaviours lost their guards** when mixed-subject test files were deleted.
- **Security: no vulnerability introduced; the rollback tightened things.** But the docs
  claimed a protection that does not exist — see §5.

---

## 4. What is left to do

### 4a. SHIP 1.9.0 — Samuel's gate, and the ORDER MATTERS
1. **Apply `supabase/migrations/20260805120000_channel_sessions.sql`** — additive only.
   **Must land with the deploy**: the read degrades gracefully, but the writer's POST
   answers 500 until the table exists (logged once per workspace per run, by design).
2. Bump `dopl-desktop-app/package.json` → **1.9.0**.
3. Push `master` (Vercel deploys the server).
4. Notarized release. **Release-ops gotchas, learned the hard way:**
   - `GH_TOKEN` is absent in the agent shell — use `GH_TOKEN=$(gh auth token) DOPL_NOTARY_PROFILE=dopl npm run release`.
   - electron-builder creates a **draft** and the 10-min command timeout kills the big
     uploads mid-flight → finish with `gh release upload` + `gh release edit --draft=false`.
   - **`dist/latest-mac.yml` can be STALE from a prior `npm run dist`.** Publishing it
     breaks *all* auto-updates. Recompute before publishing:
     `shasum -a 512 f | awk '{print $1}' | xxd -r -p | base64`
5. **Raising the floor later** = bump `DEFAULT_MIN_VERSION` *and* `DEFAULT_DECLARED_LATEST`
   in `src/shared/version/desktop-floor.ts` (a test pins floor ≤ latest).

### 4b. Remaining rollback items
- **Streaming** (`includePartialMessages` is off) → unlocks the `thinking` pill state.
  NOTE: the claim "thinking can only come from a stream" is **overstated** — the session
  window already ships a Thinking indicator derived without streaming
  (`session-chrome.js:117-122`).
- **`agent_presence` retirement** — now unblocked to *measure*. It heartbeats every 30 s per
  listener per workspace and is the **quadratic always-on term** (break points ≈26 concurrent
  at burst, ≈82 sustained). The new `channel_sessions` store writes only on state change.
  Expected net reduction — **measure, don't assume.**
- **`message-a-session` steer-my-own** — an external MCP post reaches the server, not a
  specific renderer window. Needs a server→desktop→window route that does not exist.
  Its own phase.
- **`test/live/` rebuild** — deleted in F-141 (all nine checks were built on summoning).
  Genuinely unguarded now: `POST /api/mcp` (the whole JSON-RPC/SSE transport — **no test of
  any tier**), the `metadata.intent` round-trip, `author_kind` → loop brake, the
  `X-Dopl-Runtime` end-to-end, and all 13 `/api/channels/**` routes.
- **Select-to-start** in the main channel (plan §4) — explicitly deferred.

### 4c. Retirement Stages D/E
- **Stage D** — hard-delete the web app tree + the desktop remote shell. **This kills the
  rollback path**, so it was gated on the flip soaking. Cheaper now than the plan estimated:
  the rollback already gutted the channels surfaces.
- **Stage E** — drop `/api/**` from the middleware matcher; knip/docs cleanup.
- Samuel's undecided: `/invite/[token]` (retire vs keep) and `/admin/*` (both currently kept).

### 4d. Open tech debt (tracked)
| Item | Where |
|---|---|
| `ui-sync` credential storm — ~39 k refresh attempts in a second; the failure counter is process-global and inflates every other caller's backoff | task #18 |
| Preload parity — only 2 of **5** preloads are pinned; `session-preload.js`'s 17 `session:*` channels (consent, handoff) are unguarded, and `passwordSignIn`/`sendMagicLink`/`beginSignIn` vanish **silently** if dropped | task #15 |
| Realtime scale prep — publication carries 24 tables; `agent_presence` is the quadratic term | task #16 |
| `CRON_SECRET` unset in Vercel → **all four crons 503 and have never run** (seat reconcile, trash purge, oauth cleanup, thread sweep) | Samuel, dashboard |
| SMTP — built-in sender caps signup email at ~2-4/hr | Samuel, Supabase dashboard |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` unverified in prod (authed bundles only; if missing the payment form never mounts) | Samuel, dashboard |
| F-131 half 2 — `/pricing` pushes a dead `redirect` param nothing reads | open |
| `latest-release.test.ts` real-timer flake | chip |
| `ui-sync.js` `SYNC_TABLES` still names `channel_agents` (dead, but has a pinned contract test) | chip |
| Two test files at exactly 500 lines (`ui-sync`, `session-chrome`) — next assertion fails lint | §2 |
| `session-summary.js` at 486 — next desktop file in line for a split | §2 |
| mcp-server `dist/` ships 66 compiled **test** files (31 `require("vitest")`) — `"exclude": ["src/**/*.test.ts"]` cuts ~40% | noted |
| F-119/F-105/F-110..F-117 residuals — assessed individually, several still live | findings doc |

---

## 5. Settled decisions — do NOT re-open

Each was a deliberate call with reasoning recorded. A fresh session will be tempted to
reverse them.

1. **Thread close is propose-then-confirm.** An agent may *propose*; the human decides.
   Consequence: **closing over MCP is impossible** — the operator must close in the app.
   (The server enforces this; it refused Claude itself mid-session, correctly.)
2. **Postures and grants persist for the whole session.** Samuel's rule. The away-guard
   survives as a 12 h **abandonment end** (terminal beats a silent downgrade — an ended
   session cannot be woken by a peer at all).
3. **An abandoned session KEEPS its window.** Every other end is operator-watched;
   destroying this one makes a transcript vanish for somebody who only stepped away.
4. **Embedded Stripe checkout stays**, and billing living on a web page is fine.
5. **Named agents are gone for good** — no summon, no `@tagging`, no engagement, no
   breakout rooms. Sessions are the agent identity.
6. **No extra consent card for spawn-with-handoff.** Correct, but *not* for the reason
   F-144 originally gave: the same window is already reachable by claiming the other
   runtime stamp, so gating the declared path would only push an attacker to the
   undeclared one. **The real boundary is the identity pair PLUS token custody.**
7. **`agent-names.ts` (web tree) stays** — its role changed rather than expired; it is the
   canonical spec the desktop copy's parity test compares against. Deleting it removes a
   guard, not residue.
8. **Over-matching Dopl tool names is the SAFE direction** (F-139) — Axis B is stricter.

**Known and accepted, not a bug to "fix":** `desktop-session` is credential-agnostic
*by necessity* (a real spawned session authenticates with exactly that device token). So
anything that can read the device token on the operator's Mac can open a window and start
an agent there. Pre-existing; the rollback tightened it. Do not try to bound that value —
it refuses the caller it exists for.

---

## 6. Never verified by any agent

Standing instruction: **agents do not launch the app or self-screenshot** — Samuel reviews
live. So these are unproven, not proven-good:

- **Anything in a running app.** Every UI change this session (pills, composer pills,
  the update-required screen, `/get-started`) is verified by tests and builds only.
- **`read_sessions` end to end** — the migration is unapplied, so nothing ran against the
  real table; conflict target, triggers and CHECKs were matched by reading the file.
- **A completed live sign-in** through the new `/get-started` funnel.
- **Stripe checkout completion** (live keys; deliberately out of bounds).
- **The `dopl://open` deep link against a packaged build** (click-tested once at 1.8.3).
- **Channels interactive smoke** — Samuel's own P0 list: two-party round trip (sub-second =
  realtime healthy; ~45 s = the doorbell is dead and the poll is masking it), notification
  click-through → thread reopens, consent → accept → reply, "Open in Claude Code" (both its
  failure modes are silent).

---

## 7. Orchestration lessons (for whoever runs agents next)

- **One agent per working tree.** Two agents on P4 cross-contaminated: one's `git add -A`
  swept the other's half-written function into a commit (F-143). Use `isolation: "worktree"`
  for anything parallel; keep phase work serial.
- **Re-verify every agent report yourself**, with real exit codes. Reports have been honest
  but were once green against *stale* generated types (`.next`), and a suite can be green
  over a module nothing loads.
- **Flag-don't-fabricate is right, but do not let it become the deliverable.** P5 shipped a
  contract with a flagged gap because the prompt authorised it; the capability the user
  actually asked for needed a follow-up phase (F-147). If a gap is the *point* of the
  feature, dispatch the follow-up rather than listing it as future work.
