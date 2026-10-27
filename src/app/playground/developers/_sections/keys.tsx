"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { ApiKey } from "@dopl/contracts/device-sdk";
import { API_KEY_SCOPES } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Card, Chip, Muted, PageHeader, Table, Td, since } from "../_components/ui";

const KIND_OPTIONS = [
  { key: "secret", label: "Secret" },
  { key: "publishable", label: "Publishable" },
] as const;

const masked = (k: ApiKey) => `${k.prefix}${"•".repeat(12)}`;

function keyStatus(k: ApiKey) {
  if (k.revoked_at) return <StatusPill>Revoked</StatusPill>;
  if (k.expires_at) return <StatusPill tone="attention">Expires {since(k.expires_at)}</StatusPill>;
  return (
    <StatusPill tone="live" dot bare>
      Active
    </StatusPill>
  );
}

export function KeysSection() {
  const { env, keys, createKey, revokeKey } = usePortal();
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<ApiKey["kind"]>("secret");
  const [scopes, setScopes] = useState<ApiKey["scopes"]>([...API_KEY_SCOPES]);
  const [revealed, setRevealed] = useState<string | null>(null);

  const toggle = (s: ApiKey["scopes"][number]) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <>
      <PageHeader
        title="API keys"
        action={
          <button type="button" className={pillButton("ink", "lg")} onClick={() => setCreating((v) => !v)}>
            <Plus size={PILL_ICON.lg} aria-hidden="true" />
            Create key
          </button>
        }
      />

      {revealed && (
        <Card title="New key" aside={<button type="button" className={pillButton("quiet", "sm")} onClick={() => setRevealed(null)}>Done</button>}>
          <div className="card-well flex items-center justify-between gap-3 px-3 py-2.5">
            <code className="truncate font-mono text-body text-text-primary">{revealed}</code>
            <CopyButton text={revealed} />
          </div>
          <Muted>Shown once.</Muted>
        </Card>
      )}

      {creating && !revealed && (
        <Card title={`Create ${env} key`}>
          <SegmentedControl options={KIND_OPTIONS} value={kind} onChange={setKind} ariaLabel="Key kind" />
          <div className="flex flex-wrap gap-2">
            {(kind === "publishable" ? (["connect"] as const) : API_KEY_SCOPES).map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border-default px-2.5 py-1 font-mono text-caption text-text-primary">
                <input type="checkbox" checked={kind === "publishable" || scopes.includes(s)} disabled={kind === "publishable"} onChange={() => toggle(s)} />
                {s}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={cn(pillButton("ink", "md"), "disabled:opacity-60")}
              disabled={kind === "secret" && scopes.length === 0}
              onClick={() => {
                setRevealed(createKey(kind, scopes));
                setCreating(false);
              }}
            >
              Create
            </button>
            <button type="button" className={pillButton("quiet", "md")} onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </Card>
      )}

      <Table columns={["Key", "Kind", "Scopes", "Created", "Last used", "Status", ""]}>
        {keys.map((k) => (
          <tr key={k.id} className={cn(k.revoked_at && "opacity-50")}>
            <Td mono className="whitespace-nowrap">
              {masked(k)}
            </Td>
            <Td>{k.kind === "secret" ? "Secret" : "Publishable"}</Td>
            <Td>
              <div className="flex flex-wrap gap-1">
                {k.scopes.map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
              </div>
            </Td>
            <Td className="whitespace-nowrap text-text-secondary">{since(k.created_at)}</Td>
            <Td className="whitespace-nowrap text-text-secondary">{since(k.last_used_at)}</Td>
            <Td className="whitespace-nowrap">{keyStatus(k)}</Td>
            <Td className="text-right">
              {!k.revoked_at && (
                <button type="button" className={pillButton("quiet", "xs")} onClick={() => revokeKey(k.id)}>
                  Revoke
                </button>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
