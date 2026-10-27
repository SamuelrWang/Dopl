import { AR_GLASSES_PROFILE } from "./pages-routing";
import { API, curl, EXAMPLE_DEVICE, json, PLANNED } from "./shared";
import type { DocBlock, DocPage } from "./types";

/**
 * Guides: task walkthroughs over the planned `/v1` API. ⚠ Every request path and body here must
 * match `docs/specs/device-sdk/openapi.yaml` (`content.test.ts` checks the paths). All
 * `coming_soon` until the routes they call are deployed.
 */

function guide(slug: string, title: string, description: string, blocks: DocBlock[]): DocPage {
  return { slug: `guides/${slug}`, tab: "about", group: "Guides", title, description, status: "coming_soon", blocks: [PLANNED, ...blocks] };
}

const step = (title: string, ...blocks: DocBlock[]) => ({ title, blocks });
const p = (text: string): DocBlock => ({ type: "p", text });
const code = (label: string, src: string): DocBlock => ({ type: "code", tabs: [{ label, code: src }] });

export const GUIDE_PAGES: DocPage[] = [
  guide("connect-a-device", "Connect a device", "Let a user link their device to your agent", [
    {
      type: "steps",
      items: [
        step(
          "Create a Connect session",
          p("From your server, create a session for the user with the scopes your agent needs. `allowed_kinds` limits the devices offered, and `branding` puts your name, logo and color on the flow. A publishable `pk_` key may also call this route from your app."),
          code(
            "cURL",
            curl(
              "POST",
              "/connect_sessions",
              '{"external_user_id":"usr_123","allowed_kinds":["glasses"],"requested_scopes":["present.*","ask.*"],"redirect_uri":"https://example.com/connected","branding":{"display_name":"Acme Agent"}}'
            )
          ),
          code("201", json({ connect_token: "ct_9d1e", url: "https://…", expires_at: "2026-10-27T17:32:11Z" }))
        ),
        step(
          "Open the flow",
          p("Send the user to `url`, or open it in the Connect widget inside your app. They see which capabilities their device supports, pair it, and approve the scopes by risk tier. When they finish, the flow returns to your `redirect_uri` with a `public_token`.")
        ),
        step(
          "Exchange the token",
          p("Exchange the `public_token` on your server for a durable `connection_id` and the device."),
          code("cURL", curl("POST", "/connections/exchange", '{"public_token":"pt_51c0"}')),
          code("200", json({ connection_id: "con_7a20", device: EXAMPLE_DEVICE }))
        ),
        step(
          "Keep track",
          p("List a user's connections with `GET /v1/users/{external_user_id}/connections`, revoke one with `DELETE /v1/connections/{id}`, and listen for `connection.needs_reauth` and `device.offline` to know when a device stops being reachable.")
        ),
      ],
    },
  ]),
  guide("deliver-a-message", "Deliver a message", "Send by intent and let Dopl pick the device", [
    p("Deliver is the one call most agents need. You say what you want to do and Dopl routes it to the best device using the user's context."),
    {
      type: "steps",
      items: [
        step(
          "Choose the intent",
          p("Set `intent` to `message`, `ask`, `notify` or `display`, and put `text`, `blocks` or `options` in `content`. The SDK helpers `show`, `ask` and `notify` set the intent for you.")
        ),
        step(
          "Send it",
          code(
            "cURL",
            curl(
              "POST",
              "/users/usr_123/deliver",
              '{"intent":"notify","content":{"text":"Build finished in 4m 12s"},"urgency":"normal","target":"auto","idempotency_key":"req_01"}'
            )
          ),
          code(
            "202",
            json({
              delivery_id: "dlv_8f2c",
              routed_to: { device_id: "dev_g2_01", kind: "glasses", reason: "last message came from this device" },
              status: "delivered",
            })
          )
        ),
        step(
          "Pick the target when you need to",
          p("Leave `target` as `auto` to let Dopl route, or set a device kind such as `desktop` or a device ID to choose yourself. Add `profile` to apply one context profile to this request only.")
        ),
        step(
          "Retry safely",
          p("Every request carries an `idempotency_key`. Retrying with the same key returns the first result instead of delivering twice, and reusing a key with a different body fails with `idempotency_conflict`.")
        ),
      ],
    },
    p("To call one capability on one device instead, use [Run a device action](/docs/api-reference/device-actions)."),
  ]),
  guide("customize-the-glasses-profile", "Customize the glasses profile", "Make your agent write the way you want on the lens", [
    p("The Dopl glasses default keeps replies to about five short plain lines. If your product has its own voice on glasses, replace the default with a project profile."),
    {
      type: "steps",
      items: [
        step(
          "Write the profile",
          p("Match on `kind: glasses` for every pair, or on `model` for one model. `prompt_append` is the text your agent adds to its system prompt, and `output` is what Dopl enforces."),
          code(AR_GLASSES_PROFILE.id, json(AR_GLASSES_PROFILE))
        ),
        step(
          "Choose what happens to long replies",
          p("`overflow` decides what happens when a reply is still too long. Here it goes to the user's phone in full. Use `\"truncate\"` to cut it to the limits, or `\"callback\"` to get it back and have your agent write a shorter one. Dopl never rewrites it.")
        ),
        step(
          "Use it in your agent",
          p("Read the user's context before each turn and append the matched profile's `prompt_append` to your system prompt. Agents on the project MCP server receive the context in their tool results."),
          code(
            "TypeScript",
            [
              `const context = await fetch("${API}/users/usr_123/context", { headers }).then((r) => r.json());`,
              ``,
              `const system = [BASE_SYSTEM_PROMPT, context.profile?.prompt_append].filter(Boolean).join("\\n\\n");`,
            ].join("\n")
          )
        ),
        step(
          "Compare versions",
          p("Each save creates a new profile version, and every event records the version that applied, so you can measure the change in analytics.")
        ),
      ],
    },
  ]),
  guide("custom-display", "Build a custom display", "Compose a screen from display blocks", [
    {
      type: "steps",
      items: [
        step(
          "Compose the blocks",
          p("Build the screen from the [block vocabulary](/docs/concepts/displays). Give each block an `id` so you can update it later."),
          code(
            "blocks",
            json([
              { id: "title", type: "heading", text: "Flight UA 212" },
              { id: "info", type: "fields", rows: [{ label: "Gate", value: "B14" }, { label: "Boards", value: "9:40" }] },
              { id: "status", type: "progress", value: 0.6, label: "Boarding" },
            ])
          )
        ),
        step(
          "Deliver it",
          p("Send the blocks with the `display` intent. Dopl fits them to the chosen device's limits."),
          code(
            "cURL",
            curl(
              "POST",
              "/users/usr_123/deliver",
              '{"intent":"display","content":{"blocks":[{"id":"title","type":"heading","text":"Flight UA 212"}]},"urgency":"normal","idempotency_key":"req_03"}'
            )
          )
        ),
        step(
          "Check the limits",
          p("Read the device's `present.display` descriptor with `GET /v1/devices/{id}` to see its size, block count and character set. Images show their `alt` text on devices without a raster screen.")
        ),
      ],
    },
  ]),
  guide("handle-answers", "Handle answers", "Ask the user a question and act on the answer", [
    {
      type: "steps",
      items: [
        step(
          "Ask",
          p("Deliver with the `ask` intent, a question in `text` and two or more `options`."),
          code(
            "cURL",
            curl(
              "POST",
              "/users/usr_123/deliver",
              '{"intent":"ask","content":{"text":"Book the 9:40 flight?","options":[{"label":"Yes"},{"label":"No"}]},"urgency":"normal","idempotency_key":"req_04"}'
            )
          )
        ),
        step(
          "Receive the answer",
          p("The answer arrives on the `ask.answered` webhook. To ask on one specific device, run the `ask.choice` capability with [Run a device action](/docs/api-reference/device-actions) instead; the call holds for up to 200 seconds while the user decides.")
        ),
        step(
          "Or poll",
          p("Read a device action's status and result at any time."),
          code("cURL", curl("GET", "/actions/act_41ab")),
          code(
            "200",
            json({
              action_id: "act_41ab",
              device_id: "dev_g2_01",
              capability: "ask.choice",
              status: "done",
              result: { choice: "Yes" },
              error: null,
              created_at: "2026-10-27T17:02:11Z",
              updated_at: "2026-10-27T17:02:19Z",
            })
          )
        ),
      ],
    },
    p("Agents reach glasses with the same flow today through `glasses_ask` on the [hosted MCP server](/docs/use-cases/ask)."),
  ]),
  guide("test-mode", "Test mode", "Build and run CI against simulated devices", [
    p("Every project has a test environment. Requests made with an `sk_test_` key only touch test data, and nothing in test ever reaches a live device or a live webhook."),
    { type: "h2", text: "Simulated devices" },
    p("In test mode the Connect flow offers a simulated device of every kind, so you can pair glasses, a phone or a robot without owning one. Simulated devices publish the same descriptors and return the same responses as real ones."),
    { type: "h2", text: "Forcing failures" },
    p("Give a simulated device one of these IDs, exactly or followed by `_` and any suffix, to force a failure on every action:"),
    {
      type: "table",
      columns: ["Device ID", "Every action fails with"],
      rows: [
        ["`sim_device_offline`", "`device_offline` (the device also reports offline)"],
        ["`sim_confirm_denied`", "`confirmation_denied`"],
      ],
    },
    { type: "h2", text: "Resetting test data" },
    p("An endpoint that clears a project's test data, so each CI run starts clean, is planned alongside test mode."),
  ]),
];
