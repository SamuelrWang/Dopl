"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { pillButton } from "@/shared/ui/pill-button";
import { CreateButton } from "../_components/create-button";
import { DialogActions, StandardDialog } from "@/shared/ui/standard-dialog";
import { StatusPill } from "@/shared/ui/status-pill";
import { toast } from "@/shared/ui/toast";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { minsAgo } from "../_data/company";
import { ALL_KEY_SCOPES, type ApiKeyRow } from "../_data/misc";
import { usePortal } from "../_components/portal-store";
import { Cell, FactChip, Id, PortalPage, RowList, Strip, ov, since } from "../_components/ui";

const STALE_MINS = 30 * 1440;

const tail = (n: number) => Array.from({ length: n }, (_, i) => "abcdefghjkmnpqrstuvwxyz23456789"[(n * 7 + i * 13) % 31]).join("");

export function KeysSection() {
  const { state, update } = usePortal();
  const keys = state.keys.filter((k) => k.env === state.env);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["deliver"]);
  const [secret, setSecret] = useState<string | null>(null);

  const create = () => {
    const prefix = `sk_${state.env}_`;
    const full = `${prefix}${tail(24)}`;
    const row: ApiKeyRow = { id: `key_${state.keys.length + 1}`, name: name || "Untitled key", kind: "secret", env: state.env, prefix: full.slice(0, prefix.length + 4), scopes, createdAt: minsAgo(0), lastUsedAt: null, revoked: false };
    update((s) => ({ ...s, keys: [row, ...s.keys] }));
    setSecret(full);
    setCreating(false);
    setName("");
  };
  const rotate = (id: string) => {
    update((s) => ({ ...s, keys: s.keys.map((k) => (k.id === id ? { ...k, prefix: `${k.prefix.slice(0, -4)}${tail(4)}`, createdAt: minsAgo(0) } : k)) }));
    toast({ title: "Key rotated", description: "The old secret keeps working for 24 hours." });
  };
  const revoke = (id: string) => update((s) => ({ ...s, keys: s.keys.map((k) => (k.id === id ? { ...k, revoked: true } : k)) }));
  const active = keys.filter((k) => !k.revoked);
  const stale = active.filter((k) => !k.lastUsedAt || Date.parse(minsAgo(0)) - Date.parse(k.lastUsedAt) > STALE_MINS * 60_000);

  return (
    <PortalPage title="API keys" actions={<CreateButton onClick={() => setCreating(true)}>Create key</CreateButton>}>
      <Strip label="Summary">
        <Cell label="Active keys" value={String(active.length)} />
        <Cell label="Unused for 30 days" value={String(stale.length)} />
        <Cell label="Environment" value={state.env === "live" ? "Live" : "Test"} />
      </Strip>
      {secret && (
        <section className="white-card flex items-center gap-2 px-3.5 py-3" aria-label="New secret">
          <span className={ov.rowMain}>
            <span className={ov.rowTitle}>Copy this secret now, it is shown once</span>
            <Id className="text-caption">{secret}</Id>
          </span>
          <CopyButton text={secret} label="Copy secret" />
          <button type="button" className={pillButton("quiet", "sm")} onClick={() => setSecret(null)}>
            Done
          </button>
        </section>
      )}
      <RowList>
        {keys.map((k) => {
          const isStale = stale.includes(k);
          return (
            <li key={k.id} className={cn(ov.row, "min-h-13 border-t border-border-default first:border-t-0", k.revoked && "opacity-60")}>
              <span className={ov.rowMain}>
                <span className={ov.rowTitle}>
                  {k.name}
                  <Id>{k.prefix}...</Id>
                </span>
                <span className="flex flex-wrap gap-1 pt-0.5">
                  {k.scopes.map((s) => (
                    <FactChip key={s}>{s}</FactChip>
                  ))}
                </span>
              </span>
              {k.revoked ? <StatusPill>Revoked</StatusPill> : isStale ? <StatusPill tone="attention">Unused for 30 days</StatusPill> : null}
              <span className={ov.rowAside}>{k.lastUsedAt ? `Used ${since(k.lastUsedAt)}` : "Never used"}</span>
              {!k.revoked && (
                <span className="flex shrink-0 gap-1.5">
                  {k.kind === "secret" && (
                    <button type="button" className={pillButton("outline", "xs")} onClick={() => rotate(k.id)}>
                      Rotate
                    </button>
                  )}
                  <button type="button" className={pillButton("quiet", "xs")} onClick={() => revoke(k.id)}>
                    Revoke
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </RowList>
      <StandardDialog open={creating} onClose={() => setCreating(false)} title="Create key">
        <div className="flex flex-col gap-3">
          <input aria-label="Key name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className={cn(RAISED_INPUT, "h-8 px-3")} />
          <span className="flex flex-wrap gap-1.5">
            {ALL_KEY_SCOPES.map((s) => {
              const on = scopes.includes(s);
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => setScopes(on ? scopes.filter((x) => x !== s) : [...scopes, s])} className={pillButton(on ? "ink" : "outline", "xs", { raise: false })}>
                  {s}
                </button>
              );
            })}
          </span>
        </div>
        <DialogActions>
          <button type="button" className={pillButton("quiet", "md")} onClick={() => setCreating(false)}>
            Cancel
          </button>
          <button type="button" className={pillButton("ink", "md", { raise: false })} onClick={create}>
            Create key
          </button>
        </DialogActions>
      </StandardDialog>
    </PortalPage>
  );
}
