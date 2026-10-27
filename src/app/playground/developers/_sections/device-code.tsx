"use client";

import { useState } from "react";
import type { ApiKey, CapabilityDescriptor, ConnectSessionCreateRequest, DeliverRequest } from "@dopl/contracts/device-sdk";
import { CopyButton } from "@/shared/ui/copy-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { Card } from "../_components/ui";
import { scopesFor, type DeviceType } from "../_data/device-types";

/** The openapi `servers` entry; every path below is the spec's, appended to it. */
const API = "https://api.usedopl.com/v1";

type Lang = "ts" | "curl" | "mcp";
const LANGS = [
  { key: "ts", label: "TypeScript" },
  { key: "curl", label: "curl" },
  { key: "mcp", label: "MCP" },
] as const satisfies ReadonlyArray<{ key: Lang; label: string }>;

const masked = (k: ApiKey | null) => (k ? `${k.prefix}${"•".repeat(8)}` : "sk_test_…");

export function snippets(type: DeviceType, descriptors: readonly CapabilityDescriptor[], key: ApiKey | null): Record<Lang, string> {
  const session: ConnectSessionCreateRequest = {
    external_user_id: "usr_123",
    allowed_kinds: [type.kind],
    requested_scopes: scopesFor(descriptors.map((d) => d.capability)),
  };
  const deliver: DeliverRequest = {
    intent: "message",
    content: { text: "Your 3pm moved to 4pm." },
    urgency: "normal",
    target: "auto",
    idempotency_key: "msg_0001",
  };
  const k = masked(key);
  const json = (v: unknown) => JSON.stringify(v);
  return {
    ts: `npm install @dopl/sdk

import { Dopl } from "@dopl/sdk";

const dopl = new Dopl({ apiKey: process.env.DOPL_SECRET_KEY! }); // ${k}

// 1. Send the user to Connect to pair their ${type.name}
const session = await dopl.connectSessions.create({
  external_user_id: ${json(session.external_user_id)},
  allowed_kinds: ${json(session.allowed_kinds)},
  requested_scopes: ${json(session.requested_scopes)},
});
// redirect to session.url

// 2. Deliver by intent; Dopl routes to the device
await dopl.users.deliver(${json(session.external_user_id)}, {
  intent: ${json(deliver.intent)},
  content: ${json(deliver.content)},
  target: ${json(deliver.target)},
});`,
    curl: `curl ${API}/connect_sessions \\
  -H "Authorization: Bearer ${k}" \\
  -H "Content-Type: application/json" \\
  -d '${json(session)}'

curl ${API}/users/${session.external_user_id}/deliver \\
  -H "Authorization: Bearer ${k}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: ${deliver.idempotency_key}" \\
  -d '${json(deliver)}'`,
    mcp: JSON.stringify(
      { mcpServers: { dopl: { command: "npx", args: ["dopl-sdk-mcp"], env: { DOPL_API_KEY: k } } } },
      null,
      2
    ),
  };
}

export function ConnectCode({ type, descriptors, testKey }: { type: DeviceType; descriptors: readonly CapabilityDescriptor[]; testKey: ApiKey | null }) {
  const [lang, setLang] = useState<Lang>("ts");
  const code = snippets(type, descriptors, testKey)[lang];
  return (
    <Card title="Connect your agent" aside={<SegmentedControl options={LANGS} value={lang} onChange={setLang} ariaLabel="Language" />}>
      <div className="card-well relative">
        <pre className="overflow-x-auto px-3.5 py-3 pr-10 font-mono text-caption leading-relaxed text-text-primary">{code}</pre>
        <CopyButton text={code} className="absolute right-2 top-2" />
      </div>
    </Card>
  );
}
