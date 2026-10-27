"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { ApiKey } from "@dopl/contracts/device-sdk";
import { API_KEY_SCOPES } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { rotate, setLogFilter } from "../_components/portal-actions";
import { PORTAL_BASE } from "../_components/portal-shell";
import { ROTATE_GRACE_HOURS, isStale } from "../_data/keys";
import { Card, Chip, PageHeader, Chips, Table, ov, since } from "../_components/ui";

const KIND_OPTIONS = [
  { key: "secret", label: "Secret" },
  { key: "publishable", label: "Publishable" },
] as const;

const masked = (k: ApiKey) => `${k.prefix}${"•".repeat(12)}`;

function keyStatus(k: ApiKey) {
  if (k.revoked_at) return <StatusPill>Revoked</StatusPill>;
  if (k.expires_at) return <StatusPill tone="attention">Expires {since(k.expires_at)}</StatusPill>;
  if (isStale(k)) return <StatusPill>Unused 30d</StatusPill>;
  return (
    <StatusPill tone="live" dot bare>
      Active
    </StatusPill>
  );
}

export function KeysSection() {
  const router = useRouter();
  const { env, keys, log, createKey, revokeKey } = usePortal();
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<ApiKey["kind"]>("secret");
  const [scopes, setScopes] = useState<ApiKey["scopes"]>([...API_KEY_SCOPES]);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);
  const active = keys.filter((k) => !k.revoked_at).length;

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
        <Card
          title={rotated ? "Rotated key" : "New key"}
          aside={
            <button
              type="button"
              className={pillButton("outline", "sm")}
              onClick={() => {
                setRevealed(null);
                setRotated(false);
              }}
            >
              Done
            </button>
          }
        >
          <div className="card-well flex items-center justify-between gap-3 px-3 py-2.5">
            <code className="truncate font-mono text-body text-text-primary">{revealed}</code>
            <CopyButton text={revealed} />
          </div>
          <p className={ov.note}>{rotated ? `Shown once · old key works for ${ROTATE_GRACE_HOURS}h` : "Shown once"}</p>
        </Card>
      )}

      {creating && !revealed && (
        <Card title={`New ${env} key`}>
          <SegmentedControl options={KIND_OPTIONS} value={kind} onChange={setKind} ariaLabel="Key kind" />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Scopes">
            {(kind === "publishable" ? (["connect"] as const) : API_KEY_SCOPES).map((s) => {
              const on = kind === "publishable" || scopes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  disabled={kind === "publishable"}
                  onClick={() => toggle(s)}
                  className={cn(pillButton(on ? "ink" : "outline", "xs", { raise: false }), "font-mono disabled:opacity-60")}
                >
                  {s}
                </button>
              );
            })}
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

      <Card title={env === "test" ? "Test keys" : "Live keys"} count={active}>
        <Table columns={["Key", "Kind", "Scopes", { label: "Requests", num: true }, "Created", "Last used", "Status", ""]}>
          {keys.map((k) => (
            <tr key={k.id} className={cn(k.revoked_at && "opacity-50")}>
              <td className="whitespace-nowrap font-mono text-small">{masked(k)}</td>
              <td>{k.kind === "secret" ? "Secret" : "Publishable"}</td>
              <td>
                <Chips>
                  {k.scopes.map((s) => (
                    <Chip key={s}>{s}</Chip>
                  ))}
                </Chips>
              </td>
              <td className={cn(ov.num, "font-mono text-small")}>{log.filter((r) => r.key_id === k.id).length}</td>
              <td className="whitespace-nowrap text-text-muted">{since(k.created_at)}</td>
              <td className="whitespace-nowrap text-text-muted">{since(k.last_used_at)}</td>
              <td className="whitespace-nowrap">{keyStatus(k)}</td>
              <td>
                <span className="flex justify-end gap-1">
                  {k.kind === "secret" && (
                    <button
                      type="button"
                      className={pillButton("quiet", "xs")}
                      onClick={() => {
                        setLogFilter({ key_id: k.id, type: "request" });
                        router.push(`${PORTAL_BASE}/events`);
                      }}
                    >
                      View requests
                    </button>
                  )}
                  {!k.revoked_at && !k.expires_at && (
                    <button
                      type="button"
                      className={pillButton("quiet", "xs")}
                      onClick={() => {
                        const secret = rotate(k.id);
                        if (secret) {
                          setRevealed(secret);
                          setRotated(true);
                        }
                      }}
                    >
                      Rotate
                    </button>
                  )}
                  {!k.revoked_at && (
                    <button type="button" className={pillButton("quiet", "xs")} onClick={() => revokeKey(k.id)}>
                      Revoke
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
