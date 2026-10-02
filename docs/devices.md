# Devices and connected agents

Settings has two tabs for this (Samuel, 2026-09-28; split from one Connect tab on 2026-10-02):

- **Agents**: the agent apps connected to Dopl (Claude, Claude Code, Codex, Cursor, and so on), one row
  per app, plus how to connect one.
- **Devices**: every device connected to the user's agents. Today that is computers running the Dopl
  desktop app and paired glasses.

The direction behind it, in Samuel's words: *"personal agents will interface with you through different
methods, like robots, laptops or phones, or AI glasses."* A device is anything a person's agents reach
them through, so the model is built so that a new device kind is a new source, not a new page.

## Agents panel

| Piece | Where |
| --- | --- |
| Read | `GET /api/oauth/apps` → `{ apps: [{ key, name, connections, last_used_at, created_at }] }` |
| Disconnect | `DELETE /api/oauth/apps/{key}`: revokes every live credential of that app |
| Grouping | `src/features/devices/server/agent-apps.ts › listAgentApps` |
| Connect an agent | `src/features/mcp-connect/snippets.ts › connectRecipes`, rendered by `mcp-connect/components/remote-connect.tsx › RemoteConnect` |

- **One row per app.** Clients such as Claude and Codex register a new OAuth client on every install,
  and refresh rotation leaves rows behind. `mcp_tokens` rows are grouped by the app's name AND its
  redirect host (`appKey(name, redirectHost(oauth_clients.redirect_uris))`). A group is listed while
  any of its rows is unrevoked and has a live access or refresh token.
- **A look-alike cannot hide in a real app's row.** `client_name` is self-declared at registration, so a
  client calling itself "Claude" with another callback host gets its own row. Every row shows its host
  and, above one, its connection count.
- **First-party credentials are never agent apps.** The desktop's device token and its per-session
  container tokens (`DEVICE_CLIENT_ID`), and the playground (`PLAYGROUND_CLIENT_ID`), are filtered out
  in `agent-apps-repository.ts`. Container sessions are listed nowhere and die with their computer.
- The desktop also shows **Sign-ins**, the runtimes Dopl runs agents on
  (`channels/components/runtime-credential-bars.tsx`, `variant="rows"`).
- `GET /api/oauth/grants` and `DELETE /api/oauth/grants/{id}` still exist, but the UI no longer reads
  them.

## Devices panel

| Kind | Source | Owner |
| --- | --- | --- |
| `computer` | `GET /api/devices`, `PATCH /api/devices/{id}` (rename), `DELETE /api/devices/{id}` | `src/features/devices/server/*` |
| `glasses` | `GET/PATCH/DELETE /api/glasses/devices[/{id}]`, `POST /api/glasses/pair/claim` | the glasses feature |

- The client merges the sources into one `ConnectedDevice[]`
  (`src/features/devices/merge.ts › mergeDevices`): this computer first, then online devices, then the
  rest by last seen.
- Every row's name renames in place (`components/device-name-title.tsx › DeviceNameTitle`): glasses
  through `PATCH /api/glasses/devices/{id}`, computers through `PATCH /api/devices/{id}`, where
  clearing the name restores the detected one (the placeholder while empty). A legacy computer has no
  row to rename.
- `DeviceKind` is open (`"computer" | "glasses" | (string & {})`). A kind with no row of its own
  renders `DevicesPanel`'s generic row: glyph, name and `platform · presence`. Nothing is dropped.
- Glasses stay on their own endpoints on purpose. The glasses feature is segmented per vendor
  (`src/features/glasses/core`, `src/features/glasses/platforms/*`), so the devices feature reads it
  over HTTP only. The glasses row itself (`glasses/settings/glasses-device-row.tsx`) takes its
  platform label and assistant from the glasses platform registry. Folding glasses into
  `GET /api/devices` server-side is the follow-up (F-770).

- **Rename a computer** (`PATCH /api/devices/{id}` `{name}`, session-only;
  `devices-service.ts › renameComputer`): writes the `desktop_devices.display_name` override. The
  heartbeat keeps writing the detected `name` underneath; `null` or blank clears the override. The
  list's `name` is the effective name (`computerName`), `detected_name` the detected one.
- **Messages carry the device.** A member post stamps `metadata.source` with the computer it came
  from (`X-Dopl-Device` → the active row, effective name) or the glasses it was spoken into
  (docs/specs/device-aware-messages.md).

### Adding a kind (phone, robot, …)

1. Give the kind a source. Either extend `GET /api/devices` with its table, or add its own endpoint
   and a mapper beside `computerToDevice` / `glassesToDevice`.
2. Add a label to `types.ts › COMPUTER_PLATFORM_LABELS` and a glyph to `device-glyph.tsx › ICONS`.
3. If it needs controls beyond Remove, add a row component and branch on it in
   `devices-panel.tsx › DeviceRow`.

## Computer detection (the desktop registers itself)

- **Identity** (`dopl-desktop-app/main/device-identity.js`):
  - A stable per-install UUID, `installId()`, kept in electron-store under the key `deviceInstallId`.
  - A friendly name. On macOS this is `scutil --get ComputerName` (for example "Samuel's MacBook Pro");
    otherwise the cleaned `os.hostname()`.
  - The platform, the OS version (`sw_vers`), the architecture and the app version.
- **Header.** `X-Dopl-Device: <installId>` is sent on every request through both fetch seams
  (`api.js`, `listener-io.js`).
- **Heartbeat.** `POST /api/devices/heartbeat` (session-only) upserts `desktop_devices` on
  `(user_id, install_id)`.
  - It rides the existing presence loop: the optional `presence-core.js` hooks `onBeat` / `onAway`.
    There is no second timer.
  - It is throttled to one write per ~50s (`device-registry-core.js › MIN_INTERVAL_MS`) unless the
    status changes; a status asked for while a send is in flight is sent right after it.
  - A locked screen reports `away`. Suspend and shutdown report `offline` at once; quit awaits the
    `offline` post together with presence's `away` inside the same flush deadline.
  - The name and OS version are read asynchronously at arm and refreshed in the background; a beat
    never shells out.
  - Server side it is ONE update in the common case; a row is inserted only for a new install.
  - It stamps `desktop_devices.auth_session_id` from the `session_id` claim of the sign-in it arrives on
    (`runtime.ts › requestSessionId`).
- **Online.** A computer is online when its status is not `offline` and its last beat is within
  `devices-service.ts › COMPUTER_ONLINE_WINDOW_MS`.
- **Token linking.** `POST /api/auth/mcp-device-token` and `POST /api/auth/mcp-container-token`
  resolve the header to the caller's `desktop_devices` row (`features/devices/server/runtime.ts ›
  mintingDevice`): an active computer's mint stamps `mcp_tokens.device_id`; a REMOVED computer's mint
  answers 403 `DEVICE_REMOVED`; no header, or a lookup failure, mints unlinked as before.
  - The device-token mint returns `tokenId`, which the desktop saves with its token. The first beat
    after sign-in or a re-mint carries it, linking a token minted before the computer registered.
    A record from an older build (no id) sends its `tokenLabel` once instead.
- **Legacy computers.** An active device token with no `device_id` (minted by an older build) is
  listed as a computer named from its label (`Dopl Desktop CLI (<host>)`). Remove revokes that token
  by ID, never by label, so two Macs with the same hostname cannot revoke each other.
- **Remove** (`DELETE /api/devices/{id}`, session-only):
  - Stamps the row `revoked_at`.
  - Revokes every unrevoked `mcp_tokens` row with that `device_id`, which covers the device token and
    every container session.
  - Ends the computer's Supabase sign-in: `end_auth_session(user, auth_session_id)` deletes that
    `auth.sessions` row (its refresh tokens cascade), so the machine can no longer refresh.
  - Makes the heartbeat answer `{ device: { revoked: true } }` and every later mint answer 403. The
    desktop then rotates its install id and runs the normal sign-out sequence, so a later sign-in on
    that Mac is a new computer. Nothing resurrects a removed row.

### What Remove does NOT reach (residual limits)

- **An access token already issued** keeps working until it expires (Supabase's JWT lifetime, about
  an hour). Only its refresh is ended; `withUserAuth` does not look up devices per request.
- **A sign-in the heartbeat never saw.** `auth_session_id` is the session of the last beat that
  carried a readable one. A computer that never beat on this build (off since before the upgrade)
  has none, so its sign-in lives until it signs out or its refresh token expires.
- **Container tokens minted before the computer registered** carry no `device_id`. They are listed
  nowhere and survive Remove until their 24h TTL (`CONTAINER_TOKEN_TTL_S`); the desktop also revokes
  each at session end.
- **Legacy computers** (unlinked device tokens) have no session to end: Remove revokes the token only.

## Schema

- `supabase/migrations/20261105120000_desktop_devices.sql` (additive): the table `desktop_devices`
  (RLS on, owner-only SELECT, service role writes) and the column `mcp_tokens.device_id` (nullable FK,
  `ON DELETE SET NULL`). Applied by name as `desktop_devices`.
- `supabase/migrations/20261106120000_desktop_devices_session.sql` (additive): the column
  `desktop_devices.auth_session_id` and the function `end_auth_session(user, session)` (SECURITY
  DEFINER, pinned search_path, EXECUTE for `service_role` only). Applied by name as
  `desktop_devices_session`.
- `supabase/migrations/20261112120000_device_aware_messages.sql` (additive): the column
  `desktop_devices.display_name` (1-64 chars or NULL), plus the glasses/channel pieces of
  docs/specs/device-aware-messages.md. Applied by name as `device_aware_messages`.
- To verify it, run `list_migrations` and compare `md5(array_to_string(statements, ''))` in
  `supabase_migrations.schema_migrations` with `md5 -q` of the file.
