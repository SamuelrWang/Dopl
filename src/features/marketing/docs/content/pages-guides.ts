import { AR_GLASSES_PROFILE } from "./pages-routing";
import { curl, DEVICE_ID, EXAMPLE_DEVICE, json, PLANNED } from "./shared";
import type { DocBlock, DocPage } from "./types";

/**
 * Guides: task walkthroughs over the `/v1` API, built on master and not deployed. ⚠ Every request
 * path and body here matches `docs/specs/device-sdk/openapi.yaml` (`content.test.ts` checks the
 * paths) and every `dopl.*` call is a method `packages/sdk/src/client.ts` implements (checked
 * too). All `coming_soon` until the routes they call are deployed. The test mode guide documents
 * no reset route: `/v1/test/reset` is outside the contract pending Samuel's ruling.
 */

function guide(slug: string, title: string, description: string, blocks: DocBlock[]): DocPage {
  return { slug: `guides/${slug}`, tab: "about", group: "Guides", title, description, status: "coming_soon", blocks: [PLANNED, ...blocks] };
}

const step = (title: string, ...blocks: DocBlock[]) => ({ title, blocks });
const p = (text: string): DocBlock => ({ type: "p", text });
const code = (label: string, src: string): DocBlock => ({ type: "code", tabs: [{ label, code: src }] });
/** The same request from the SDK and from cURL. */
const both = (sdk: string[], curlSrc: string): DocBlock => ({
  type: "code",
  tabs: [
    { label: "TypeScript", code: sdk.join("\n") },
    { label: "cURL", code: curlSrc },
  ],
});

const DELIVERY_ID = "4f7e2a10-6c1b-4d9e-8a35-0b2c7d9e1f42";

export const GUIDE_PAGES: DocPage[] = [
  guide("connect-a-device", "Connect a device", "Let a user link their device to your agent", [
    {
      type: "steps",
      items: [
        step(
          "Create a Connect session",
          p(
            "From your server, create a session for the user with the scopes your agent needs. `allowed_kinds` limits the devices offered, `redirect_uri` is where the page sends the user when they finish, and `branding` puts your name, logo and accent color on the page. A publishable `pk_` key may also call this route from your app; it is the only route such a key can call."
          ),
          both(
            [
              `const session = await dopl.connectSessions.create({`,
              `  external_user_id: "usr_123",`,
              `  allowed_kinds: ["glasses"],`,
              `  requested_scopes: ["present.*", "ask.*"],`,
              `  redirect_uri: "https://example.com/connected",`,
              `  branding: { display_name: "Acme Agent", accent_color: "#1F6FEB" },`,
              `});`,
            ],
            curl(
              "POST",
              "/connect_sessions",
              '{"external_user_id":"usr_123","allowed_kinds":["glasses"],"requested_scopes":["present.*","ask.*"],"redirect_uri":"https://example.com/connected","branding":{"display_name":"Acme Agent","accent_color":"#1F6FEB"}}'
            )
          ),
          code(
            "201",
            json({ connect_token: "ct_…", url: "https://www.usedopl.com/connect/ct_…", expires_at: "2026-10-27T17:32:11Z" })
          )
        ),
        step(
          "Send the user to the page",
          p(
            "Open `url` for the user. They choose a device, pair it, and approve your scopes by risk tier, ticking or unticking each one. The link expires after 30 minutes. When they finish, the page sends them to your `redirect_uri` with a `public_token` query parameter, so always pass a `redirect_uri`."
          )
        ),
        step(
          "Exchange the token",
          p("On your server, exchange the `public_token` for the connection and its device. A token works once, within 30 minutes; after that, or on a second try, the exchange fails with `invalid_request`."),
          both(
            [`const { connection_id, device } = await dopl.connections.exchange({ public_token });`],
            curl("POST", "/connections/exchange", '{"public_token":"public-test-…"}')
          ),
          code("200", json({ connection_id: "c3a9e0d4-1f27-4b8e-9d6a-5e8f2c1b7a90", device: EXAMPLE_DEVICE }))
        ),
        step(
          "Keep track",
          p("List a user's connections, revoked ones included, and revoke one when the user disconnects in your app. Revoking is immediate and safe to repeat."),
          both(
            [`const { data } = await dopl.connections.list("usr_123");`, ``, `await dopl.connections.revoke(data[0].id);`],
            curl("GET", "/users/usr_123/connections")
          )
        ),
      ],
    },
  ]),
  guide("deliver-a-message", "Deliver a message", "Send by intent and let Dopl pick the device", [
    p(
      "Deliver is the one call most agents need. You say what you want to do, and Dopl picks the device, checks the grant and enforces the device's limits, as [Context profiles and routing](/docs/concepts/context-profiles-and-routing) describes."
    ),
    {
      type: "steps",
      items: [
        step(
          "Choose the intent",
          p(
            "Set `intent` to `message`, `notify`, `display` or `ask`, and put `text`, `blocks` or `options` in `content`. The SDK's `notify`, `show` and `ask` methods each make this call with the matching intent."
          )
        ),
        step(
          "Send it",
          both(
            [
              `const delivery = await dopl.users.deliver("usr_123", {`,
              `  intent: "notify",`,
              `  content: { text: "Build finished in 4m 12s" },`,
              `  urgency: "normal",`,
              `  target: "auto",`,
              `});`,
            ],
            curl(
              "POST",
              "/users/usr_123/deliver",
              '{"intent":"notify","content":{"text":"Build finished in 4m 12s"},"urgency":"normal","target":"auto","idempotency_key":"req_01"}'
            )
          ),
          code(
            "202",
            json({
              delivery_id: DELIVERY_ID,
              routed_to: { device_id: DEVICE_ID, kind: "glasses", reason: "fallback chain" },
              status: "done",
            })
          )
        ),
        step(
          "Pick the target when you need to",
          p(
            "Leave `target` as `auto` to let Dopl route, or set a device kind such as `desktop` or a device ID to choose yourself. Add `profile` to apply one of your project's profiles to this request only, and `urgency: \"high\"` to reach every eligible device at once."
          )
        ),
        step(
          "Retry safely",
          p(
            "Every Deliver and device action carries an `idempotency_key`, in the body and optionally in an `Idempotency-Key` header, which must match it. Retrying with the same key and the same body returns the first response, status and body included, without delivering again. Reusing a key with a different body fails with `idempotency_conflict`. The SDK sends a fresh key on every call unless you pass your own as `idempotencyKey`, so pass one whenever you retry."
          ),
          code("TypeScript", `await dopl.notify("usr_123", { text: "Build finished", idempotencyKey: "build-4812" });`)
        ),
        step(
          "Read the outcome",
          p(
            "Errors use the [standard shape](/docs/api-reference/errors), and every response carries a `Request-Id` header naming the event Dopl recorded. The SDK throws a `DoplError` with the same `code`, `retryable` flag and `requestId`. Read the action later with `GET /v1/actions/{id}` and the `delivery_id`."
          )
        ),
      ],
    },
    p("To call one capability on one device instead, use [Run a device action](/docs/api-reference/device-actions)."),
  ]),
  guide("customize-the-glasses-profile", "Customize the glasses profile", "Make your agent write the way you want on the lens", [
    p(
      "Dopl's glasses default keeps replies to about five short plain lines. If your product has its own voice on glasses, a project profile replaces the default for every pair your users connect."
    ),
    {
      type: "steps",
      items: [
        step(
          "Write the profile",
          p(
            "Match on `kind: glasses` for every pair, or add `model` for one model. `prompt_append` is the text your agent adds to its system prompt, and `output` holds the limits Dopl enforces. Here the profile also narrows the capabilities to presenting and asking, and confirms T3 actions on the device."
          ),
          code(AR_GLASSES_PROFILE.id, json(AR_GLASSES_PROFILE))
        ),
        step(
          "Choose what happens to long replies",
          p(
            "`overflow` decides what happens when a reply is still too long. Here it goes to the user's phone in full, and is cut to an exact prefix if they have no phone connected. Use `\"truncate\"` to always cut it, or `\"callback\"` to get it back with the limits and have your agent write a shorter one. Dopl never rewrites it."
          )
        ),
        step(
          "Have it applied",
          p(
            "Profiles are configured by Dopl for each design partner today: send the profile to [sales@usedopl.com](mailto:sales@usedopl.com) and it is applied to your project's test or live environment. A self serve editor comes with the developer portal."
          )
        ),
        step(
          "Use it in your agent",
          p(
            "Read the user's context before each turn and append the matched profile's `prompt_append` to your system prompt. Agents on the project MCP server get the context back from every `deliver` call."
          ),
          code(
            "TypeScript",
            [
              `const context = await dopl.users.context("usr_123");`,
              ``,
              `const system = [BASE_SYSTEM_PROMPT, context.profile?.prompt_append].filter(Boolean).join("\\n\\n");`,
            ].join("\n")
          )
        ),
        step(
          "Compare versions",
          p("Each change creates a new profile version, and every event records the profile and version that applied, so you can measure the change.")
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
          p("Build the screen from the [block vocabulary](/docs/concepts/displays). Every block needs an `id` that is unique on the screen."),
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
          p("`show` delivers the blocks with the `display` intent, so only devices that publish `present.display` are considered."),
          both(
            [`await dopl.show("usr_123", { blocks });`],
            curl(
              "POST",
              "/users/usr_123/deliver",
              '{"intent":"display","content":{"blocks":[{"id":"title","type":"heading","text":"Flight UA 212"}]},"urgency":"normal","idempotency_key":"req_03"}'
            )
          )
        ),
        step(
          "Check the limits",
          p(
            "The device's `present.display` descriptor states how many blocks and how many bytes of text it can show. Read it from the `device` that the exchange and List connections return. When a screen is too large, Dopl keeps the first blocks that fit and cuts their text to an exact prefix, unless the profile's `overflow` says otherwise."
          )
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
          p(
            "`ask` delivers a question with the `ask` intent and waits for the answer. With two or more options Dopl uses `ask.choice`; without options it uses `ask.text` or `ask.confirm`, whichever the device supports. Keep options within the device's limit; glasses show at most four, and more fails with `invalid_request`."
          ),
          code(
            "TypeScript",
            [
              `const answer = await dopl.ask("usr_123", {`,
              `  question: "Book the 9:40 flight?",`,
              `  options: ["Yes", "No"],`,
              `});`,
              ``,
              `if (answer.status === "answered") console.log(answer.answer);`,
              `else console.log("No answer yet", answer.delivery.delivery_id);`,
            ].join("\n")
          )
        ),
        step(
          "How the wait works",
          p(
            "The Deliver call itself holds for up to 200 seconds while the user decides. If the user answers in time, the response's `status` is `done`; if not, it is still `delivered` or `queued`. Either way, read the answer from `GET /v1/actions/{id}` with the `delivery_id`, which is what `ask` does for you until its `timeoutMs` passes, 200 seconds by default. A timeout resolves with `status: \"timeout\"`, and a failed action throws."
          ),
          both([`const action = await dopl.actions.get(delivery_id);`], curl("GET", `/actions/${DELIVERY_ID}`)),
          code(
            "200",
            json({
              action_id: DELIVERY_ID,
              device_id: DEVICE_ID,
              capability: "ask.choice",
              status: "done",
              result: { simulated: true, index: 0, label: "Yes" },
              error: null,
              created_at: "2026-10-27T17:02:11Z",
              updated_at: "2026-10-27T17:02:11Z",
            })
          )
        ),
        step(
          "Ask on one device",
          p(
            "To ask on a specific device, run `ask.choice` there with [Run a device action](/docs/api-reference/device-actions). It holds the same way, and you read the answer with the `action_id`."
          ),
          both(
            [`const { action_id } = await dopl.devices.action(deviceId, "ask.choice", { question: "Book it?", options: [{ label: "Yes" }, { label: "No" }] });`],
            curl("POST", `/devices/${DEVICE_ID}/actions/ask.choice`, '{"args":{"question":"Book it?","options":[{"label":"Yes"},{"label":"No"}]},"idempotency_key":"req_05"}')
          )
        ),
      ],
    },
    p(
      "An `ask.answered` webhook comes with the developer portal. Agents reach glasses with the same flow today through `glasses_ask` on the [hosted MCP server](/docs/use-cases/ask)."
    ),
  ]),
  guide("test-mode", "Test mode", "Build and run CI against simulated devices", [
    p(
      "Every project has a test environment. Requests made with an `sk_test_` key only touch test data, and nothing made in test ever reaches a live device."
    ),
    { type: "h2", text: "Simulated devices" },
    p(
      "With a test key, the Connect page offers a simulated device of every kind: glasses, phone, desktop, watch, home hub, home device, vehicle and robot. They exist only in test, and a live key never sees them. Each one publishes a realistic set of capabilities with limits modeled on a typical device of its kind; the simulated glasses match the Even Realities G2 lens. To pair one, choose it on the Connect page and press **Continue** under the code it shows."
    ),
    p(
      "A simulated device runs every call it supports and completes it at once with a `result` that includes `simulated: true`. Routing, grants, risk tiers and limits apply exactly as they do on real hardware, so a simulated watch truncates a long message the way a watch would."
    ),
    { type: "h2", text: "Deterministic answers" },
    {
      type: "table",
      columns: ["Capability", "Simulated `result`"],
      rows: [
        ["`ask.choice`", "The first option: `{ \"simulated\": true, \"index\": 0, \"label\": \"Yes\" }`"],
        ["`ask.confirm`", "Confirmed: `{ \"simulated\": true, \"confirmed\": true }`"],
        ["`ask.text`", "`{ \"simulated\": true, \"text\": \"simulated reply\" }`"],
        ["Everything else", "`{ \"simulated\": true }`"],
      ],
    },
    { type: "h2", text: "Forcing failures" },
    p(
      "Use one of these IDs as the end user's `external_user_id`, exactly or followed by `_` and any suffix such as `sim_device_offline_ci42`, and every simulated device of that user fails the same way. The same IDs work as a simulated device's ID, but Connect gives devices generated IDs, so the end user ID is the one you control."
    ),
    {
      type: "table",
      columns: ["ID", "Effect"],
      rows: [
        ["`sim_device_offline`", "The user's devices read as offline: context lists none, and Deliver and device actions fail with `device_offline` (409, retryable)"],
        ["`sim_confirm_denied`", "Every Deliver and device action fails with `confirmation_denied` (403, not retryable)"],
      ],
    },
    code(
      "TypeScript",
      [
        `await dopl.connectSessions.create({`,
        `  external_user_id: "sim_device_offline_ci42",`,
        `  requested_scopes: ["present.*"],`,
        `  redirect_uri: "http://localhost:3000/connected",`,
        `});`,
        `// …pair a simulated device and exchange the token, then:`,
        `await dopl.notify("sim_device_offline_ci42", { text: "hi" }); // throws DoplError, code "device_offline"`,
      ].join("\n")
    ),
    p("Use a fresh suffix per CI run so each run starts with its own end user."),
  ]),
];
