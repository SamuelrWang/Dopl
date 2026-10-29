/**
 * Code shown on the `/devices` landing. Written from the real client (`packages/sdk/src/client.ts`,
 * `helpers.ts`, README "Quickstart"): `connectSessions.create`, `users.deliver`, `ask`. The import
 * is `@dopl/devices` per the landing outline (the package ships as `@dopl/sdk` today; the rename
 * is the SDK repo lane's). The cURL body carries the fields `DeliverRequestSchema` requires
 * (`packages/device-contracts/src/actions.ts`), including `urgency` and `idempotency_key`, which
 * the TypeScript client fills for you.
 */

export const API_BASE = "https://www.usedopl.com/api/v1";

export const HERO_SNIPPET = `const delivery = await dopl.users.deliver("usr_123", {
  intent: "message",
  content: { text: "Your build finished" },
  target: "auto",
});
// delivery.routed_to: { device_id, kind, reason }`;

export const TS_SAMPLE = `import { Dopl } from "@dopl/devices";

const dopl = new Dopl({ apiKey: process.env.DOPL_SECRET_KEY! });

// Send your user to session.url to pair a device on the hosted Connect page.
const session = await dopl.connectSessions.create({
  external_user_id: "usr_123",
  requested_scopes: ["present.*", "ask.*"],
});

// Deliver by intent. Dopl picks the device and says why.
const { routed_to } = await dopl.users.deliver("usr_123", {
  intent: "message",
  content: { text: "Your build finished" },
  target: "auto",
});

// Ask, and get the user's answer back.
const answer = await dopl.ask("usr_123", { question: "Ship it?", options: ["Yes", "No"] });`;

export const CURL_SAMPLE = `# Your user pairs a device on the hosted Connect page.
curl ${API_BASE}/connect_sessions \\
  -H "Authorization: Bearer $DOPL_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"external_user_id": "usr_123", "requested_scopes": ["present.*", "ask.*"]}'

# Deliver by intent. Dopl picks the device and says why.
curl ${API_BASE}/users/usr_123/deliver \\
  -H "Authorization: Bearer $DOPL_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: build-42" \\
  -d '{"intent": "message", "urgency": "normal", "target": "auto",
       "content": {"text": "Your build finished"}, "idempotency_key": "build-42"}'`;

export const CODE_TABS = [
  { id: "ts", label: "TypeScript", file: "deliver.ts", code: TS_SAMPLE },
  { id: "curl", label: "cURL", file: "deliver.sh", code: CURL_SAMPLE },
] as const;
