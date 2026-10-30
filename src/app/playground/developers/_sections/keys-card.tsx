"use client";

/** A key: what it is, whether it is in use, what it may do, how much it does, what to do with it. */
import { Copy, Globe, KeyRound, Plus, RefreshCw, type LucideIcon } from "lucide-react";
import b from "../_design/base.module.css";
import c from "../_design/catalog.module.css";
import { cx, ICON_100, ICON_100_SM, Initials, initialsOf } from "../_design/components";
import k from "../_design/keys.module.css";
import type { ApiKeyRow } from "../_data/misc";
import { fmt, since } from "../_components/ui";
import { oldSecretLeft, stateOf, type KeyKind } from "./keys-model";

export const KIND_GLYPH: Record<KeyKind, LucideIcon> = { secret: KeyRound, publishable: Globe };
const TONE = { ok: b.badgeOk, warn: b.badgeWarn, plain: undefined };

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className={c.figure}>
      <span className={b.smallMuted}>{label}</span>
      <span className={cx(b.h3, b.num, b.nowrap)}>{value}</span>
    </span>
  );
}

export function KeyCard({ row, onRotate, onRevoke, onCopy }: { row: ApiKeyRow; onRotate: () => void; onRevoke: () => void; onCopy: (token: string) => void }) {
  const Glyph = KIND_GLYPH[row.kind];
  const state = stateOf(row);
  const left = oldSecretLeft(row);
  return (
    <article className={b.card} aria-label={row.name}>
      <div className={c.head}>
        <span className={row.revoked ? b.tile : c.glyph}>
          <Glyph {...ICON_100} aria-hidden="true" />
        </span>
        <div className={cx(b.tight, b.grow)}>
          <span className={cx(b.h3, c.footText)} title={row.name}>
            {row.name}
          </span>
          <span className={k.token}>{row.token ?? `${row.prefix}••••`}</span>
        </div>
        <div className={c.headBadges}>
          <span className={cx(b.badge, TONE[state.tone])}>
            {state.tone === "ok" && <span className={b.dot} />}
            {state.label}
          </span>
          {left && <span className={cx(b.badge, b.badgeWarn)}>{left}</span>}
        </div>
      </div>
      <div className={c.chips}>
        {row.scopes.map((scope) => (
          <span key={scope} className={cx(b.badge, b.badgeRing)}>
            {scope}
          </span>
        ))}
      </div>
      <div className={c.well}>
        {row.revoked ? <Figure label="Revoked" value={since(row.revokedAt ?? null)} /> : <Figure label="Last used" value={since(row.lastUsedAt)} />}
        <Figure label="Calls, 7d" value={fmt(row.calls7d)} />
        <Figure label="Created" value={since(row.createdAt)} />
      </div>
      <div className={c.foot}>
        <div className={c.footMain}>
          <Initials text={initialsOf(row.createdBy)} small />
          <span className={cx(b.small, c.footText)}>{row.createdBy}</span>
        </div>
        {!row.revoked && (
          <>
            {row.token ? (
              <button type="button" className={cx(b.btn, b.sm)} onClick={() => onCopy(row.token!)}>
                <Copy {...ICON_100_SM} aria-hidden="true" />
                Copy
              </button>
            ) : (
              <button type="button" className={cx(b.btn, b.sm)} onClick={onRotate}>
                <RefreshCw {...ICON_100_SM} aria-hidden="true" />
                Rotate
              </button>
            )}
            <button type="button" className={cx(b.btn, b.sm, b.dangerOutline)} onClick={onRevoke}>
              Revoke
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/** Closes a section and starts the flow on that type. */
export function AddKeyCard({ label, env, wide, onClick }: { label: string; env: string; wide: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cx(c.add, wide && c.addWide)} onClick={onClick}>
      <span className={c.addHead}>
        <span className={b.tile}>
          <Plus {...ICON_100} aria-hidden="true" />
        </span>
        <span className={b.tight}>
          <span className={b.strong}>{label}</span>
          <span className={b.smallMuted}>{env}</span>
        </span>
      </span>
    </button>
  );
}
