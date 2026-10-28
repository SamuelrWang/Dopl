"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { EmptyState } from "@/shared/ui/empty-state";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { Card, Table, ov } from "../_components/ui";

/** A key row as the server formatted it. The raw key is never here. */
export interface KeyView {
  id: string;
  masked: string;
  kind: "secret" | "publishable";
  scopes: string[];
  created: string;
  lastUsed: string;
  status: { kind: "active" } | { kind: "revoked" } | { kind: "expired" } | { kind: "expiring"; label: string };
}

/** Matches `keys.ts › DEFAULT_ROTATION_OVERLAP_MS`. */
const OVERLAP_HOURS = 24;

function Status({ status }: { status: KeyView["status"] }) {
  switch (status.kind) {
    case "revoked":
      return <StatusPill>Revoked</StatusPill>;
    case "expired":
      return <StatusPill>Expired</StatusPill>;
    case "expiring":
      return <StatusPill tone="attention">{status.label}</StatusPill>;
    default:
      return (
        <StatusPill tone="live" dot bare>
          Active
        </StatusPill>
      );
  }
}

async function postRotate(keyId: string): Promise<string> {
  const res = await fetch(`/api/developers/keys/${encodeURIComponent(keyId)}/rotate`, { method: "POST" });
  const body = (await res.json().catch(() => null)) as { secret?: string; error?: { message?: string } } | null;
  if (!res.ok || typeof body?.secret !== "string") {
    throw new Error(body?.error?.message ?? "Could not rotate the key");
  }
  return body.secret;
}

export function KeysTable({ env, keys, canRotate }: { env: "test" | "live"; keys: KeyView[]; canRotate: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = keys.filter((k) => k.status.kind === "active" || k.status.kind === "expiring").length;

  const rotate = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      setRevealed(await postRotate(id));
      setConfirming(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rotate the key");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {revealed && (
        <Card
          title="New key"
          aside={
            <button type="button" className={pillButton("outline", "sm")} onClick={() => setRevealed(null)}>
              Done
            </button>
          }
        >
          <div className="card-well flex items-center justify-between gap-3 px-3 py-2.5">
            <code className="truncate font-mono text-body text-text-primary">{revealed}</code>
            <CopyButton text={revealed} />
          </div>
          <p className={ov.note}>Shown once. Copy it now. The old key keeps working for {OVERLAP_HOURS}h.</p>
        </Card>
      )}
      {error && (
        <p role="alert" className={ov.note} data-tone="over">
          {error}
        </p>
      )}

      <Card title={env === "test" ? "Test keys" : "Live keys"} count={active}>
        {keys.length === 0 ? (
          <EmptyState variant="outline" title={`No ${env} keys`} />
        ) : (
          <Table columns={["Key", "Kind", "Scopes", "Created", "Last used", "Status", ""]}>
            {keys.map((k) => {
              const dead = k.status.kind === "revoked" || k.status.kind === "expired";
              const rotatable = canRotate && k.status.kind === "active";
              return (
                <tr key={k.id} className={cn(dead && "opacity-50")}>
                  <td className="whitespace-nowrap font-mono text-small">{k.masked}</td>
                  <td>{k.kind === "secret" ? "Secret" : "Publishable"}</td>
                  <td>
                    <span className="flex flex-wrap items-center gap-1 py-1.5">
                      {k.scopes.map((s) => (
                        <StatusPill key={s} className="font-mono">
                          {s}
                        </StatusPill>
                      ))}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-text-muted">{k.created}</td>
                  <td className="whitespace-nowrap text-text-muted">{k.lastUsed}</td>
                  <td className="whitespace-nowrap">
                    <Status status={k.status} />
                  </td>
                  <td>
                    <span className="flex justify-end gap-1">
                      {rotatable && confirming !== k.id && (
                        <button type="button" className={pillButton("quiet", "xs")} onClick={() => setConfirming(k.id)}>
                          Rotate
                        </button>
                      )}
                      {rotatable && confirming === k.id && (
                        <>
                          <button
                            type="button"
                            className={cn(pillButton("ink", "xs"), "disabled:opacity-60")}
                            disabled={busy === k.id}
                            onClick={() => void rotate(k.id)}
                          >
                            {busy === k.id ? "Rotating" : "Confirm rotate"}
                          </button>
                          <button type="button" className={pillButton("quiet", "xs")} onClick={() => setConfirming(null)}>
                            Cancel
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        {!canRotate && <p className={ov.note}>Only an org owner or admin can rotate keys.</p>}
      </Card>
    </>
  );
}
