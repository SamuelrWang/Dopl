# Guest web channel — spec (Samuel, 2026-08-25)

**Owner ruling:** an external person (no Dopl desktop) must be able to talk to Samuel's
agent through a single web link. Use case: coffee-chat scheduling with a LinkedIn
contact — they claim a link, land in ONE channel in the browser, and converse with the
operator's agent. Friction target: link → Google sign-in → talking, under a minute.

## What this is NOT
- Not a web version of the app. The desktop-only pivot stands. This is a GUEST LANE:
  one channel, no rail, no sidebar, no workspace surfaces, no settings.
- Not a new sharing model. It reuses the channel-first machinery shipped 2026-08-24/25:
  bound links (`channel_links.workspace_id`), claim-into-membership
  (`src/features/home/server/service-claim-bound.ts`), 2-member `kind='link'`
  containers with the DB member-cap trigger.

## Architecture (decided, build to this)
1. **Same links, new destination.** The existing Add-person link and claim flow are
   untouched through the claim write. After a successful claim, the claim page
   (`src/app/link/[token]/page.tsx` + `claim-card.tsx`) branches:
   - Desktop installed (current behavior): deep-link `dopl://open/home`.
   - Otherwise: navigate to the NEW web route (below). Detection: attempt the custom
     scheme with a visible fallback link — never trap the user on a dead deep link.
     A claimer who ALREADY had the channel (existing:true) gets the same branch.
2. **New web route** (Next app router, e.g. `src/app/c/[workspaceId]/page.tsx` or a
   token-free equivalent the research phase justifies): auth-gated (`withUserAuth`
   session model — web cookie session already exists for the claim flow), resolves the
   caller's membership in that container (404 when not a member — the home fence
   idiom), and mounts the shared channel surface
   (`src/features/channels/components/channels-v2/channel-surface-standalone.tsx`)
   full-viewport with `capabilities={{ memberManagement: false }}`.
3. **Realtime on the web.** The shared registry
   (`src/shared/realtime/shared-channel-registry.ts`) has a non-bridge (websocket)
   branch — verify it works for this surface in a browser and wire the same doorbell
   contract the desktop uses (`live.ts`). Events are doorbells, never content.
4. **Reads/writes** ride the existing `/api/channels/**` routes with
   `X-Workspace-Id` = the container id. No new channel endpoints expected; any gap
   found goes through the repo's repository/service/handler split with the same
   membership fences.
5. **Agent responsiveness** is the existing model: the operator's machine runs the
   agent; the guest's messages wake it per the operator/@-directed rule. Out of scope:
   cloud runtime. The known ceiling (operator machine asleep = no replies) is
   accepted for MVP and documented.

## Security model (decided)
- Account REQUIRED at claim (already true — sessionOnly). Google OAuth is the
  friction-minimal path; whatever the existing web auth offers is acceptable.
- Links stay single-use, expiring, revocable, identity-pinned at claim. Pre-claim
  forwarding risk = first-claimer-wins, accepted (operator sees who claimed, can
  delete the channel).
- The guest sees exactly one container: their membership fence is the workspace
  membership row. No rail, no workspace lists, no other channels. Verify no API the
  page calls leaks workspace/member data beyond the container.
- `PUBLIC_ROUTES` prefix hazard (INVARIANTS §4A): any new route must be re-checked
  against `shared/auth/public-routes.ts`; proxy.test.ts pins it.

## Constraints (repo law — binding on every agent)
- Read `CLAUDE.md`, `docs/INVARIANTS.md` (§4, §4A, §5, §7, §8, §9, §12, §14),
  `docs/DESIGN-SYSTEM.md` before writing code. Precedence: code > INVARIANTS > ENGINEERING.
- 500-line cap per file. Tokens/kit lockstep (globals.css + desktop tokens/kit copies).
- New payload fields on cached types: absent-fallback + stale-cache test fixture
  (INVARIANTS §8 rule, 2026-08-25).
- Definition of green = the FULL gate table (INVARIANTS §14): five suites, two lints,
  two typechecks, doc-refs, size-check, knowledge-drift. Desktop-ui typecheck is
  separate from root. Run all before claiming a milestone.
- Migrations: new files only; apply via Supabase MCP with verification reads; §12
  header conventions. (This feature likely needs NO schema change — justify any.)
- NEVER `git push`. Local commits at green milestones are allowed and encouraged,
  message style per `git log`. NEVER deploy.
- Doc ritual: INVARIANTS updated for new routes/contracts; findings to
  REFACTOR-FINDINGS (next free F-id — verify); ENGINEERING stratum only if the
  rationale earns it.
- Dev stack is running (vite 5173, Next 3001, Electron). The web route is testable at
  http://localhost:3001. Do not kill these processes.

## Milestones
- **M0 research**: map the claim flow, web auth/session on the Next tree, the shared
  surface's web-mount requirements (providers, query client, realtime branch,
  transport — the SPA uses an IPC transport; the web needs the fetch transport),
  and the desktop-detection pattern for the claim handoff. Deliverable: a short
  written plan in this file's directory (`guest-web-channel.plan.md`) with file paths.
- **M1 web mount**: the `/c/...` route renders the shared surface for a member of a
  link container, reads working (transcript, threads, info), no realtime yet.
- **M2 live + writes**: posting, doorbell refetch/realtime, composer parity where it
  makes sense for a human guest (no agent-launch controls for guests).
- **M3 claim handoff**: the claim page branch, plus revoke/expiry states rendering
  honestly on the web.
- **M4 hardening**: leak review (what every API call returns to a guest), the
  PUBLIC_ROUTES check, gates, docs, findings.

## Working protocol (orchestrator — binding)
- Orchestrate from the channel main room. Post a MILESTONE line when each milestone
  starts and lands (op=milestone or a short post). Post a short STATUS report roughly
  every 30 minutes of active work: what landed, what is next, any risk.
- Delegate research and building to Opus subagents (`model: claude-opus-5` — your
  harness's subagent mechanism). Keep per-agent scopes disjoint; you own integration
  and the gate runs.
- **Never guess on a ruling.** If blocked on a product decision, an unclear contract,
  a failing gate you cannot explain, or anything destructive: post a main-room
  message beginning `BLOCKED:` stating the decision needed and the options, then
  wait. The supervising session reads the channel periodically and will answer in
  the channel. Do not proceed past a BLOCKED post until answered.
- Samuel reviews live; never verify by screenshot-and-declare — state what you
  changed and where, run the gates, and let the channel narrate progress.
