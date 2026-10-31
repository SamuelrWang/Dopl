import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusPill } from "@/shared/ui/status-pill";
import { EMPTY_FILTERS, portalQuery, type PortalParams, type RawSearchParams } from "@/features/device-sdk/portal/scope";
import type { WebhookDelivery, WebhookEndpoint } from "@/features/device-sdk/types";
import { listPortalWebhookDeliveries, listPortalWebhookEndpoints } from "@/features/device-sdk/server/portal-webhooks";
import { PortalFrame } from "../../_components/portal-frame";
import { Card, Facts, NoProjects, PageHeader, Table, ov } from "../../_components/ui";
import { loadPortal } from "../../_lib/load-portal";
import { clock, since } from "../../_lib/format";

const PATH = "/developers/classic/webhooks";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How much of a response body the attempts table shows. */
const BODY_PREVIEW = 120;

function idParam(raw: RawSearchParams, key: string): string | null {
  const v = raw[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && UUID.test(s) ? s.toLowerCase() : null;
}

function href(params: PortalParams, endpoint: string | null, delivery: string | null = null): string {
  const q = new URLSearchParams(portalQuery({ ...params, filters: { ...EMPTY_FILTERS } }));
  if (endpoint) q.set("endpoint", endpoint);
  if (delivery) q.set("delivery", delivery);
  return `${PATH}?${q.toString()}`;
}

function EndpointStatus({ endpoint }: { endpoint: WebhookEndpoint }) {
  return endpoint.status === "enabled" ? (
    <StatusPill tone="live" dot bare>
      Enabled
    </StatusPill>
  ) : (
    <StatusPill tone="ended">Disabled</StatusPill>
  );
}

function DeliveryStatus({ delivery }: { delivery: WebhookDelivery }) {
  if (delivery.status === "delivered") {
    return (
      <StatusPill tone="live" dot bare>
        Delivered
      </StatusPill>
    );
  }
  if (delivery.status === "failed") return <StatusPill tone="attention">Failed</StatusPill>;
  return <StatusPill>Pending</StatusPill>;
}

const events = (e: WebhookEndpoint) => (e.enabled_events ? e.enabled_events.join(", ") : "All events");
const preview = (body: string | null) =>
  body === null || body === "" ? "None" : body.length > BODY_PREVIEW ? `${body.slice(0, BODY_PREVIEW)}…` : body;

/**
 * `/developers/classic/webhooks` — read only. The selected project's endpoints for one env; pick one
 * (`?endpoint=`) to see its newest deliveries, and a delivery (`?delivery=`) to see its HTTP
 * attempts. Creating, rotating and replaying stay in the public API. No secret is ever read.
 */
export default async function WebhooksPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const { projects, params, now } = await loadPortal(Promise.resolve(raw), PATH);
  const project = projects.find((p) => p.id === params.project) ?? null;

  let body;
  if (projects.length === 0) {
    body = <NoProjects />;
  } else if (!project) {
    body = (
      <EmptyState variant="outline" title="Pick a project" description="Webhooks belong to one project. Choose it on the left." />
    );
  } else {
    const endpoints = await listPortalWebhookEndpoints(project.id, params.env);
    // Only an endpoint of this project and env can be opened; otherwise the newest one opens.
    const wanted = idParam(raw, "endpoint");
    const open = endpoints.find((e) => e.id === wanted) ?? endpoints[0] ?? null;
    const deliveries = open ? await listPortalWebhookDeliveries(open.id, project.id, params.env) : [];
    const wantedDelivery = idParam(raw, "delivery");
    const openDelivery = deliveries.find((d) => d.id === wantedDelivery) ?? null;

    body =
      endpoints.length === 0 ? (
        <EmptyState
          variant="outline"
          title="No webhook endpoints"
          description={`This project has no ${params.env} endpoints. Add one with the API.`}
        />
      ) : (
        <>
          <Card title="Endpoints" count={endpoints.length}>
            <Table columns={["URL", "Status", "Events", "Created"]}>
              {endpoints.map((e) => {
                const selected = open?.id === e.id;
                return (
                  <tr key={e.id} className={cn(selected && "bg-menu-item-hover-bg")}>
                    <td className="max-w-0 truncate font-mono text-small">
                      <Link
                        href={href(params, e.id)}
                        scroll={false}
                        aria-current={selected ? "true" : undefined}
                        className={cn(ov.open, "whitespace-nowrap")}
                        title={e.url}
                      >
                        {e.url}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <EndpointStatus endpoint={e} />
                    </td>
                    <td className="max-w-0 truncate font-mono text-small" title={events(e)}>
                      {events(e)}
                    </td>
                    <td className="whitespace-nowrap font-mono text-small text-text-muted">{since(e.created_at, now)}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>

          {open && (
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-3.5">
              <Card title="Deliveries" count={deliveries.length === 0 ? undefined : deliveries.length}>
                {deliveries.length === 0 ? (
                  <EmptyState variant="outline" title="No deliveries yet" />
                ) : (
                  <Table
                    columns={["Event", "Status", { label: "Tries", num: true }, "Last code", "Next try", "Created"]}
                  >
                    {deliveries.map((d) => {
                      const selected = openDelivery?.id === d.id;
                      return (
                        <tr key={d.id} className={cn(selected && "bg-menu-item-hover-bg")}>
                          <td className="max-w-0 truncate font-mono text-small">
                            <Link
                              href={href(params, open.id, d.id)}
                              scroll={false}
                              aria-current={selected ? "true" : undefined}
                              className={cn(ov.open, "whitespace-nowrap")}
                            >
                              {d.event_type}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap">
                            <DeliveryStatus delivery={d} />
                          </td>
                          <td className={cn(ov.num, "font-mono text-small")}>{d.attempt_count}</td>
                          <td className="whitespace-nowrap font-mono text-small">{d.last_status_code ?? "None"}</td>
                          <td className="whitespace-nowrap font-mono text-small text-text-muted">
                            {d.next_attempt_at ? since(d.next_attempt_at, now) : "None"}
                          </td>
                          <td className="whitespace-nowrap font-mono text-small text-text-muted">{clock(d.created_at)}</td>
                        </tr>
                      );
                    })}
                  </Table>
                )}
              </Card>

              {openDelivery ? (
                <Card title={openDelivery.event_type} aside={<DeliveryStatus delivery={openDelivery} />} className="sticky top-0">
                  <span className={cn(ov.rowMeta, "font-mono")}>
                    {openDelivery.message_id} · {clock(openDelivery.created_at)}
                  </span>
                  <Facts
                    facts={[
                      ["Event id", openDelivery.event_id],
                      ["Tries", String(openDelivery.attempt_count)],
                      ["Delivered", openDelivery.delivered_at ? clock(openDelivery.delivered_at) : "No"],
                      ["Last error", openDelivery.last_error ?? "None"],
                    ]}
                  />
                  {openDelivery.status === "failed" && (
                    <span className={ov.rowMeta}>Gave up after {openDelivery.attempt_count} tries.</span>
                  )}
                  {openDelivery.attempts && openDelivery.attempts.length > 0 ? (
                    <Table columns={[{ label: "#", num: true }, "Time", "Result", { label: "ms", num: true }, "Response"]}>
                      {openDelivery.attempts.map((a) => (
                        <tr key={a.attempt}>
                          <td className={cn(ov.num, "font-mono text-small")}>{a.attempt}</td>
                          <td className="whitespace-nowrap font-mono text-small text-text-muted">{clock(a.attempted_at)}</td>
                          <td className="max-w-0 truncate font-mono text-small" title={a.error ?? undefined}>
                            {a.status_code ?? a.error ?? "None"}
                          </td>
                          <td className={cn(ov.num, "font-mono text-small")}>{a.duration_ms}</td>
                          <td className="max-w-0 truncate font-mono text-small text-text-muted" title={a.response_body ?? undefined}>
                            {preview(a.response_body)}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  ) : (
                    <EmptyState variant="outline" title="No tries yet" />
                  )}
                </Card>
              ) : (
                <Card title="Tries">
                  <EmptyState variant="outline" title="Pick a delivery to see its tries" />
                </Card>
              )}
            </div>
          )}
        </>
      );
  }

  return (
    <PortalFrame projects={projects} params={params} title="Webhooks">
      <PageHeader title="Webhooks" />
      {body}
    </PortalFrame>
  );
}
