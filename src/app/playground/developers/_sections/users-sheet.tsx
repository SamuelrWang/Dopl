"use client";

/** A user over the list: identity, devices, the week, latest deliveries as metadata only. */
import { Send, Link2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import b from "../_design/base.module.css";
import { cx, ICON_100, Initials } from "../_design/components";
import { CAPABILITY_LABEL, modelById } from "../_data/catalog";
import { STATUS_LABEL as CALL_STATUS, type Call, type CallStatus } from "../_data/activity";
import { PLAN_LABEL, REGION_LABEL, STATE_LABEL, needsRelink, ownedDevice, userDeliveries, userRate, userSeen, type DeviceState, type PortalUser } from "../_data/users";
import { BASE, fmt, since } from "../_components/ui";
import { DOT, DeviceGlyph, StatusBadge } from "./users-table";
import { devicesInOrder, initialsOf, statusOf } from "./users-model";
import s from "./users.module.css";

const STATE_BADGE: Record<DeviceState, string | undefined> = { online: b.badgeOk, offline: undefined, stale: b.badgeWarn, needs_relink: b.badgeError };
const CALL_BADGE: Partial<Record<CallStatus, string>> = { seen: b.badgeOk, answered: b.badgeOk, ok: b.badgeOk, failed: b.badgeError, expired: b.badgeWarn, retrying: b.badgeWarn };
const LATEST = 5;

function capabilityOf(call: Call) {
  return call.capability ? (CAPABILITY_LABEL[call.capability] ?? call.capability) : "Delivery";
}

export function UserSheet({ user, calls, onClose, onSendTest, onRelink }: { user: PortalUser; calls: Call[]; onClose: () => void; onSendTest: () => void; onRelink: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const relink = needsRelink(user);
  const deliveries = calls.filter((c) => c.userId === user.id && c.kind === "delivery").slice(0, LATEST);
  const sent = userDeliveries(user);
  return (
    <div className={s.sheetLayer}>
      <button type="button" className={s.scrim} aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside className={s.sheet} role="dialog" aria-modal="true" aria-label={user.name}>
        <div className={s.sheetBody}>
          <header className={b.between}>
            <div className={b.row}>
              <Initials text={initialsOf(user.name)} ink />
              <div className={b.tight}>
                <h2 className={b.title}>{user.name}</h2>
                <span className={b.smallMuted}>
                  {user.id}, {PLAN_LABEL[user.plan]}, {REGION_LABEL[user.region]}
                </span>
              </div>
            </div>
            <button ref={close} type="button" className={b.reset} aria-label="Close" onClick={onClose}>
              <X {...ICON_100} className={b.iconSoft} />
            </button>
          </header>
          <div className={b.row}>
            <StatusBadge status={statusOf(user)} />
            <span className={b.smallMuted}>Last delivery {since(user.lastDeliveryAt)}</span>
          </div>

          <dl className={cx(b.well, s.figures)}>
            {[
              ["Deliveries, 7d", fmt(sent)],
              ["Seen, 7d", fmt(userSeen(user))],
              ["Success", sent ? `${userRate(user)}%` : "None"],
            ].map(([label, value]) => (
              <div key={label} className={s.figure}>
                <dt className={b.smallMuted}>{label}</dt>
                <dd className={cx(b.h3, b.num)}>{value}</dd>
              </div>
            ))}
          </dl>

          <section className={b.stack}>
            <h3 className={b.strong}>Devices</h3>
            {user.devices.length === 0 && <span className={b.faint}>None</span>}
            {devicesInOrder(user).map((d) => (
                <div key={d.id} className={cx(b.box, s.deviceRow)}>
                  <DeviceGlyph device={d} size={ICON_100} />
                  <div className={cx(b.tight, b.grow)}>
                    <span className={cx(b.strong, s.ellipsis)}>
                      {d.name}
                      {d.id === user.activeDeviceId && <span className={cx(s.stateDot, DOT.online, s.inlineDot)} />}
                    </span>
                    <span className={cx(b.smallMuted, s.ellipsis)}>
                      {modelById(d.modelId).name}, firmware {d.firmware}
                    </span>
                  </div>
                  <div className={s.deviceEnd}>
                    <span className={cx(b.badge, STATE_BADGE[d.state])}>{STATE_LABEL[d.state]}</span>
                    <span className={b.smallMuted}>{since(d.lastSeenAt)}</span>
                  </div>
                </div>
            ))}
          </section>

          <section className={b.stack}>
            <h3 className={b.strong}>Latest deliveries</h3>
            {deliveries.length === 0 && <span className={b.faint}>None</span>}
            <div>
              {deliveries.map((c, i) => (
                <div key={c.id} className={cx(s.deliveryRow, i < deliveries.length - 1 && s.deliveryLine)}>
                  <div className={cx(b.tight, b.grow)}>
                    <span className={cx(b.text, s.ellipsis)}>{capabilityOf(c)}</span>
                    <span className={cx(b.smallMuted, s.ellipsis)}>{c.deviceId ? (ownedDevice(c.deviceId)?.name ?? c.deviceId) : "No device"}</span>
                  </div>
                  <span className={cx(b.badge, CALL_BADGE[c.status])}>{CALL_STATUS[c.status]}</span>
                  <span className={cx(b.smallMuted, s.deliveryTime)}>{since(c.at)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <footer className={s.sheetFoot}>
          <button type="button" className={cx(b.btn, !relink && b.primary)} onClick={onSendTest}>
            <Send {...ICON_100} />
            Send test
          </button>
          <button type="button" className={cx(b.btn, relink && b.primary)} onClick={onRelink}>
            <Link2 {...ICON_100} />
            Relink link
          </button>
          <span className={b.grow} />
          <Link href={`${BASE}/users/${user.id}`} className={cx(b.btn, b.ghost)}>
            Open full page
          </Link>
        </footer>
      </aside>
    </div>
  );
}
