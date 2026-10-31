import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import {
  LOG_WINDOW_MS,
  logProjectIds,
  portalQuery,
  withFilters,
  type RawSearchParams,
} from "@/features/device-sdk/portal/scope";
import type { DeviceEventRow } from "@/features/device-sdk/types";
import { countBillableEvents, getPortalEvent, queryPortalEvents } from "@/features/device-sdk/server/portal";
import { PortalFrame } from "../../_components/portal-frame";
import { Card, Facts, Json, NoProjects, PageHeader, Table, ov } from "../../_components/ui";
import { loadPortal } from "../../_lib/load-portal";
import { KIND_LABEL, OUTCOME_LABEL, clock } from "../../_lib/format";
import { LogFilterBar } from "./log-filters";

const PATH = "/developers/classic/logs";

function Outcome({ row }: { row: DeviceEventRow }) {
  if (row.outcome === "ok") {
    return (
      <StatusPill tone="live" dot bare>
        {OUTCOME_LABEL.ok}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="attention" className="font-mono">
      {row.error_code ?? OUTCOME_LABEL[row.outcome]}
    </StatusPill>
  );
}

/** What the call was, in one line: capability or intent, then where it routed. */
function describe(row: DeviceEventRow): string {
  const what = row.capability ?? row.intent ?? "call";
  const where = row.route_decision?.target ?? row.device_kind;
  return where ? `${what} → ${where}` : what;
}

/**
 * `/developers/classic/logs` — `dev_events` for the selected project (or all of them) and env, newest
 * first, with filters, an internal-traffic toggle and a detail pane. The 30-day usage figure reads
 * `dev_billable_events`, so internal traffic never counts toward it.
 */
export default async function LogsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { projects, params, now } = await loadPortal(searchParams, PATH);

  if (projects.length === 0) {
    return (
      <PortalFrame projects={projects} params={params} title="Request log">
        <PageHeader title="Request log" />
        <NoProjects />
      </PortalFrame>
    );
  }

  const projectIds = logProjectIds(params, projects);
  const inScope = params.project === "all" ? projects : projects.filter((p) => p.id === params.project);
  const billableIds = inScope.map((p) => p.id);
  const [page, open, billable] = await Promise.all([
    queryPortalEvents({ projectIds, env: params.env, filters: params.filters, now }),
    params.filters.event ? getPortalEvent(params.filters.event, projectIds) : Promise.resolve(null),
    countBillableEvents({
      projectIds: billableIds,
      env: params.env,
      sinceIso: new Date(now.getTime() - LOG_WINDOW_MS["30d"]).toISOString(),
    }),
  ]);
  const href = (patch: Parameters<typeof withFilters>[1]) => `${PATH}?${portalQuery(withFilters(params, patch))}`;
  const hidingAllInternal = projectIds.length === 0 && inScope.length > 0;

  return (
    <PortalFrame projects={projects} params={params} title="Request log">
      <PageHeader
        title="Request log"
        action={<span className={ov.rowMeta}>{billable.toLocaleString()} billable calls in 30 days</span>}
      />
      <LogFilterBar params={params} showInternalToggle={inScope.some((p) => p.org.internal)} />

      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-3.5">
        <Card title="Calls" count={page.rows.length === 0 ? undefined : `${page.rows.length}${page.nextBefore ? "+" : ""}`}>
          {page.rows.length === 0 ? (
            <EmptyState
              variant="outline"
              title={hidingAllInternal ? "Internal traffic is hidden" : "No calls match"}
              description={hidingAllInternal ? "This project belongs to an internal org." : undefined}
            />
          ) : (
            <>
              <Table columns={["Call", "Device", "Outcome", { label: "API ms", num: true }, "Time"]}>
                {page.rows.map((r) => {
                  const selected = open?.event_id === r.event_id;
                  return (
                    <tr key={r.event_id} className={cn(selected && "bg-menu-item-hover-bg")}>
                      <td className="max-w-0 truncate font-mono text-small">
                        <Link
                          href={href({ event: r.event_id })}
                          scroll={false}
                          aria-current={selected ? "true" : undefined}
                          className={cn(ov.open, "whitespace-nowrap")}
                        >
                          {describe(r)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">{r.device_kind ? (KIND_LABEL[r.device_kind] ?? r.device_kind) : "None"}</td>
                      <td className="whitespace-nowrap">
                        <Outcome row={r} />
                      </td>
                      <td className={cn(ov.num, "font-mono text-small")}>{Math.round(r.latency_ms.api)}</td>
                      <td className="whitespace-nowrap font-mono text-small text-text-muted">{clock(r.ts)}</td>
                    </tr>
                  );
                })}
              </Table>
              <div className="flex justify-center gap-2">
                {params.filters.before && (
                  <Link href={href({ before: null })} className={pillButton("outline", "sm")}>
                    Newest
                  </Link>
                )}
                {page.nextBefore && (
                  <Link href={href({ before: page.nextBefore })} className={pillButton("outline", "sm")}>
                    Older
                  </Link>
                )}
              </div>
            </>
          )}
        </Card>

        {open ? (
          <Card title={describe(open)} aside={<Outcome row={open} />} className="sticky top-0">
            <span className={cn(ov.rowMeta, "font-mono")}>
              {open.event_id} · {clock(open.ts)}
            </span>
            <Facts
              facts={[
                ["Project", projects.find((p) => p.id === open.project_id)?.name ?? open.project_id],
                ["User", open.external_user_id ?? "None"],
                ["Device", open.device_id ?? "None"],
                ["Risk tier", open.risk_tier ?? "None"],
                ["Bytes in / out", `${open.bytes_in} / ${open.bytes_out}`],
                ["Cost units", String(open.cost_units)],
              ]}
            />
            <Json value={open} />
          </Card>
        ) : (
          <Card title="Details">
            <EmptyState variant="outline" title="Pick a call to see it in full" />
          </Card>
        )}
      </div>
    </PortalFrame>
  );
}
