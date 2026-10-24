"use client";

import type { ReactNode } from "react";
import { Bot, Car, Check, Glasses, Laptop, Plus, Smartphone, type LucideIcon } from "lucide-react";
import { at } from "./multiplayer-visuals";
import { SDK_COPY, type DeviceStatus, type SdkTok } from "./sdk-content";
import { useVisualPlay } from "./use-visual-play";

/**
 * Mini UIs for the three Developer cards: capability manifests → the endpoint
 * resolver → a white-label pairing sheet. Same recipe as the identity cards
 * (./multiplayer-visuals.tsx): a `.lp-mp-panel` window in the card's grey
 * area, decorative (`aria-hidden`), motion CSS only. Elements carry their
 * start time as `--d` via `at()`; ./use-visual-play.ts arms the root and flips
 * it to `in` on screen, the sequence plays once and HOLDS. The base rules are
 * the final frame, so SSR and reduced motion render it static.
 * Section-specific motion lives in ../sdk.css; the shared `.lp-mp-rise /
 * -fade / -pop / -grow / -toggle` come from marketing.css.
 */

const ICONS: Record<string, LucideIcon> = {
  glasses: Glasses,
  arm: Bot,
  car: Car,
  phone: Smartphone,
  laptop: Laptop,
};

function DeviceIcon({ name }: { name: string }) {
  const Icon = ICONS[name] ?? Plus;
  return (
    <span className="lp-mp-glyph lp-sdk-glyph">
      <Icon size={11} strokeWidth={2} />
    </span>
  );
}

/** The card's one-line SDK call, pinned to the top of its window. */
function CallLine({ tokens }: { tokens: readonly SdkTok[] }) {
  return (
    <code className="lp-sdk-call">
      {tokens.map(([kind, text], i) => (
        <span key={i} className={kind ? `lp-sdk-${kind}` : undefined}>
          {text}
        </span>
      ))}
    </code>
  );
}

/** Dot + word: active / online / offline. */
function Status({ status }: { status: DeviceStatus }) {
  return (
    <span className="lp-sdk-state" data-status={status}>
      <i />
      {SDK_COPY.status[status]}
    </span>
  );
}

/** An endpoint ID, styled like an SDK return value. */
function EndpointId({ id }: { id: string }) {
  return <span className="lp-sdk-id">{id}</span>;
}

function Window({ children, bare, call }: { children: ReactNode; bare?: boolean; call?: readonly SdkTok[] }) {
  const ref = useVisualPlay<HTMLDivElement>();
  return (
    <div className="lp-mp-panel" aria-hidden="true" ref={ref}>
      {!bare && (
        <div className="lp-mp-chrome">
          <span />
          <span />
          <span />
        </div>
      )}
      <div className="lp-mp-panel-body lp-sdk-body">
        {call && <CallLine tokens={call} />}
        {children}
      </div>
    </div>
  );
}

// ── Card 1: capability manifests ─────────────────────────────────────────

const T1 = { first: 250, step: 600, line: 180, lineStep: 140 } as const;

export function CapabilitiesVisual() {
  const c = SDK_COPY.capabilities;
  const moreAt = T1.first + c.devices.length * T1.step;
  return (
    <Window call={c.call}>
      {c.devices.map((device, i) => {
        const t = T1.first + i * T1.step;
        return (
          <div key={device.name} className="lp-sdk-manifest lp-mp-rise" style={at(t)}>
            <span className="lp-sdk-manifest-head">
              <DeviceIcon name={device.icon} />
              {device.name}
              <EndpointId id={device.id} />
              <Status status={device.status} />
            </span>
            {device.manifest.map(([key, value], j) => (
              <span key={key} className="lp-sdk-kv lp-mp-rise" style={at(t + T1.line + j * T1.lineStep)}>
                <span className="lp-sdk-key">{key}:</span> {value}
              </span>
            ))}
          </div>
        );
      })}
      <div className="lp-sdk-more lp-mp-rise" style={at(moreAt)}>
        <Plus size={11} strokeWidth={2} />
        {c.more}
        <span className="lp-sdk-key">{c.moreHint}</span>
      </div>
    </Window>
  );
}

// ── Card 2: the endpoint resolver ────────────────────────────────────────

/** Presence leaves device A at `move`, lands on device B a beat later. */
const T2 = { req: 200, land: 900, answer: 1900, move: 2800, req2: 3200, land2: 3900 } as const;

export function RoutingVisual() {
  const c = SDK_COPY.routing;
  const [first, second] = c.landings;
  const landAt = [T2.land, T2.land2];

  /** Presence leaves the first landing's device and arrives on the second's. */
  function presence(i: number) {
    const pill = (
      <span className="lp-sdk-presence">
        <i />
        {c.presenceLabel}
      </span>
    );
    if (i === first.device)
      return <span className="lp-sdk-was lp-sdk-presence-slot" style={at(T2.move)}>{pill}</span>;
    if (i === second.device)
      return <span className="lp-mp-fade lp-sdk-presence-slot" style={at(T2.move + 100)}>{pill}</span>;
    return null;
  }

  return (
    <Window>
      <div className="lp-sdk-reqs">
        <code className="lp-sdk-req lp-mp-rise" style={at(T2.req)}>{c.requests[0]}</code>
        <code className="lp-sdk-req lp-mp-rise" style={at(T2.req2)}>{c.requests[1]}</code>
      </div>
      <div className="lp-sdk-devices">
        {c.devices.map((device, i) => {
          const n = c.landings.findIndex((l) => l.device === i);
          const landing = n === -1 ? null : c.landings[n];
          return (
            <div key={device.name} className="lp-sdk-device">
              <span className="lp-sdk-device-row" data-status={device.status}>
                <DeviceIcon name={device.icon} />
                <span className="lp-sdk-device-text">
                  <span className="lp-sdk-device-name">{device.name}</span>
                  <EndpointId id={device.id} />
                </span>
                {presence(i)}
                <Status status={device.status} />
              </span>
              {landing && (
                <div className="lp-mp-grow" style={at(landAt[n])}>
                  <div>
                    <div className="lp-sdk-land">
                      <span className="lp-sdk-land-prompt">
                        {landing.prompt}
                        {"answer" in landing && (
                          <span className="lp-sdk-answer lp-mp-pop" style={at(T2.answer)}>
                            <Check size={10} strokeWidth={3} />
                            {landing.answer}
                          </span>
                        )}
                      </span>
                      <span className="lp-sdk-tags">
                        {landing.reasons.map((r) => (
                          <span key={r} className="lp-sdk-tag-reason">{r}</span>
                        ))}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Window>
  );
}

// ── Card 3: the white-label pairing sheet ────────────────────────────────

const T3 = { head: 0, sheet: 300, row: 600, rowStep: 200, toggle: 1200, toggleStep: 250, perms: 1900, activity: 3000 } as const;

function ToggleRow({ name, on, rise, flip }: { name: string; on: boolean; rise: number; flip: number }) {
  return (
    <span className="lp-mp-row lp-mp-rise" style={at(rise)}>
      {name}
      <span className={on ? "lp-mp-toggle" : "lp-mp-toggle lp-sdk-off"} style={on ? at(flip) : undefined}>
        <i />
      </span>
    </span>
  );
}

export function EmbeddedVisual() {
  const c = SDK_COPY.embedded;
  const permRow = T3.perms + 150;
  return (
    <Window bare call={c.call}>
      <div className="lp-sdk-app-head lp-mp-rise" style={at(T3.head)}>
        <span className="lp-sdk-brand-mark">{c.brandMark}</span>
        <span className="lp-sdk-brand">{c.brand}</span>
        <span className="lp-sdk-nav">{c.nav}</span>
      </div>
      <span className="lp-sdk-sheet-title lp-mp-rise" style={at(T3.sheet)}>
        {c.sheetTitle}
      </span>
      <div className="lp-mp-field lp-mp-field--stack">
        <span className="lp-mp-label lp-mp-rise" style={at(T3.row - 150)}>
          {c.devicesLabel}
        </span>
        {c.devices.map((d, i) => (
          <ToggleRow
            key={d.name}
            name={d.name}
            on={d.on}
            rise={T3.row + i * T3.rowStep}
            flip={T3.toggle + i * T3.toggleStep}
          />
        ))}
      </div>
      <div className="lp-mp-field lp-mp-field--stack">
        <span className="lp-mp-label lp-mp-rise" style={at(T3.perms)}>
          {c.permsLabel}
        </span>
        {c.perms.map((p, i) => (
          <ToggleRow
            key={p.name}
            name={p.name}
            on={p.on}
            rise={permRow + i * T3.rowStep}
            flip={permRow + 500 + i * T3.toggleStep}
          />
        ))}
      </div>
      <span className="lp-sdk-activity lp-mp-rise" style={at(T3.activity)}>
        <i />
        {c.activity}
      </span>
    </Window>
  );
}
