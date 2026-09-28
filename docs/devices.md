# Devices and connected agents

Settings > Connect has two panels (Samuel, 2026-09-28):

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
  and refresh rotation leaves rows behind. `mcp_tokens` rows are grouped by the app's name
  (`appKey(appName(client_name))`). A group is listed while any of its rows is unrevoked and has a
  live access or refresh token.
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
| `computer` | `GET /api/devices`, `DELETE /api/devices/{id}` | `src/features/devices/server/*` |
| `glasses` | `GET/PATCH/DELETE /api/glasses/devices[/{id}]`, `POST /api/glasses/pair/claim` | the glasses feature |

- The client merges the sources into one `ConnectedDevice[]`
  (`src/features/devices/merge.ts › mergeDevices`): this computer first, then online devices, then the
  rest by last seen.
- `DeviceKind` is open (`"computer" | "glasses" | (string & {})`). A kind with no row of its own
  renders `DevicesPanel`'s generic row: glyph, name and `platform · presence`. Nothing is dropped.
- Glasses stay on their own endpoints on purpose. The glasses feature is segmented per vendor
  (`src/features/glasses/core`, `src/features/glasses/platforms/*`), so the devices feature reads it
  over HTTP only. The glasses row itself (`glasses/settings/glasses-device-row.tsx`) takes its
  platform label and assistant from the glasses platform registry. Folding glasses into
  `GET /api/devices` server-side is the follow-up (F-770).

### Adding a kind (phone, robot, …)

1. Give the kind a source. Either extend `GET /api/devices` with its table, or add its own endpoint
   and a mapper beside `computerToDevice` / `glassesToDevice`.
2. Add a label to `types.ts › PLATFORM_LABELS` and a glyph to `device-glyph.tsx › ICONS`.
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
  - It is throttled to one write per 60s unless the status changes.
  - A locked screen reports `away`. Suspend, shutdown and quit report `offline` at once.
- **Online.** A computer is online when its status is not `offline` and its last beat is within
  `devices-service.ts › COMPUTER_ONLINE_WINDOW_MS`.
- **Token linking.** `POST /api/auth/mcp-device-token` and `POST /api/auth/mcp-container-token`
  resolve the header to the caller's active `desktop_devices` row and stamp `mcp_tokens.device_id`
  (`features/devices/server/runtime.ts › mintingDeviceId`). This never fails a mint.
  - The heartbeat also carries `tokenLabel`, the label of the device token this machine already
    holds. It links a token minted before the computer registered.
- **Legacy computers.** An active device token with no `device_id` (minted by an older build) is
  listed as a computer named from its label (`Dopl Desktop CLI (<host>)`). Remove revokes it by label.
- **Remove** (`DELETE /api/devices/{id}`, session-only) does three things:
  - Stamps the row `revoked_at`.
  - Revokes every unrevoked `mcp_tokens` row with that `device_id`, which covers the device token and
    every container session.
  - Makes the heartbeat answer `{ device: { revoked: true } }`. The desktop then rotates its install
    id and runs the normal sign-out sequence, so a later sign-in on that Mac is a new computer.
    Nothing resurrects a removed row.

## Schema

`supabase/migrations/20261105120000_desktop_devices.sql` (additive): the table `desktop_devices`
(RLS on, owner-only SELECT, service role writes) and the column `mcp_tokens.device_id` (nullable FK,
`ON DELETE SET NULL`).

- It was applied by name as `desktop_devices`.
- To verify it, run `list_migrations` and compare `md5(array_to_string(statements, ''))` in
  `supabase_migrations.schema_migrations` with `md5 -q` of the file.
