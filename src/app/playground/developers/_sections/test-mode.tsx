"use client";

import { useState } from "react";
import type { Connection, DeliverRequest, DeliverResponse, ErrorCode, ErrorResponse } from "@dopl/contracts/device-sdk";
import { ERROR_CODE_INFO, TEST_MAGIC_DEVICE_IDS, errorDocUrl } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Card, Chip, Chips, Json, Table, deviceName, ov } from "../_components/ui";

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
      <Card title="Test mode">
        <EmptyState variant="outline" title="Simulators run in test only" />
        <button type="button" className={cn(pillButton("ink", "md"), "self-start")} onClick={() => setEnv("test")}>
          Switch to test
        </button>
      </Card>
    );
  }

  const chosen = sims.find((c) => c.id === target) ?? null;

  return (
    <>
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-3.5">
        <Card title="Simulators" count={sims.length}>
          <Table columns={["Simulator", "User", "Capabilities", "Behaviour"]}>
            {sims.map((c) => {
              const magic = MAGIC.find(([id]) => c.external_user_id === id);
              return (
                <tr key={c.id}>
                  <td>
                    <span className="flex flex-col py-1.5">
                      <span className="whitespace-nowrap font-medium">{deviceName(c.device)}</span>
                      <span className={cn(ov.rowMeta, "font-mono")}>{c.device.id}</span>
                    </span>
                  </td>
                  <td className="font-mono text-small">{c.external_user_id}</td>
                  <td>
                    <Chips>
                      {c.device.capabilities.map((d) => (
                        <Chip key={d.capability}>{d.capability}</Chip>
                      ))}
                    </Chips>
                  </td>
                  <td className="whitespace-nowrap">
                    {magic ? (
                      <StatusPill tone="attention" className="font-mono">
                        {magic[1]}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="live" dot bare>
                        Succeeds
                      </StatusPill>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title="Magic ids" count={MAGIC.length}>
          <ul className={ov.rows}>
            {MAGIC.map(([id, code]) => (
              <li key={id} className={ov.row}>
                <span className={ov.rowMain}>
                  <span className={cn(ov.rowTitle, "font-mono")}>{id}</span>
                  <span className={ov.rowMeta}>HTTP {ERROR_CODE_INFO[code].status}</span>
                </span>
                <Chip>{code}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Send a test delivery">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Simulator">
          {sims.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === target}
              onClick={() => setTarget(c.id)}
              className={cn(pillButton(c.id === target ? "ink" : "outline", "sm", { raise: false }), "font-mono")}
            >
              {c.external_user_id} · {c.device.kind}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
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
          <span className="font-mono text-caption text-text-muted">POST /v1/users/{chosen?.external_user_id ?? "…"}/deliver</span>
        </div>
        {result && (
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["Request", result.request],
                ["Response", result.response],
              ] as const
            ).map(([label, body]) => (
              <div key={label} className="flex min-w-0 flex-col gap-1.5">
                <span className={ov.cellLabel}>{label}</span>
                <Json value={body} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
