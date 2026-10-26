// STAGING ONLY — Overview Version D, the Activity log: the landing's Monitoring log, on the
// devices feed. Routing and Logs were two feeds of the same events; here they are one.
"use client";

import { useState } from "react";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { DEVICES_MOCK } from "@/features/overview-staging/overview-mock-data";
import { Pill } from "./overview-d-bits";

/** Rows on screen. History is not the overview. */
const ROWS = 4;

export function ActivityLog({
  devices,
}: {
  /** id → { name, kind } for every device, including removed ones. */
  devices: Map<string, { name: string; kind: string }>;
}) {
  const [who, setWho] = useState<string | null>(null);
  const logs = DEVICES_MOCK.logs;
  // One chip per device that appears in the log, in first-seen order.
  const chips = [...new Set(logs.map((l) => l.deviceId))];
  const rows = logs.filter((l) => who === null || l.deviceId === who).slice(0, ROWS);
  const ref = (id: string) => devices.get(id) ?? { name: "Removed device", kind: "other" };

  return (
    <section className="ovd-card ovd-activity" aria-label="Activity">
      <header className="ovd-card-head">
        <h3 className="ovd-card-title">Activity</h3>
        <span className="ovd-live ovd-card-end">
          <i aria-hidden />
          Live
        </span>
      </header>

      <div className="ovd-chips-row" role="tablist" aria-label="Filter by device">
        <button
          type="button"
          role="tab"
          aria-selected={who === null}
          className="ovd-filter"
          onClick={() => setWho(null)}
        >
          All
        </button>
        {chips.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={who === id}
            className="ovd-filter"
            onClick={() => setWho(id)}
          >
            {ref(id).name}
          </button>
        ))}
      </div>

      <ul className="ovd-log">
        {rows.map((l) => {
          const d = ref(l.deviceId);
          return (
            <li key={l.id} className="ovd-log-row">
              <DeviceGlyph kind={d.kind} />
              <div className="ovd-log-body">
                <p className="ovd-log-name">
                  {d.name}
                  <span className="ovd-log-time">{l.at.slice(0, 5)}</span>
                </p>
                <p className="ovd-log-did">
                  {l.event}
                  <span className="ovd-log-where"> · {l.detail}</span>
                </p>
              </div>
              {l.level === "error" && <Pill>Error</Pill>}
              {l.level === "warn" && <Pill>Warning</Pill>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
