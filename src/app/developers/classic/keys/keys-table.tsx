"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { CopyButton } from "@/shared/ui/copy-button";
import { EmptyState } from "@/shared/ui/empty-state";
import { FormDialog, PillChoice } from "@/shared/ui/form-dialog";
import { CreateButton, pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { Card, PageHeader, Table, ov } from "../../_components/ui";
import { errorText, portalCall } from "../../_lib/client-api";

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

const KIND_OPTIONS = [
  { key: "secret", label: "Secret", hint: "Server side. Every scope." },
  { key: "publishable", label: "Publishable", hint: "Safe in an app. Connect only." },
] as const;
type NewKind = (typeof KIND_OPTIONS)[number]["key"];

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

/**
 * `/developers/classic/keys` body: the header's Create key, the once-only secret card, and the table with
 * Rotate and Revoke. Every write is a `/api/developers/*` call; the page re-reads after each.
 */
export function KeysTable({
  projectId,
  env,
  keys,
  canManage,
  internal = false,
}: {
  projectId: string;
  env: "test" | "live";
  keys: KeyView[];
  canManage: boolean;
  /** An internal org's keys are created and revoked by hand (`portal-admin.ts › refuseInternal`); Rotate stays. */
  internal?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ secret: string; rotated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<NewKind>("secret");
  const [createBusy, setCreateBusy] = useState(false);
  const [revoking, setRevoking] = useState<KeyView | null>(null);
  const active = keys.filter((k) => k.status.kind === "active" || k.status.kind === "expiring").length;

  const rotate = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const out = await portalCall<{ secret: string }>(`/api/developers/keys/${encodeURIComponent(id)}/rotate`, "POST");
      setRevealed({ secret: out.secret, rotated: true });
      setConfirming(null);
      router.refresh();
    } catch (e) {
      setError(errorText(e, "Could not rotate the key"));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (createBusy) return;
    setCreateBusy(true);
    setError(null);
    try {
      const out = await portalCall<{ secret: string }>(
        `/api/developers/projects/${encodeURIComponent(projectId)}/keys`,
        "POST",
        { env, kind: newKind }
      );
      setRevealed({ secret: out.secret, rotated: false });
      setCreating(false);
      setNewKind("secret");
      router.refresh();
    } catch (e) {
      setError(errorText(e, "Could not create the key"));
      setCreating(false);
    } finally {
      setCreateBusy(false);
    }
  };

  const revoke = async (k: KeyView) => {
    setError(null);
    try {
      await portalCall(`/api/developers/keys/${encodeURIComponent(k.id)}`, "DELETE");
      router.refresh();
    } catch (e) {
      setError(errorText(e, "Could not revoke the key"));
      throw e;
    }
  };

  return (
    <>
      <PageHeader
        title="API keys"
        action={canManage && !internal ? <CreateButton onClick={() => setCreating(true)}>Create {env} key</CreateButton> : undefined}
      />

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
            <code className="truncate font-mono text-body text-text-primary">{revealed.secret}</code>
            <CopyButton text={revealed.secret} />
          </div>
          <p className={ov.note}>
            Shown once. Copy it now.
            {revealed.rotated ? ` The old key keeps working for ${OVERLAP_HOURS}h.` : ""}
          </p>
        </Card>
      )}
      {error && (
        <p role="alert" className={ov.note} data-tone="over">
          {error}
        </p>
      )}

      <Card title={env === "test" ? "Test keys" : "Live keys"} count={active}>
        {keys.length === 0 ? (
          <EmptyState
            variant="outline"
            title={`No ${env} keys`}
            description={canManage ? `Create a ${env} key to call the API.` : undefined}
          />
        ) : (
          <Table columns={["Key", "Kind", "Scopes", "Created", "Last used", "Status", ""]}>
            {keys.map((k) => {
              const dead = k.status.kind === "revoked" || k.status.kind === "expired";
              const rotatable = canManage && k.status.kind === "active";
              const revocable = canManage && !internal && !dead;
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
                      {revocable && confirming !== k.id && (
                        <button type="button" className={pillButton("quiet", "xs")} onClick={() => setRevoking(k)}>
                          Revoke
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        {!canManage && <p className={ov.note}>Only an org owner or admin can create, rotate or revoke keys.</p>}
        {canManage && internal && <p className={ov.note}>Internal org. Keys are created and revoked by hand.</p>}
      </Card>

      <FormDialog
        open={creating}
        onDiscard={() => {
          setCreating(false);
          setNewKind("secret");
        }}
        title={`New ${env} key`}
        primary={{ label: createBusy ? "Creating" : "Create key", onClick: () => void create(), busy: createBusy }}
      >
        <PillChoice label="Kind" options={KIND_OPTIONS} value={newKind} onChange={setNewKind} ariaLabel="Key kind" />
        <p className={ov.note}>
          {env === "live"
            ? "A live key reaches real devices and real users."
            : "A test key only reaches test devices and the simulator."}{" "}
          The full key is shown once.
        </p>
      </FormDialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this key?"
        description={
          revoking
            ? `${revoking.masked} stops working now. Any app still using it gets an error. This cannot be undone.`
            : undefined
        }
        confirmLabel="Revoke key"
        destructive
        onConfirm={async () => {
          if (revoking) await revoke(revoking);
        }}
      />
    </>
  );
}
