"use client";

import { useRouter } from "next/navigation";
import type { DeviceEventRow } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { pillButton } from "@/shared/ui/pill-button";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { setLogFilter } from "../_components/portal-actions";
import { PORTAL_BASE } from "../_components/portal-shell";
import { Card, Chip, Chips, Table, ov, since } from "../_components/ui";
import { STEP_LABEL, funnel, type ConnectSessionRow } from "../_data/connect-sessions";
import { groupErrors } from "../_data/log";

const pct = (n: number) => `${n.toFixed(1)}%`;

/** Smartcar's Connect funnel: each step's count, share of sessions started, and the drop since the step before. */
export function ConnectFunnel({ sessions }: { sessions: readonly ConnectSessionRow[] }) {
  const steps = funnel(sessions);
  const first = steps[0]?.count ?? 0;
  return (
    <Card title="Connect funnel" count={first} aside={<span className="text-text-muted">sessions</span>}>
      <div className="grid grid-cols-5 gap-3">
        {steps.map((s, i) => (
          <div key={s.step} className="flex min-w-0 flex-col gap-1.5">
            <span className={ov.cellLabel}>{STEP_LABEL[s.step]}</span>
            <span className={ov.figure}>
              {s.count.toLocaleString()}
              <span className={ov.of}>{pct(s.pct)}</span>
            </span>
            <ThinMeter used={s.count} limit={Math.max(1, first)} />
            <span className={ov.rowMeta}>{i === 0 ? "—" : `−${pct(s.drop)} from previous`}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Stripe's grouped errors: one row per error code, linking to Events filtered to it. */
export function ErrorGroups({ events }: { events: readonly DeviceEventRow[] }) {
  const router = useRouter();
  const groups = groupErrors(events);
  return (
    <Card title="Errors by code" count={groups.length}>
      {groups.length === 0 ? (
        <EmptyState variant="outline" title="No errors" />
      ) : (
        <Table columns={["Code", { label: "Count", num: true }, "Capabilities", "Last seen", ""]}>
          {groups.map((g) => (
            <tr key={g.code}>
              <td className="whitespace-nowrap font-mono text-small">
                {g.code}
                <span className="ml-1.5 text-text-muted">{g.status}</span>
              </td>
              <td className={cn(ov.num, "font-mono text-small")}>{g.count}</td>
              <td>
                <Chips>
                  {g.capabilities.slice(0, 2).map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                </Chips>
              </td>
              <td className="whitespace-nowrap text-text-muted">{since(g.last_seen)}</td>
              <td className="text-right">
                <button
                  type="button"
                  className={pillButton("quiet", "xs")}
                  onClick={() => {
                    setLogFilter({ error_code: g.code });
                    router.push(`${PORTAL_BASE}/events`);
                  }}
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
