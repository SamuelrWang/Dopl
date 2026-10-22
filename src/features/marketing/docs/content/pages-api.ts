import type { DocPage, DocParam, HttpMethod } from "./types";

const API = "https://api.usedopl.com/v1";

const AUTH: DocParam = {
  name: "Authorization",
  type: "string",
  location: "header",
  required: true,
  description: "Bearer authentication: send your API key as `Authorization: Bearer <key>`.",
};

const USER_ID: DocParam = {
  name: "user_id",
  type: "string",
  location: "path",
  required: true,
  description: "Your ID for the end user. The user must have connected at least one device.",
};

const DEVICE: DocParam = {
  name: "device",
  type: "string",
  description: "An endpoint ID to pin the intent to one device. Omit it and Dopl picks the device.",
};

function curl(method: HttpMethod, path: string, body?: string): string {
  const lines = [
    `curl --request ${method} \\`,
    `  --url ${API}${path} \\`,
    `  --header 'Authorization: Bearer <key>'${body ? " \\" : ""}`,
  ];
  if (body) lines.push(`  --header 'Content-Type: application/json' \\`, `  --data '${body}'`);
  return lines.join("\n");
}

function endpoint(
  slug: string,
  title: string,
  description: string,
  method: HttpMethod,
  path: string,
  body: DocParam[],
  requestBody: string | undefined,
  response: string
): DocPage {
  return {
    slug: `api-reference/${slug}`,
    tab: "api",
    group: method === "GET" ? "Devices" : "Intents",
    title,
    description,
    blocks: [
      { type: "endpoint", method, path },
      { type: "params", title: "Authorizations", params: [AUTH] },
      { type: "params", title: "Path parameters", params: [USER_ID] },
      ...(body.length > 0 ? [{ type: "params" as const, title: "Body", params: body }] : []),
    ],
    aside: {
      title,
      request: [{ label: "cURL", code: curl(method, path.replace("{user_id}", "usr_123"), requestBody) }],
      responses: [
        { label: method === "POST" ? "201" : "200", code: response },
        { label: "401", code: '{\n  "error": "unauthorized"\n}' },
        { label: "404", code: '{\n  "error": "user_not_connected"\n}' },
      ],
    },
  };
}

export const API_PAGES: DocPage[] = [
  {
    slug: "api-reference",
    tab: "api",
    group: "Overview",
    title: "About the Dopl API",
    description: "Understanding the structure of Dopl API requests and responses",
    blocks: [
      {
        type: "p",
        text: "The Dopl API is REST-based. Every request authenticates with an API key in the `Authorization: Bearer` header.",
      },
      {
        type: "p",
        text: "An agent states an **intent** — `show`, `ask` or `notify` — for a user. Dopl picks the user's device and renders it there.",
      },
      { type: "h2", text: "Interfaces" },
      { type: "h3", text: "Hosted MCP" },
      { type: "p", text: "Connect any MCP host to `https://www.usedopl.com/api/mcp`. Sign in with OAuth or an API key." },
      { type: "h3", text: "SDKs" },
      {
        type: "code",
        tabs: [
          { label: "TypeScript", code: "npm install @dopl/client" },
          { label: "Python", code: "pip install dopl" },
        ],
      },
      { type: "h3", text: "CLI" },
      { type: "code", tabs: [{ label: "CLI", code: 'dopl notify usr_123 --text "Build finished"' }] },
      { type: "h3", text: "REST" },
      { type: "p", text: `Base URL: \`${API}\`. Requests and responses are JSON.` },
    ],
  },
  endpoint(
    "show",
    "Show",
    "Render blocks on the user's device",
    "POST",
    "/users/{user_id}/show",
    [
      {
        name: "blocks",
        type: "Block[]",
        required: true,
        description: "What to render: `heading`, `text`, `list`, `fields` or `image` blocks.",
      },
      { name: "display_id", type: "string", description: "Reuse to update the same display in place." },
      DEVICE,
    ],
    '{"blocks":[{"type":"heading","text":"Gate B14"}]}',
    '{\n  "id": "dsp_8f2c",\n  "device": "end_g2_01",\n  "status": "delivered"\n}'
  ),
  endpoint(
    "ask",
    "Ask",
    "Ask the user a question and get their answer",
    "POST",
    "/users/{user_id}/ask",
    [
      { name: "question", type: "string", required: true, description: "The question, one line." },
      { name: "options", type: "string[]", required: true, description: "Two to six choices." },
      { name: "wait", type: "boolean", description: "Hold the request until the user answers (up to 120s)." },
      DEVICE,
    ],
    '{"question":"Book the 9:40 flight?","options":["Yes","No"]}',
    '{\n  "id": "ask_41ab",\n  "status": "answered",\n  "answer": "Yes",\n  "device": "end_phone_02"\n}'
  ),
  endpoint(
    "notify",
    "Notify",
    "Send the user a short notification",
    "POST",
    "/users/{user_id}/notify",
    [
      { name: "text", type: "string", required: true, description: "The notification text." },
      { name: "urgency", type: "string", description: "`low`, `normal` or `high`. Defaults to `normal`." },
      DEVICE,
    ],
    '{"text":"Build finished"}',
    '{\n  "id": "ntf_77d0",\n  "device": "end_notch_03",\n  "status": "delivered"\n}'
  ),
  endpoint(
    "endpoints",
    "List endpoints",
    "List the devices a user has connected",
    "GET",
    "/users/{user_id}/endpoints",
    [],
    undefined,
    '{\n  "data": [\n    { "id": "end_g2_01", "kind": "even_realities_g2", "active": true },\n    { "id": "end_phone_02", "kind": "phone", "active": false }\n  ]\n}'
  ),
];

export const CHANGELOG_PAGES: DocPage[] = [
  {
    slug: "changelog",
    tab: "changelog",
    group: "Product updates",
    title: "Changelog",
    description: "",
    blocks: [
      {
        type: "changelog",
        entries: [
          {
            date: "October 20",
            title: "Developer docs",
            description: "Start here, use cases, devices and the API reference for show, ask and notify",
          },
        ],
      },
    ],
  },
];
