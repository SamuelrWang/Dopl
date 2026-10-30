"use client";

/** One user: their physical devices, deliveries, grants, preferences and webhooks. */
import { useState } from "react";
import { CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { SECTION_TITLE } from "@/shared/ui/section-title";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StandardDialog, DialogActions } from "@/shared/ui/standard-dialog";
import { StatusPill } from "@/shared/ui/status-pill";
import { toast } from "@/shared/ui/toast";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { CallList, CallPanel, CallRow } from "../_components/calls";
import { testDelivery } from "../_components/test-delivery";
import { useCalls, usePortal, useUser } from "../_components/portal-store";
import { BASE, Card, Cell, FactChip, Id, ModelTrail, PortalPage, StatePill, Strip, TierChip, TypeMark, UserFace, fmt, ov, since } from "../_components/ui";
import { categoryOf, modelById, trail, type ModelId } from "../_data/catalog";
import { LANGUAGE_LABEL, PLAN_LABEL, REGION_LABEL, TONE_LABEL, userDeliveries, userRate, type OwnedDevice, type PortalUser, type UserPrefs } from "../_data/users";

const TABS = [
  { key: "devices", label: "Devices" },
  { key: "deliveries", label: "Deliveries" },
  { key: "grants", label: "Grants" },
  { key: "preferences", label: "Preferences" },
  { key: "webhooks", label: "Webhooks" },
];

function DeviceCard({ device, onRevoke, onRelink }: { device: OwnedDevice; onRevoke: () => void; onRelink: () => void }) {
  const category = categoryOf(device.modelId);
  const rate = device.deliveries7d ? Math.round((device.seen7d / device.deliveries7d) * 100) : 0;
  return (
    <section className={cn("white-card", ov.card)} aria-label={device.name}>
      <header className="flex items-center gap-2.5">
        <TypeMark kind={category.kind} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate text-title font-medium text-text-primary">{device.name}</span>
            <StatePill state={device.state} />
            {device.simulated && <StatusPill>Simulated</StatusPill>}
          </span>
          <ModelTrail modelId={device.modelId} />
        </span>
        <span className="flex shrink-0 gap-1.5">
          <button type="button" className={pillButton(device.state === "needs_relink" ? "ink" : "outline", "sm", { raise: false })} onClick={onRelink}>
            Relink
          </button>
          <button type="button" className={pillButton("quiet", "sm")} onClick={onRevoke}>
            Revoke
          </button>
        </span>
      </header>
      <dl className="card-well grid grid-cols-4 gap-x-4 px-3.5 py-3">
        {[
          ["Firmware", device.firmware],
          ["Last seen", since(device.lastSeenAt)],
          ["Paired", since(device.pairedAt)],
          ["Deliveries, 7 days", fmt(device.deliveries7d)],
        ].map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className={ov.cellLabel}>{k}</dt>
            <dd className="truncate text-small font-medium text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {device.grants.map((g) => (
            <FactChip key={g}>
              <span className="font-mono">{g}</span>
            </FactChip>
          ))}
        </span>
        <span className="flex w-28 shrink-0 items-center gap-2">
          <span className="text-caption font-medium tabular-nums text-text-primary">{rate}%</span>
          <ThinMeter used={rate} limit={100} className="flex-1" />
        </span>
      </div>
      <Id>{device.id}</Id>
    </section>
  );
}

function Grants({ user }: { user: PortalUser }) {
  return (
    <>
      {user.devices.map((d) => (
        <Card key={d.id} title={d.name} count={trail(d.modelId).join(" › ")}>
          <ul className={ov.rows}>
            {modelById(d.modelId).capabilities.map((c) => {
              const family = c.split(".").slice(0, -1).join(".");
              const granted = d.grants.includes(c) || d.grants.some((g) => g === `${family}.*`);
              const tier = CAPABILITY_RISK_TIER[c as CapabilityId];
              return (
                <li key={c} className={ov.row}>
                  <TierChip tier={tier} />
                  <span className={ov.rowMain}>
                    <span className="font-mono text-small text-text-primary">{c}</span>
                  </span>
                  {granted ? <StatusPill>Granted</StatusPill> : <span className="text-caption text-text-muted">Not granted</span>}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </>
  );
}

const HOURS = ["off", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "05:00", "06:00", "07:00", "08:00"];

function Preferences({ user }: { user: PortalUser }) {
  const { update } = usePortal();
  const prefs = user.prefs;
  const set = (patch: Partial<UserPrefs>) => update((s) => ({ ...s, prefs: { ...s.prefs, [user.id]: { ...prefs, ...patch } } }));
  const models = [...new Set(user.devices.map((d) => d.modelId))];
  const hourOptions = HOURS.map((h) => ({ value: h, label: h === "off" ? "Off" : h }));
  const rows: [string, React.ReactNode][] = [
    ["Tone", <SelectMenu key="tone" variant="outline" ariaLabel="Tone" value={prefs.tone} options={(Object.keys(TONE_LABEL) as UserPrefs["tone"][]).map((v) => ({ value: v, label: TONE_LABEL[v] }))} onChange={(tone) => set({ tone })} />],
    ["Language", <SelectMenu key="lang" variant="outline" ariaLabel="Language" value={prefs.language} options={(Object.keys(LANGUAGE_LABEL) as UserPrefs["language"][]).map((v) => ({ value: v, label: LANGUAGE_LABEL[v] }))} onChange={(language) => set({ language })} />],
    [
      "Quiet hours",
      <span key="quiet" className="flex items-center gap-1.5">
        <SelectMenu variant="outline" prefix="From" ariaLabel="Quiet from" value={prefs.quietFrom} options={hourOptions} onChange={(quietFrom) => set({ quietFrom })} />
        <SelectMenu variant="outline" prefix="To" ariaLabel="Quiet to" value={prefs.quietTo} options={hourOptions} onChange={(quietTo) => set({ quietTo })} />
      </span>,
    ],
    [
      "Preferred device",
      <SelectMenu
        key="pref"
        variant="outline"
        ariaLabel="Preferred device"
        value={prefs.preferred}
        options={[{ value: "auto" as const, label: "Most recently active" }, ...models.map((m) => ({ value: m, label: modelById(m).name }))]}
        onChange={(preferred) => set({ preferred })}
      />,
    ],
    [
      "Blocked devices",
      <span key="block" className="flex flex-wrap gap-1">
        {models.map((m: ModelId) => {
          const on = prefs.blocked.includes(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => set({ blocked: on ? prefs.blocked.filter((x) => x !== m) : [...prefs.blocked, m] })}
              className={pillButton(on ? "ink" : "outline", "xs", { raise: false })}
            >
              {modelById(m).name}
            </button>
          );
        })}
      </span>,
    ],
  ];
  return (
    <Card title="Preferences">
      <ul className={ov.rows}>
        {rows.map(([label, control]) => (
          <li key={label} className={ov.row}>
            <span className={ov.rowMain}>
              <span className={ov.rowTitle}>{label}</span>
            </span>
            {control}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SendTest({ user, open, onClose }: { user: PortalUser; open: boolean; onClose: () => void }) {
  const { update } = usePortal();
  const [device, setDevice] = useState(user.activeDeviceId ?? "auto");
  const send = () => {
    const target = user.devices.find((d) => d.id === device) ?? user.devices[0];
    const call = testDelivery(user, target, device === "auto" ? "Active device, seen within the online window" : "Targeted by id");
    update((s) => ({ ...s, sentCalls: [call, ...s.sentCalls] }));
    toast({ title: `Sent to ${target?.name ?? "the user"}` });
    onClose();
  };
  return (
    <StandardDialog open={open} onClose={onClose} title="Send test">
      <div className="flex items-center justify-between">
        <span className={ov.rowTitle}>Device</span>
        <SelectMenu
          variant="outline"
          ariaLabel="Device"
          value={device}
          options={[{ value: "auto", label: "Let routing choose" }, ...user.devices.map((d) => ({ value: d.id, label: d.name }))]}
          onChange={setDevice}
        />
      </div>
      <DialogActions>
        <button type="button" className={pillButton("quiet", "md")} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={pillButton("ink", "md", { raise: false })} onClick={send}>
          Send test
        </button>
      </DialogActions>
    </StandardDialog>
  );
}

export function UserPageSection({ userId, initialTab }: { userId: string; initialTab?: string }) {
  const { update } = usePortal();
  const user = useUser(userId)!;
  const calls = useCalls();
  const [tab, setTab] = useState(TABS.some((t) => t.key === initialTab) ? initialTab! : "devices");
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const mine = calls.filter((c) => c.userId === user.id);
  const deliveries = mine.filter((c) => c.kind === "delivery");
  const webhooks = mine.filter((c) => c.kind === "webhook");
  const call = openCall ? mine.find((c) => c.id === openCall) : null;
  const relinkLink = () => toast({ title: "Relink link copied", description: `https://connect.larkfield.example/r/${user.id}` });
  return (
    <PortalPage
      crumbs={[{ label: "Users", href: `${BASE}/users` }, { label: user.name }]}
      title={user.name}
      lead={<UserFace name={user.name} online={user.activeDeviceId !== null} />}
      meta={
        <>
          <Id>{user.id}</Id>
          <span>{PLAN_LABEL[user.plan]}</span>
          <span>{REGION_LABEL[user.region]}</span>
        </>
      }
      actions={
        <>
          <button type="button" className={pillButton("outline", "lg")} onClick={relinkLink}>
            Relink link
          </button>
          <button type="button" className={pillButton("ink", "lg", { raise: false })} onClick={() => setTesting(true)}>
            Send test
          </button>
        </>
      }
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      aside={(tab === "deliveries" || tab === "webhooks") && call ? <CallPanel call={call} onClose={() => setOpenCall(null)} /> : undefined}
    >
      {tab === "devices" && (
        <>
          <Strip label="Summary">
            <Cell label="Devices" value={fmt(user.devices.length)} of={`${user.devices.filter((d) => d.state === "online").length} online`} />
            <Cell label="Deliveries, 7 days" value={fmt(userDeliveries(user))} />
            <Cell label="Success rate" value={`${userRate(user)}%`} />
            <Cell label="Last delivery" value={since(user.lastDeliveryAt)} />
          </Strip>
          {user.devices.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              onRelink={() => {
                update((s) => ({ ...s, deviceStates: { ...s.deviceStates, [d.id]: "online" } }));
                toast({ title: `Relink sent for ${d.name}` });
              }}
              onRevoke={() => {
                update((s) => ({ ...s, revoked: [...s.revoked, d.id] }));
                toast({ title: `Revoked ${d.name}` });
              }}
            />
          ))}
          {user.devices.length === 0 && <p className={SECTION_TITLE}>No devices connected</p>}
        </>
      )}
      {tab === "deliveries" && <CallList calls={deliveries} selected={openCall} onOpen={setOpenCall} showUser={false} />}
      {tab === "grants" && <Grants user={user} />}
      {tab === "preferences" && <Preferences user={user} />}
      {tab === "webhooks" && (
        <Card title="Webhooks about this user" count={webhooks.length}>
          {webhooks.length === 0 ? (
            <p className={ov.note}>None yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col">
              {webhooks.map((c) => (
                <CallRow key={c.id} call={c} selected={c.id === openCall} showUser={false} onOpen={() => setOpenCall(c.id)} />
              ))}
            </ul>
          )}
        </Card>
      )}
      <SendTest user={user} open={testing} onClose={() => setTesting(false)} />
    </PortalPage>
  );
}
