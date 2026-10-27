"use client";

import { useState } from "react";
import type { Connection, DeliverRequest, DeliverResponse, ErrorCode, ErrorResponse } from "@dopl/contracts/device-sdk";
import { ERROR_CODE_INFO, TEST_MAGIC_DEVICE_IDS, errorDocUrl } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { LABEL_TEXT_MUTED } from "@/shared/ui/section-heading";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Card, Chip, Muted, PageHeader, Table, Td, deviceName } from "../_components/ui";

const MAGIC = Object.entries(TEST_MAGIC_DEVICE_IDS) as Array<[keyof typeof TEST_MAGIC_DEVICE_IDS, ErrorCode]>;

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  device_offline: "The user's simulated device is offline.",
  confirmation_denied: "The user denied the confirmation on their device.",
};

/** What `/v1/users/{id}/deliver` would answer for this simulated connection, computed locally. */
function simulate(c: Connection, n: number): DeliverResponse | ErrorResponse {
  const magic = MAGIC.find(([id]) => c.external_user_id === id || c.external_user_id.startsWith(`${id}_`));
  if (magic) {
    const code = magic[1];
    const info = ERROR_CODE_INFO[code];
    return {
      error: { type: info.type, code, message: MESSAGES[code] ?? code, device_kind: c.device.kind, retryable: info.retryable, doc_url: errorDocUrl(code) },
    };
  }
  return {
    delivery_id: `dlv_test_${(1000 + n).toString(36)}`,
    routed_to: { device_id: c.device.id, kind: c.device.kind, reason: "active_device" },
    status: "delivered",
  };
}

export function TestModeSection() {
  const { env, setEnv, fx } = usePortal();
  const sims = fx.connections.filter((c) => c.device.adapter_id === "simulator");
  const [target, setTarget] = useState<string>(sims[0]?.id ?? "");
  const [sent, setSent] = useState(0);
  const [result, setResult] = useState<{ request: DeliverRequest; response: DeliverResponse | ErrorResponse } | null>(null);

  if (env !== "test") {
    return (
      <>
        <PageHeader title="Test mode" />
        <Card>
          <div className="flex items-center justify-between gap-3">
            <Muted>Simulators run in the test environment only.</Muted>
            <button type="button" className={pillButton("ink", "md")} onClick={() => setEnv("test")}>
              Switch to test
            </button>
          </div>
        </Card>
      </>
    );
  }

  const chosen = sims.find((c) => c.id === target) ?? null;

  return (
    <>
      <PageHeader title="Test mode" />
      <Table columns={["Simulator", "external_user_id", "Capabilities", "Behaviour"]}>
        {sims.map((c) => {
          const magic = MAGIC.find(([id]) => c.external_user_id === id);
          return (
            <tr key={c.id}>
              <Td className="whitespace-nowrap">
                <div className="flex flex-col">
                  <span>{deviceName(c.device)}</span>
                  <span className="font-mono text-micro text-text-muted">{c.device.id}</span>
                </div>
              </Td>
              <Td mono>{c.external_user_id}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {c.device.capabilities.map((d) => (
                    <Chip key={d.capability}>{d.capability}</Chip>
                  ))}
                </div>
              </Td>
              <Td className="whitespace-nowrap">
                {magic ? (
                  <StatusPill tone="attention">{magic[1]}</StatusPill>
                ) : (
                  <StatusPill tone="live" dot bare>
                    Succeeds
                  </StatusPill>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>

      <Card title="Magic ids">
        <ul className="flex flex-col divide-y divide-border-subtle">
          {MAGIC.map(([id, code]) => (
            <li key={id} className="flex items-center justify-between gap-3 py-2">
              <code className="font-mono text-body text-text-primary">{id}</code>
              <div className="flex items-center gap-2">
                <Chip>{code}</Chip>
                <Muted>HTTP {ERROR_CODE_INFO[code].status}</Muted>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Send a test delivery">
        <div className="flex flex-wrap gap-2">
          {sims.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setTarget(c.id)}
              className={cn(pillButton(c.id === target ? "ink" : "outline", "sm", { raise: false }), "font-mono")}
            >
              {c.external_user_id} · {c.device.kind}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!chosen}
            className={cn(pillButton("ink", "md"), "disabled:opacity-60")}
            onClick={() => {
              if (!chosen) return;
              const request: DeliverRequest = {
                intent: "message",
                content: { text: "Your 3pm moved to 4pm." },
                urgency: "normal",
                target: "auto",
                idempotency_key: `demo-${sent + 1}`,
              };
              setResult({ request, response: simulate(chosen, sent) });
              setSent((n) => n + 1);
            }}
          >
            Send
          </button>
          <span className="font-mono text-caption text-text-muted">
            POST /v1/users/{chosen?.external_user_id ?? "…"}/deliver
          </span>
        </div>
        {result && (
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                ["Request", result.request],
                ["Response", result.response],
              ] as const
            ).map(([label, body]) => (
              <div key={label} className="flex min-w-0 flex-col gap-1.5">
                <span className={LABEL_TEXT_MUTED}>{label}</span>
                <pre className="card-well overflow-x-auto px-3.5 py-3 font-mono text-caption leading-relaxed text-text-secondary">
                  {JSON.stringify(body, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
