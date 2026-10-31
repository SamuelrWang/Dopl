# Live data plan: Connect page, API keys, Team, portal shell

Read-only mapping, 2026-10-31. Paths are relative to the `dev-portal-redesign` worktree. No code changed.

**How to read this**
- Anything cited as `path › symbol` was read in code. Production figures come from read-only SELECTs (counts, schema, non-secret key flags).
- `[A]` marks an assumption or something not traced to the end.
- Statuses: **LIVE today** = the real server, API or `/developers` page already does this, and the demo UI only needs wiring to it. **DATA EXISTS** = the data is stored but nothing queries it for this purpose. **NEEDS NEW DATA**, **NEEDS PRODUCT DECISION**, **CUT** are as named.
- Sizes [A]: S = under half a day, M = 1 to 2 days, L = more than 2 days.

## Production today (mrefkedvdehahjejreae)

| Thing | Rows | Meaning |
|---|---|---|
| `dev_orgs` | 1, internal | Only "Dopl App" exists. No customer org. |
| `dev_org_members` | 1, role owner | Samuel alone |
| `dev_org_invites` | 0 | Invites never used in prod |
| `dev_projects` | 1, branding empty | |
| `dev_api_keys` | 2 | 1 live secret (has been used), 1 test secret (never used). All 4 scopes on both. **No publishable key.** |
| `connect_sessions` | **0** | **The hosted Connect flow has never run in prod.** |
| `connections` | 4, all live and active | Came from the prosumer migration, not from Connect [A: inferred from 0 sessions] |
| `devices` (SDK) | 4, all `live`, all `even_g2` | |
| `dev_end_users` | 1 | |
| `dev_events` | 14, all `live` | **Test env is empty.** The portal defaults to test, so a cold open looks empty. |

---

## 1. Tables per page

### Connect page (`_sections/connect.tsx`, `connect-test.tsx`)

Nothing here is wired. There is no `/developers/connect` page and no `/api/developers/*` route that touches Connect (`src/app/api/developers/` holds only invites, keys, orgs, playground, projects).

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Test badge in header | LIVE today | URL `env`, `portal/scope.ts › parsePortalParams` | Wire to URL state | S |
| Draft / Published badge | NEEDS PRODUCT DECISION | None | Recommend one saved config and an "unsaved changes" state; see Q1. Sessions already snapshot branding, so an edit cannot disturb an open session (`service.ts › createConnectSession`) | S |
| Publish button | NEEDS NEW DATA | None | Becomes Save, calling a new PATCH route | S |
| Open test link | NEEDS NEW DATA | Demo answers through a browser `fetch` shim (`connect-test.tsx › ConnectTest`), nothing reaches the server | New session-auth route that calls `createConnectSession`; see "test link" below | M |
| Test dialog: choose, pair, consent | LIVE today | `src/app/connect/[token]/connect-flow.tsx › ConnectFlow`, the same component the demo renders | Keep the shim for a local draft preview, or open the real URL in a new tab | S |
| Name | DATA EXISTS | `dev_projects.branding.display_name`, read by `connect/store.ts › projectBranding`; schema `ConnectBrandingSchema`, max 80 chars | Add read and write route. **No writer exists anywhere; 0 of 1 projects have branding** | S |
| Button color + swatch | DATA EXISTS | `branding.accent_color`, `#RRGGBB` | Same route | S |
| Logo dropzone | NEEDS NEW DATA | `branding.logo_url` exists, no storage. Demo uses a local `createObjectURL`, which dies on reload | New public bucket and upload route, copying `workspaces/server/icon.ts`. Drop SVG; see §3 | M |
| Redirect URLs list, add, remove | NEEDS NEW DATA | No project-level store. Session's `connect_sessions.redirect_uri` only | New column plus **enforcement** in `createConnectSession`. The list means nothing without enforcement | M |
| Start a session snippet + Copy | LIVE today | `packages/sdk/src/client.ts › connectSessions.create`; `requested_scopes`, `redirect_uri`, `session.url` all match the contract | Fill from saved config | S |
| Allowed integrations tiles | NEEDS NEW DATA | No store. Session has `allowed_kinds` (device kinds, not adapters). Candidates come from `hosted.ts › candidates` | New column, filter inside `candidates()`. `pickCandidate` calls it, so POST steps are covered too | M |
| Integration tile set | NEEDS PRODUCT DECISION | Tiles come from fixture `_data/catalog.ts` and `state.integrations` | `hosted.ts › PAIRING_STYLE` offers only `simulator` and `even_g2`. **The demo's Dopl desktop tile cannot pair** (adapter exists, not in the map). Live env today offers Even G2 only | S to cut, M to add desktop pairing |
| Live / Testing badge on tile | NEEDS NEW DATA | No per-project integration status table. Shared with Devices page, owner to agree [A] | Follow Devices plan, or hide | S |
| Maximum permissions chips | NEEDS NEW DATA | No store. Scope list itself is real: `scopesByTier` reads `@dopl/device-contracts`; server equivalent `connect/scopes.ts` | New column plus enforcement. Must use family-aware compare through `capabilitiesOfScope` | M |

**Your specific questions**

- **Project defaults today:** branding only (`dev_projects.branding`). No allowlist of integrations, redirects or scopes exists anywhere. `requested_scopes` is limited only by the capability vocabulary and later by what the device supports (`hosted.ts › consentScopes`).
- **Is `redirect_uri` validated?** Only for scheme. `service.ts › safeRedirect` allows any http or https URL, including plain http in live. Nothing checks it against a list.
- **Draft/Published needed?** No (Q1).
- **Logo storage:** none for this. `workspace-icons` is the pattern to copy: public bucket, service-role uploads, 2 MB limit, plus a post-upload URL on the row.
- **Can a test link be minted safely from the portal?** Yes, if it is forced to `env=test`:
  - New `POST /api/developers/projects/{id}/connect/test-link`, `withUserAuth({ sessionOnly: true })`, listed in `write-gate-coverage.test.ts`.
  - Reach through `requireProject`. It calls `createConnectSession` directly, so no key is handled.
  - `external_user_id` fixed by the server, for example `portal_test_<short id>`, never a `sim_*` magic id (`test-mode.ts`).
  - No `redirect_uri`, so the raw public token is never produced for anyone. The hosted page ends on "Connected".
  - Side effects are real and acceptable in test: a `dev_end_users` row, and on completion a device, a connection and a `connection.created` webhook. `/v1/test/reset` clears them, except that it needs a key.
  - The token returns `no-store`, 30-minute life (`dto.ts › CONNECT_SESSION_TTL_MS`).
  - Refuse live. A live pairing belongs in Samuel's real flow, not a test button.
- **Does the hosted screen call the real server?** Yes. `/connect/[token]/page.tsx › connectPageView`, and POSTs to `/api/connect/{token}/{pair|claim|consent}`. The real flow is built and tested, but has run zero times in prod.
- **Does `src/app/connect/[token]/` need changes?**
  - `page.tsx`: add `referrer: "no-referrer"` metadata, as the invite page already does. One line.
  - `connect-flow.tsx`: none needed. Limits are enforced in `service.ts` and `hosted.ts`.
- **Logging gap:** the hosted steps write no `dev_events`. `logDevEvent` is called only from `with-developer-key.ts`. So pair, claim and consent, including failures, never reach Activity. Samuel's "everything got logged" fails here; see §2.

### API keys (`_sections/keys*.tsx`)

The real backend is largely here: `/developers/keys`, `server/keys.ts`, `server/portal-admin.ts`, `api/developers/keys/*`.

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Key list by project + env | LIVE today | `portal.ts › listProjectKeys` | Replace `usePortal` | S |
| Search keys | LIVE today (client filter) | Same rows | Keep `keepsKey` | S |
| Active / Needs review / Revoked | DATA EXISTS | `revoked_at`, `last_used_at`, `created_at`; rules in `keys-model.ts` | Swap `DEMO_NOW` for real now. Add "expired" state, which the demo lacks and the real page has | S |
| Secret and publishable sections | LIVE today | `dev_api_keys.kind` | Wire | S |
| Key name | NEEDS NEW DATA | No column | Add `name`. Backfill the 2 existing rows | S |
| Masked prefix | LIVE today | `prefix`, `format.ts › maskedKey` | Wire | S |
| Publishable key shown in full + Copy | NEEDS PRODUCT DECISION | Hash only; the raw value is gone after mint. `prefix` for pk is `pk_` + 4, with no env | See Q2 | S |
| `pk_live_` / `pk_test_` look | NEEDS PRODUCT DECISION | Real prefix is `pk_` (`API_KEY_PREFIX`). `PUBLISHABLE_KEY_RE` already permits underscores | Optional S change in `keyPrefixFor`. 0 publishable keys in prod, so no migration of old rows | S |
| State badge (In use, Idle, Not used yet, Unused Nd) | DATA EXISTS | `last_used_at` | Thresholds are the demo's, keep. Accuracy ±1 min per instance (`touchApiKeyLastUsed`). Not bumped on refused calls | S |
| Scope chips | LIVE today, **names wrong** | `dev_api_keys.scopes` | Show real names; mapping below | S |
| Last used | LIVE today | `last_used_at` | Wire | S |
| Calls, 7d (card and section total) | NEEDS NEW DATA | **`dev_events` has no key column** (verified in prod schema) | Add `api_key_id` to `dev_events`; see §2 | M |
| Created | LIVE today | `created_at` | Wire | S |
| Created by (name + initials) | NEEDS NEW DATA | No column | Add `created_by`. Portal mints set it; old rows null, show "Unknown" or backfill Samuel | S |
| Create key flow: type step | LIVE today | `POST /api/developers/projects/{id}/keys`, `{env, kind}` | Wire | S |
| Create key flow: scopes step | DATA EXISTS | `mintApiKey` accepts `scopes`. **`createProjectKey` and the route drop them**, so every secret key gets all 4 | Pass and validate against `ApiKeyScopeSchema` | S |
| Create key flow: name step | NEEDS NEW DATA | Column above | Route body gains `name` | S |
| Reveal once, Copy | LIVE today | `MintedKey.secret`, `portal-http.ts › noStore` | Wire | S |
| Reveal's curl sample | **Wrong today** | Shows `POST /v1/deliver` with `target`. Contract is `/users/{external_user_id}/deliver`, requires `intent`, `content`, `urgency`, `idempotency_key` (`openapi.yaml › DeliverRequest`) | Rewrite from the contract | S |
| Rotate + grace choice (Now, 1h, 24h) | DATA EXISTS | `rotateApiKey` takes `overlapMs`. **Route ignores it**, always 24h | Route accepts one of three fixed values | S |
| "Old secret ends in Nh" on one card | NEEDS NEW DATA | Real rotation makes a **new row**; old row gets `expires_at`. Demo edits one row in place | Show two cards (no schema), or link with `rotated_from` (Q3). Rotation must copy `name` | S |
| Revoke + confirm | LIVE today | `portal-admin.ts › revokeProjectKey`, immediate | Wire | S |
| Revoke **Undo** toast | CUT | See §3 | Remove; real page already says "cannot be undone" | S |
| Role gating of buttons | LIVE today | `canManageKeys`; server re-checks. Demo shows all buttons to everyone | Pass role down | S |
| Internal org behaviour | LIVE today, **blocks the demo** | `refuseInternal` refuses key create and revoke; Rotate allowed | Q4 | S |

**Scope mapping.** Real set, from `@dopl/device-contracts › API_KEY_SCOPES`, pinned by a SQL CHECK:

| Demo | Real | Note |
|---|---|---|
| `deliver`, `devices.act` | `actions:write` | One scope; the demo's split does not exist |
| `devices.read`, `users.read` | `devices:read` | `/users/{id}/context` uses it. `/users/{id}/connections` uses `connect` |
| `events.read` | `analytics:read` | |
| `webhooks.write` | none | **`/v1/webhook_endpoints*` require `scopes: []`, so any secret key can manage webhooks** |
| not in demo | `connect` | A secret key without it cannot create sessions, exchange or revoke connections. The demo's default `["deliver"]` key could not do Connect |

Recommendation: show the 4 real scopes with friendly names. Finer scopes mean a contract change, a CHECK migration and re-touching routes, for no demo value.

**Hashing:** SHA-256 hex of a 190-bit random body, raw never stored (`keys.ts`). Fine for random tokens. No change.

### Team (`_sections/team.tsx`)

Real backend: `portal-admin.ts`, `portal-invites.ts`, `/developers/org`.

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Member list | LIVE today | `portal-admin.ts › listOrgMembers` | Wire | S |
| Member name | NEEDS PRODUCT DECISION | Email only. `emailOf` fetches the auth user; a display name could come from there or a profile table [A] | Show email as title if no name | S |
| Email | LIVE today | `auth.admin.getUserById` per member | Wire | S |
| Role pill menu | LIVE today, **rules differ** | `changeMemberRole`, `canActOn`, `canAssignRole` | Offer only permitted roles. Demo offers Owner and Viewer to anyone; server refuses | S |
| Viewer role | NEEDS PRODUCT DECISION | CHECK allows only `owner`, `admin`, `developer` on `dev_org_members`; invites only `admin`, `developer` | Q5 | M if kept |
| Last active | NEEDS NEW DATA | No column. `last_sign_in_at` on the auth user is account-wide, not portal activity [A] | Add `dev_org_members.last_active_at`, throttled touch in `load-portal.ts`. Owners may have no member row: `createOrgWithProject` does not insert one | S |
| Active / Inactive badge | NEEDS NEW DATA | Derived from above | None further | S |
| Remove + confirm | LIVE today | `removeMember`, also allows leaving, which the demo lacks | Add Leave | S |
| Remove dialog's "N API keys keep working" | NEEDS NEW DATA | True in behaviour: keys have no user link. Count needs `created_by` | Depends on key column | S |
| Remove **Undo** | CUT | See §3 | Remove | S |
| Search, All / Invited views | LIVE today | Client filter | Fix demo's Invited filter behaviour only if wanted | S |
| Invite flow (email, role) | LIVE today | `POST /api/developers/orgs/{id}/invites`, `createInvite` | Wire | S |
| "Invite sent to X" | **False today** | No email is sent (`20261123210000_device_sdk_org_invites.sql`); the inviter gets a link once. No email provider found by grep [A] | Show copy-link step, as the real page does (Q6) | S |
| Invite row | LIVE today | `listOrgInvites` | Add expired state | S |
| Resend | NEEDS PRODUCT DECISION | No route. The raw token is hash-only, so the old link cannot be re-shown; `createInvite` refuses an open duplicate | New route: revoke then create, returning a new link. Label "New link" until email exists | S |
| Revoke invite | LIVE today | `revokeInvite` | Wire | S |
| "Last active: Never" on invite | DATA EXISTS | Constant | Keep | S |
| Role permission matrix | **Partly false**; see below | | Rewrite to match enforcement | S |
| Internal org behaviour | LIVE today, **blocks the demo** | `refuseInternal` refuses invites and role changes | Q4 | S |
| Accept invite page | LIVE today | `/developers/invite/[token]`, email-bound, atomic claim | Restyle only | S |

**Matrix versus code**

| Demo power | What is enforced |
|---|---|
| View activity and usage: all | True for owner, admin, developer. Any member reads, reach via `listPortalProjects` |
| Send test deliveries: not Viewer | Playground checks project reach and a pasted test key, **no role check**. A Viewer would need one added |
| Manage devices and rules | **No portal write route exists.** Device writes are API-key only, so no member role applies |
| Manage API keys and webhooks: Owner, Admin | Keys yes. **Webhook portal is read-only** (`portal-webhooks.ts`); writes are by API key, with no role |
| Invite and remove: Owner, Admin | Yes, but roles only go down: an admin grants only developer and acts only on developers |
| Change plan and billing: Owner | **No developer billing found.** `PLAN` is a fixture, usage is read-only [A: not exhaustive] |

Real wording for `developer` today: "Reads logs and keys." The demo's "Build and test" overstates it.

### Shell (`portal-shell.tsx`, `find-anything.tsx`, `_design/ui-sidebar.tsx`)

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Sign-in gate | LIVE today | Proxy plus `load-portal.ts › loadPortal`; `/developers` not in `PUBLIC_ROUTES` | Move new UI under `/developers`. `/playground/developers` stays public, so **live data must never be imported there** | S |
| Account row | DATA EXISTS | `getUser` for email; org from `listPortalOrgs` | Demo hardcodes `MEMBERS[2]`. Add sign-out, which it lacks | S |
| Org creation | LIVE today | `/developers/new`, `createOrgWithProject`, `NoProjects` empty state | Restyle. Demo has no zero-org state at all | S |
| Project switcher | LIVE today | `listPortalProjects`, URL `?project=` | Demo is client state; must become URL. Group or label by org for multi-org users | M |
| New project | LIVE today, **no home in new UI** | `createProject`. Lived on `/developers/org`, which Team replaces | Add to switcher menu | S |
| "All projects" option | CUT | Real frame has it; keys and connect need one project | Drop from the new shell. Logs reader may keep supporting it | S |
| Live / Test switch | LIVE today | URL `?env=`; default **test** (`parsePortalParams`), demo defaults live | Q7. Must be a server re-read, not `state.env` | S |
| Find anything | NEEDS NEW DATA | No search endpoint | New route; see below | M |
| Issues count | NEEDS NEW DATA | No issues table found; definition belongs to the Issues plan | Read that plan's source, add head counts in `loadPortal` | M |
| Users attention count | NEEDS NEW DATA | `connections.status = 'needs_reauth'` exists, but **no writer sets it** (only types, `policy.ts` and `sdk-lens.ts` reference it) [A: grep] | Follow Users plan. Until a writer exists it reads 0 | S |
| Design Playground nav | CUT | Internal tool | Remove from real nav | S |
| API version, Internal badge | LIVE today | Real frame shows them, demo does not | Keep "Internal" visible | S |

### Environments

Verified separation:
- **Keys:** `dev_api_keys.env`. Secret prefix names the env and lookup filters on it (`verifyApiKey`). Publishable env comes from the row.
- **Data:** `project_id` + `env` on `dev_end_users`, `devices`, `connections`, `connect_sessions`, `dev_events`, `dev_webhook_endpoints`, outbox and deliveries. Same external id in two envs is two rows.
- **Devices:** simulator only in test (`registry.ts › list`). **Real G2 can also be offered in test.**
- **Not per env:** org, members, project, branding. Redirect URLs should be per env (test needs localhost); see §2.
- **Reset:** `test-reset.ts` is literally test-only, but undocumented and not in the contract.
- **Check for Usage owner:** `dev_billable_events` excludes internal orgs, not test traffic. Usage reads filter by env.

### Projects

- An org can hold 20 projects, and an account can own 5 orgs, with soft limits (`MAX_PROJECTS_PER_ORG`, `MAX_OWNED_ORGS`).
- Switching changes `?project=`; the server re-reads everything. A foreign id falls back to the caller's first project (`parsePortalParams`).
- No route renames or deletes a project or org. No route exists for branding.

### How Dopl itself is a project

- `seed-dopl-app.ts › seedDoplApp` created an internal org and project named "Dopl App" on Samuel's account, with one live and one test secret key. `dev_orgs.internal = true`.
- `dev_billable_events` excludes it from usage and billing. **So the real Usage page shows Dopl App as zero** (`usage.ts`). Logs read `dev_events` and do show it.
- Glasses moved over by `migrate_prosumer_device`. There the end user's `external_user_id` is the **Dopl user id**, a deliberate exception to D1 for internal orgs only.
- `src/features/display/server/sdk-lens.ts` calls the API with `DOPL_APP_SDK_KEY`.
- `refuseInternal` blocks portal project create, key create and revoke, invites, role changes and invite accept, because that org "logs every Dopl user's device traffic keyed by their user id".

### Find anything: safe search

New `POST /api/developers/search`, `{project, env, q}`, session-only, reach via `listPortalProjects`, always filtered by project and env, rate limited. POST, so a query stays out of URLs and logs.

| Can search | How |
|---|---|
| `dev_end_users.external_user_id` | Prefix, escape `%` and `_` |
| `devices.id`, `dev_events.event_id` (the `Request-Id`), `connections.id`, webhook endpoint and delivery ids | Exact UUID |
| `devices.display_name`, key `name` and `prefix`, webhook `url` and `description` | Contains, within one project |

| Must never search | Why |
|---|---|
| `key_hash`, `token_hash`, `public_token_hash`, webhook secrets | Oracle risk |
| Webhook payloads, `response_body`, `dev_device_messages` content | Customer content |
| Member emails, any `auth.users` field | Out of scope for end-user lookup |

Client must refuse key-shaped input (`sk_`, `pk_`, `ct_`, `whsec_`) rather than send it. Demo searches user **names**: `dev_end_users` has no name column, so remove that.

---

## 2. New tables, columns, jobs, endpoints

**Columns (one migration, additive)**

| Column | Purpose |
|---|---|
| `dev_api_keys.name text` | Key name |
| `dev_api_keys.created_by uuid NULL` → `auth.users`, `ON DELETE SET NULL` | Created by |
| `dev_api_keys.rotated_from uuid NULL` | Optional; Q3 |
| `dev_events.api_key_id uuid NULL`, no FK (events outlive their parents) | Per-key calls. **`dev_billable_events` must be re-created in the same migration** (its header warns that `SELECT e.*` is expanded once). Set in `with-developer-key.ts › record`, add to `DeviceEventRow`. Keep out of `PublicDeviceEventSchema`'s picked fields. Old rows null. Add index `(project_id, api_key_id, ts)` |
| `dev_projects.connect_config jsonb NOT NULL DEFAULT '{}'` | `{ test: {redirect_uris, allowed_adapters, max_scopes}, live: {...} }`. Single jsonb, no draft |
| `connect_sessions.allowed_adapters text[] NULL` | Snapshot, matching how branding works |
| `dev_org_members.last_active_at timestamptz NULL` | Plus inserting an owner row in `createOrgWithProject` and a backfill |

Optional per Q2: `dev_api_keys.publishable_token text`, CHECK kind = publishable.

**Storage:** public bucket `dev-connect-logos`. PNG, JPEG, WebP only. 2 MB.

**Endpoints (all `withUserAuth({sessionOnly:true})`, all added to `write-gate-coverage.test.ts`)**

| Endpoint | Purpose |
|---|---|
| `PATCH /api/developers/projects/{id}/connect` | Save branding and config |
| `POST /api/developers/projects/{id}/connect/logo` | Upload |
| `POST /api/developers/projects/{id}/connect/test-link` | Test link, test env only |
| `POST /api/developers/search` | Find anything |
| `POST /api/developers/invites/{id}/reissue` | Resend |
| Existing: keys POST gains `name`, `scopes`; rotate gains grace | |

Reads stay as server-page calls in `portal.ts`. No new read API needed.

**Behaviour changes**
- `createConnectSession`: reject `redirect_uri` not on the list, reject scopes above max; `invalid_request` naming the value.
- `hosted.ts`: filter `candidates()` by `allowed_adapters`; log pair, claim, consent. `logDevEvent` needs `org_id`, so read it through the project. **Those rows would enter `dev_billable_events`.** Decide they do not bill: filter by an `intent` prefix or similar; Usage owner to agree.
- Test-link route must log too, since it bypasses `withDeveloperKey`.

**Layering note:** this feature's server is `keys.ts`, `portal.ts`, `portal-admin.ts`, not `repository.ts` + `service.ts`. Follow the local shape. All tables stay service-role only, RLS on, no policy, DO-block assertion in the migration (the A1 pattern). INVARIANTS §12 and project memory apply to migrations: match by name, byte-exact apply, no `db push`.

**Can be avoided**
- Draft/published storage.
- Finer key scopes.
- Per-key counter table: `dev_events` with an index is enough at this volume. If it gets large, add a daily rollup later.
- New `dev_connect_configs` table: jsonb on the project is enough.
- Audit table for demo. Real gap (key created, member removed are unlogged beyond `created_by`, `invited_by`), but it can wait.
- Email provider for demo.
- Jobs: none required. Expired `connect_sessions` have no cleanup (no cron references them), harmless for now.

---

## 3. Security concerns, plainly

**Serious, independent of the portal**

1. **A publishable key can attach a stranger's device to any user.** `/v1/connect_sessions` admits `pk_` keys, which live in client code, and takes any `external_user_id`. On consent, `consentConnect` inserts an **`active`** connection immediately. The exchange step, the only part needing a secret key, does not activate anything. `policy.ts` checks grant status only. So someone with the public key can start a session as `user_123`, pair their own glasses, and then receive what the developer delivers to `user_123` [A: full delivery fan-out not traced to the end; `listDevices` and the grant check support it]. Fix options in Q8. Must be settled before any outside customer. Does not affect Samuel's demo.
2. **No redirect allowlist, and it carries the public token.** Any http(s) URL can receive `public_token`. It cannot be exchanged without a secret key, which limits the damage, but the page also serves as a redirect through Dopl's domain.
3. **Branding override from a public key.** `req.branding` overrides name and logo, and `pk_` keys may send it. Anyone holding one can present an arbitrary brand on Dopl's domain, which is phishing material. Pass key kind into `createConnectSession` and ignore the override for `pk_`.
4. **Any secret key can manage webhooks.** `scopes: []` on `/v1/webhook_endpoints*`. An `analytics:read` key can add an endpoint and receive every event. The Create Key scope step will imply a limit that is not there. Either add `webhooks:write` or do not imply it. Do not show `webhooks.write` until enforced.

**Introduced by making these pages live**

5. **Undo after revoke is a security problem; cut it.** Revoke is what you press when a key leaked. Undo restores a credential possibly in an attacker's hands, and a 6-second client timer leaves a window where the owner thinks it is dead or live incorrectly. Real code has no un-revoke. Pressing confirm is the protection. The same holds for removing a member: undo would re-grant access without invite or email check.
6. **Rotating the Dopl App live key on stage can break glasses.** `DOPL_APP_SDK_KEY` is used by `sdk-lens.ts`. After the grace ends, delivery stops until the Vercel env is changed. "Now" breaks it at once. **Never press Rotate or Revoke on the used live key in the demo**; consider hiding "Now" for internal orgs.
7. **SVG logos.** The demo says "PNG or SVG". A public-bucket SVG opened directly runs script on the storage origin. `<img>` is safe, direct links are not. Drop SVG; `workspace-icons` allows it, so do not copy that part.
8. **`logo_url` accepts any URL** (`z.url()`), so a third-party host learns each end user's IP from the hosted page. Restrict saved logos to our bucket. There is no explicit referrer policy on `/connect/[token]`; browser default sends origin only, but add `no-referrer` since the token is in the path.
9. **Publishable keys readable (Q2).** Low risk by design, but item 1 raises the stakes. Fix 1 first.
10. **Find anything and pasted secrets.** See the guard above.
11. **Internal org privacy.** Relaxing `refuseInternal` for invites would expose every Dopl user's device traffic to invitees. Keep invites refused there.
12. **`/playground/developers` is public** (`PUBLIC_ROUTES`). If live components are shared, keep data loading only under `/developers`, never in shared `_design`.
13. **Reach is the only fence.** Service role bypasses RLS (INVARIANTS §2), so every new route must go through `requireProject` or `requireOrg`, with a foreign id answering 404.
14. **Removed members' keys keep working** by design; the keys are not tied to the person. Keep the dialog's warning; it is honest.

---

## 4. Samuel's demo

**Must be true**

| # | Requirement | Why |
|---|---|---|
| 1 | New shell under `/developers` with sign-in, real project and env from URL | Everything sits on it |
| 2 | Default or link to `env=live` for Dopl App | All 14 events and 4 devices are live; test is empty |
| 3 | Keys page shows the 2 real keys with real names, last used, created | Show real state. Needs `name`, ideally `created_by` |
| 4 | Calls, 7d per key is real, or the figure is hidden | Needs `api_key_id`. Old rows null, so counts start at deploy. **Make the demo's traffic after deployment** |
| 5 | Q4 decided, so Create key works on Dopl App, or is plainly not offered | Otherwise a 409 in front of the audience |
| 6 | Team shows Samuel as Owner, with correct matrix | Live already, needs wiring |
| 7 | Connect page saves real branding; test link opens the **real** hosted screen | Needs config column, PATCH route, test-link route |
| 8 | **Rehearse real Connect once in prod.** 0 sessions have ever run there | Greatest unknown; the G2 path especially |
| 9 | Pair, claim and consent appear in Activity | "Everything got logged" |
| 10 | Find anything resolves a real device id and request id | Quick to show, or hide the box |
| 11 | No fixture text left: curl sample, Larkfield names, "Invite sent" | Credibility |
| 12 | Redirect and scope limits enforced if shown | A control that does nothing is worse than none |

Verify separately: **if the demo runs inside Dopl.app**, does `/developers` load there? Project memory says new web roots need desktop `WEB_ONLY_ROOTS`; I did not locate that list's contents for `/developers` or `/connect` [A]. Simplest answer: use the browser.

**Can wait:** logo upload (text name and color are enough, though it is M and visible), Viewer role, email invites, Resend, per-integration Live/Testing badge, `pk_live_` naming, publishable reveal, rotation card linking, grace choice, sidebar counts beyond real sources, audit log, multi-org switcher polish, Dopl desktop pairing, webhook scope.

**Should not wait past the demo, before any outside customer:** §3 items 1 to 4.

---

## 5. Questions only Samuel can answer

1. **Draft and Publish on Connect?** Recommend **no**. One saved config with a Save button. Sessions snapshot branding, so the risk it guards against is small; the test link can pass unsaved values as a session override.
2. **Should publishable keys stay readable?** Recommend **yes**, Stripe-style, using a new column for new keys, after Q8. If shortest path matters, show once for the demo: 0 exist in prod.
3. **After rotation: one card or two?** Recommend **two rows for now** (no schema). Add the link later.
4. **What may be done in the internal Dopl App org from the portal?** Recommend: **owner may create and revoke keys and edit Connect config; invites and role changes stay blocked.** Team then shows Samuel alone, with invite shown as unavailable. To demo an invite, use a second, ordinary org.
5. **Keep the Viewer role?** Recommend **cut for now**. Real `developer` is already read-only, so it is effectively Viewer. Three real roles, and a matrix that matches. Otherwise it needs two CHECK changes and new role checks.
6. **Email invites?** Recommend **copy-link for the demo**, email later. No provider found in the code.
7. **Default environment on sign-in?** Recommend **remember last choice, defaulting to Test for new orgs**, with the demo link set to `env=live`. Test-by-default is the safer habit for customers.
8. **How to close the publishable key hole?** Options: (a) connection stays inert until the secret-key exchange; (b) drop `pk_` session creation, secret key only, Plaid-style; (c) signed user token from the developer's server. Recommend **(a)**. It keeps the API surface, and the exchange already exists. Contract change, so it is his call. Note the Dopl App connections predate this and must stay active.
9. **When limits are empty, is a project open or closed?** Recommend **test open; live refuses any `redirect_uri` until one is listed**, and scopes default open with a nudge. 0 sessions and 0 customers mean this breaks nobody. Update docs in `features/marketing/docs/content`.
10. **Which integrations are offered?** Recommend **Even G2 only in live, simulator added in test**, cutting the Dopl desktop tile and preview tiles from this page until each can pair.
11. **Dopl App's name in the demo?** He said "Dopl as my project". Project is named "Dopl App". Recommend keeping it, or a by-hand rename: no rename route, and `seedDoplApp` matches on the exact name, so renaming means a re-run creates a duplicate.
12. **Demo pairing: live glasses or simulator?** Recommend **rehearse the real G2 in test env first**, then decide. Real hardware is the stronger story; the simulator is the fallback.

---

## 6. Suggested build order

1. **Migration** (§2 columns, view re-create). Everything else depends on it. Samuel applies per the migration rules.
2. **Shell** under `/developers`: URL-based project and env, sign-in, org creation, account row. Sidebar counts stubbed off until their owners deliver.
3. **API keys**: wire list, create, reveal, rotate, revoke, with name, `created_by` and real scopes. Remove Undo. Fix the curl sample. Mostly existing routes, so this is the fastest visible win.
4. **Event attribution**: `api_key_id` in `with-developer-key.ts`, then Calls, 7d.
5. **Team**: wire members and invites, correct matrix and roles, copy-link invite, remove Undo, `last_active_at`.
6. **Connect config**: PATCH route and form for branding, redirects, integrations, max permissions, with enforcement in `service.ts` and `hosted.ts` in the same change.
7. **Test link**, plus `dev_events` for hosted steps, plus `no-referrer`.
8. **Prod rehearsal of real Connect.** Do this as soon as step 7 lands, not the night before. Fix what it finds.
9. **Find anything.**
10. **Logo upload**, if time remains.
11. **Sidebar counts**, after Issues and Users plans settle.
12. **Security fixes** §3 items 1, 3, 4 per Samuel's rulings. Item 3 is a few lines and could go in step 6.

Per Samuel's test-cadence rule, targeted tests run at the end of each significant change. Touching `with-developer-key.ts`, `keys.ts` and `hosted.ts` warrants their existing suites. SQL pin tests (`device-sdk-tenancy-sql.test.ts`, `device-sdk-internal-orgs-sql.test.ts`, `device-sdk-connect-sql.test.ts`) will need updating with the migration.
