"use client";

/** Everything that interrupts the list: the create flow, the once-only reveal, rotate and revoke. */
import { Activity, AlertTriangle, Check, Copy, Cpu, RefreshCw, Send, SlidersHorizontal, Users, Webhook, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import b from "../_design/base.module.css";
import c from "../_design/catalog.module.css";
import { cx, ICON_100, ICON_100_SM } from "../_design/components";
import d from "../_design/data.module.css";
import flow from "../_design/flow.module.css";
import f from "../_design/forms.module.css";
import { Segmented } from "../_design/interactive";
import k from "../_design/keys.module.css";
import o from "../_design/surfaces.module.css";
import tokens from "../_design/tokens.module.css";
import type { Env } from "../_data/company";
import { KEY_SCOPES, type ApiKeyRow } from "../_data/misc";
import { fmt, since } from "../_components/ui";
import { KIND_GLYPH } from "./keys-card";
import { GRACE, inUse, type KeyKind } from "./keys-model";

const ENV_LABEL: Record<Env, string> = { live: "Live", test: "Test" };
const KIND_LABEL: Record<KeyKind, string> = { secret: "Secret", publishable: "Publishable" };
const SCOPE_GLYPH: Record<string, LucideIcon> = { deliver: Send, "devices.act": SlidersHorizontal, "devices.read": Cpu, "users.read": Users, "events.read": Activity, "webhooks.write": Webhook };

const STEP_TYPE = "Choose a key type";
const STEP_SCOPES = "Choose what it can do";
const STEP_NAME = "Name this key";

export const copyText = (text: string) => void navigator.clipboard?.writeText(text)?.catch(() => {});

function useEscape(onEscape: (() => void) | null) {
  useEffect(() => {
    if (!onEscape) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onEscape]);
}

/** The popup's frame. Without onDismiss it only closes through its footer: a secret stays until copied. */
function Frame({ label, eyebrow, title, progress, onDismiss, children, foot }: { label: string; eyebrow: string; title: string; progress?: { step: number; of: number }; onDismiss: (() => void) | null; children: ReactNode; foot: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, []);
  useEscape(onDismiss);
  return (
    <div className={cx(flow.layer, tokens.scope, tokens.u100)}>
      <button type="button" className={flow.scrim} aria-label="Dismiss" tabIndex={-1} onClick={onDismiss ?? undefined} />
      <div ref={dialog} className={flow.dialog} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {onDismiss && (
          <button type="button" className={cx(b.reset, flow.close)} onClick={onDismiss} aria-label="Close">
            <X {...ICON_100} />
          </button>
        )}
        <header className={flow.head}>
          <span className={cx(b.smallMuted, b.num)}>{eyebrow}</span>
          <h2 className={b.title}>{title}</h2>
          {progress && (
            <span className={flow.progress} aria-hidden="true">
              {Array.from({ length: progress.of }, (_, i) => (
                <i key={i} className={cx(flow.progressStep, i <= progress.step && flow.progressOn)} />
              ))}
            </span>
          )}
        </header>
        <div className={flow.body}>{children}</div>
        <footer className={flow.foot}>{foot}</footer>
      </div>
    </div>
  );
}

function Tile({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cx(flow.tile, selected && flow.tileOn)}>
      {selected && <Check {...ICON_100_SM} aria-hidden="true" className={flow.tileCheck} />}
      {children}
    </button>
  );
}

function CopyWell({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cx(b.well, k.secret)}>
      <span className={cx(flow.mono, k.secretValue)}>{value}</span>
      <button
        type="button"
        className={cx(b.btn, b.sm)}
        aria-label={label}
        onClick={() => {
          copyText(value);
          setCopied(true);
        }}
      >
        {copied ? <Check {...ICON_100_SM} aria-hidden="true" /> : <Copy {...ICON_100_SM} aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Reveal({ kind, token }: { kind: KeyKind; token: string }) {
  return (
    <div className={b.stack}>
      <CopyWell value={token} label={kind === "secret" ? "Copy secret" : "Copy key"} />
      {kind === "secret" && (
        <>
          <div className={cx(o.alert, o.alertWarn)}>
            <AlertTriangle {...ICON_100} aria-hidden="true" />
            Shown once. Store it now.
          </div>
          <div className={d.code}>
            <div className={d.codeHead}>
              <span className={b.onInk}>Send a first delivery</span>
            </div>
            <div className={cx(d.codeBody, k.codeBody)}>
              <span className={d.codeDim}>{"# POST /v1/deliver\n"}</span>
              {"curl -X POST https://api.usedopl.com/v1/deliver \\\n  -H "}
              <span className={d.codeStrong}>{`"Authorization: Bearer ${token.slice(0, token.lastIndexOf("_") + 5)}…"`}</span>
              {" \\\n  -d "}
              <span className={d.codeStrong}>{`'{"target": {"device_id": "dev_g2_77d0"},\n       "content": {"text": "Hello"}}'`}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A rotation's new secret, on its own. */
export function RevealDialog({ row, token, onDone }: { row: ApiKeyRow; token: string; onDone: () => void }) {
  return (
    <Frame
      label="Copy your new secret"
      eyebrow={`${row.name}, ${ENV_LABEL[row.env]}`}
      title="Copy your new secret"
      onDismiss={null}
      foot={
        <>
          <span className={b.grow} />
          <button type="button" className={cx(b.btn, b.ink)} onClick={onDone}>
            Done
          </button>
        </>
      }
    >
      <Reveal kind={row.kind} token={token} />
    </Frame>
  );
}

export function CreateKeyFlow({ env, initialKind, onCreate, onClose }: { env: Env; initialKind: KeyKind | null; onCreate: (input: { name: string; kind: KeyKind; scopes: string[] }) => string; onClose: () => void }) {
  const [step, setStep] = useState(initialKind ? 1 : 0);
  const [kind, setKind] = useState<KeyKind | null>(initialKind);
  const [scopes, setScopes] = useState<string[]>(["deliver"]);
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);

  if (token && kind) {
    return (
      <Frame
        key="reveal"
        label="Key created"
        eyebrow={`${name.trim()}, ${ENV_LABEL[env]}`}
        title={kind === "secret" ? "Copy your secret key" : "Copy your publishable key"}
        onDismiss={null}
        foot={
          <>
            <span className={b.grow} />
            <button type="button" className={cx(b.btn, b.ink)} onClick={onClose}>
              Done
            </button>
          </>
        }
      >
        <Reveal kind={kind} token={token} />
      </Frame>
    );
  }

  const steps = kind === "publishable" ? [STEP_TYPE, STEP_NAME] : [STEP_TYPE, STEP_SCOPES, STEP_NAME];
  const title = steps[step];
  const last = step === steps.length - 1;
  const canContinue = title === STEP_TYPE ? kind !== null : title === STEP_SCOPES ? scopes.length > 0 : name.trim() !== "";
  const create = () => {
    if (!kind || !canContinue) return;
    setToken(onCreate({ name: name.trim(), kind, scopes }));
  };
  const typeTile = (value: KeyKind, sub: string) => {
    const Glyph = KIND_GLYPH[value];
    return (
      <Tile selected={kind === value} onClick={() => setKind(value)}>
        <span className={b.tile}>
          <Glyph {...ICON_100} aria-hidden="true" />
        </span>
        <span className={b.tight}>
          <span className={b.strong}>{KIND_LABEL[value]}</span>
          <span className={b.smallMuted}>{sub}</span>
        </span>
      </Tile>
    );
  };

  return (
    <Frame
      label="Create key"
      eyebrow={`Step ${step + 1} of ${steps.length}`}
      title={title}
      progress={{ step, of: steps.length }}
      onDismiss={onClose}
      foot={
        <>
          {step > 0 && (
            <button type="button" className={cx(b.btn, b.ghost)} onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <span className={b.grow} />
          <button type="button" disabled={!canContinue} className={cx(b.btn, canContinue ? b.ink : b.off)} onClick={last ? create : () => setStep(step + 1)}>
            {last ? "Create key" : "Continue"}
          </button>
        </>
      }
    >
      {title === STEP_TYPE && (
        <div className={flow.tiles2}>
          {typeTile("secret", "Server only")}
          {typeTile("publishable", "Client code")}
        </div>
      )}
      {title === STEP_SCOPES && (
        <div className={flow.tiles2}>
          {KEY_SCOPES.map(({ id, name: scopeName }) => {
            const Glyph = SCOPE_GLYPH[id];
            const on = scopes.includes(id);
            return (
              <Tile key={id} selected={on} onClick={() => setScopes(on ? scopes.filter((s) => s !== id) : [...scopes, id])}>
                <span className={b.row}>
                  <span className={b.tile}>
                    <Glyph {...ICON_100} aria-hidden="true" />
                  </span>
                  <span className={b.tight}>
                    <span className={b.strong}>{scopeName}</span>
                    <span className={k.token}>{id}</span>
                  </span>
                </span>
              </Tile>
            );
          })}
        </div>
      )}
      {title === STEP_NAME && (
        <div className={b.stack}>
          <label className={f.field}>
            <input
              autoFocus
              className={f.fieldInput}
              aria-label="Key name"
              placeholder="Production backend"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
            />
          </label>
          <div className={cx(b.well, flow.tiles2, flow.reviewWell)}>
            <span className={b.tight}>
              <span className={b.smallMuted}>Environment</span>
              <span className={b.strong}>{ENV_LABEL[env]}</span>
            </span>
            <span className={b.tight}>
              <span className={b.smallMuted}>Type</span>
              <span className={b.strong}>{kind ? KIND_LABEL[kind] : ""}</span>
            </span>
          </div>
          <div className={c.chips}>
            {(kind === "publishable" ? ["connect"] : scopes).map((scope) => (
              <span key={scope} className={cx(b.badge, b.badgeRing)}>
                {scope}
              </span>
            ))}
          </div>
        </div>
      )}
    </Frame>
  );
}

/** A short question over the page, from the gallery's confirm dialog. Cancel holds focus. */
function Confirm({ label, mark, title, sub, children, cancel, onCancel, action }: { label: string; mark: ReactNode; title: string; sub: string; children?: ReactNode; cancel: string; onCancel: () => void; action: ReactNode }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEscape(onCancel);
  return (
    <div className={cx(flow.layer, tokens.scope, tokens.u100)}>
      <button type="button" className={flow.scrim} aria-label="Dismiss" tabIndex={-1} onClick={onCancel} />
      <div className={cx(o.dialog, k.confirm)} role="alertdialog" aria-modal="true" aria-label={label}>
        {mark}
        <div className={b.tight}>
          <span className={b.title}>{title}</span>
          <span className={b.muted}>{sub}</span>
        </div>
        {children}
        <div className={b.row}>
          <button ref={first} type="button" className={cx(b.btn, b.full)} onClick={onCancel}>
            {cancel}
          </button>
          {action}
        </div>
      </div>
    </div>
  );
}

const usage = (row: ApiKeyRow) => `${row.prefix}, ${row.lastUsedAt ? `used ${since(row.lastUsedAt).toLowerCase()}` : "never used"}, ${fmt(row.calls7d)} calls in 7d`;

export function RevokeDialog({ row, onCancel, onConfirm }: { row: ApiKeyRow; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Confirm
      label={`Revoke ${row.name}`}
      mark={
        <div className={cx(b.tile, b.tileDanger)}>
          <AlertTriangle {...ICON_100} aria-hidden="true" />
        </div>
      }
      title={`Revoke ${row.name}?`}
      sub={usage(row)}
      cancel="Cancel"
      onCancel={onCancel}
      action={
        <button type="button" className={cx(b.btn, b.full, k.dangerFlat)} onClick={onConfirm}>
          Revoke key
        </button>
      }
    >
      {inUse(row) && (
        <div className={cx(o.alert, o.alertError)}>
          <AlertTriangle {...ICON_100} aria-hidden="true" />
          In use. Its calls fail at once.
        </div>
      )}
    </Confirm>
  );
}

export function RotateDialog({ row, onCancel, onConfirm }: { row: ApiKeyRow; onCancel: () => void; onConfirm: (graceHours: number) => void }) {
  const [grace, setGrace] = useState(GRACE.length - 1);
  return (
    <Confirm
      label={`Rotate ${row.name}`}
      mark={
        <div className={b.tile}>
          <RefreshCw {...ICON_100} aria-hidden="true" />
        </div>
      }
      title={`Rotate ${row.name}?`}
      sub={usage(row)}
      cancel="Cancel"
      onCancel={onCancel}
      action={
        <button type="button" className={cx(b.btn, b.ink, b.full)} onClick={() => onConfirm(GRACE[grace].hours)}>
          Rotate key
        </button>
      }
    >
      <div className={b.stack}>
        <span className={b.strong}>Old secret stops working</span>
        <Segmented label="Old secret stops working" options={GRACE.map((g) => g.label)} value={grace} onChange={setGrace} />
      </div>
    </Confirm>
  );
}
