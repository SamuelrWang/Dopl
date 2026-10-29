import { EmptyState } from "@/shared/ui/empty-state";
import { Bars } from "@/features/home/components/overview/overview-card";
import type { RawSearchParams } from "@/features/device-sdk/portal/scope";
import { USAGE_RANGE_LABEL, parseUsageRange, type UsagePoint } from "@/features/device-sdk/portal/usage";
import { readUsage } from "@/features/device-sdk/server/usage";
import { PortalFrame } from "../_components/portal-frame";
import { Card, Facts, NoProjects, PageHeader, ov } from "../_components/ui";
import { loadPortal } from "../_lib/load-portal";
import { UsageRangePicker } from "./range-picker";

const PATH = "/developers/usage";
const fmt = new Intl.NumberFormat("en-US");

function bars(points: UsagePoint[], pick: (p: UsagePoint) => number, unit: string) {
  return points.map((p) => ({ key: p.key, value: pick(p), label: `${p.tick}: ${fmt.format(pick(p))} ${unit}`, tick: p.tick }));
}

/**
 * `/developers/usage` — billable calls over the selected project (or all of them) and env, in UTC
 * buckets. 🔒 Reads `dev_billable_events` only (`server/usage.ts`), so an internal org's traffic is
 * never counted here, whatever the log's internal toggle says.
 */
export default async function UsagePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const { projects, params, now } = await loadPortal(Promise.resolve(raw), PATH);
  const range = parseUsageRange(raw);

  if (projects.length === 0) {
    return (
      <PortalFrame projects={projects} params={params} title="Usage">
        <PageHeader title="Usage" />
        <NoProjects />
      </PortalFrame>
    );
  }

  const inScope = params.project === "all" ? projects : projects.filter((p) => p.id === params.project);
  const usage = await readUsage({ projectIds: inScope.map((p) => p.id), env: params.env, range, now });
  const span = USAGE_RANGE_LABEL[range];
  const allInternal = inScope.every((p) => p.org.internal);

  return (
    <PortalFrame projects={projects} params={params} title="Usage">
      <PageHeader title="Usage" action={<UsageRangePicker value={range} />} />
      {allInternal ? (
        <EmptyState
          title="Internal projects are not billed"
          description="Calls from an internal org never count as usage. Their calls are in the request log."
        />
      ) : (
        <>
          <Facts
            facts={[
              ["Billable calls", fmt.format(usage.calls)],
              ["Failed", fmt.format(usage.failed)],
              ["Success rate", usage.successRate === null ? "No calls" : `${(usage.successRate * 100).toFixed(1)}%`],
              ["Range", `Last ${span}, UTC`],
            ]}
          />
          <div className="grid grid-cols-2 gap-3.5">
            <Card title="Calls" aside={<span className="text-text-muted">{span}</span>}>
              <span className={ov.figure}>{fmt.format(usage.calls)}</span>
              <Bars bars={bars(usage.points, (p) => p.calls, "calls")} label={`Billable calls, last ${span}`} />
            </Card>
            <Card title="Failed calls" aside={<span className="text-text-muted">{span}</span>}>
              <span className={ov.figure}>{fmt.format(usage.failed)}</span>
              <Bars bars={bars(usage.points, (p) => p.failed, "failed")} label={`Failed calls, last ${span}`} dim />
            </Card>
          </div>
        </>
      )}
    </PortalFrame>
  );
}
