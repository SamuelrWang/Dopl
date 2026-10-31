import Link from "next/link";
import { EmptyState } from "@/shared/ui/empty-state";
import { pillButton } from "@/shared/ui/pill-button";
import { EMPTY_FILTERS, portalQuery, type RawSearchParams } from "@/features/device-sdk/portal/scope";
import { PortalFrame } from "../../_components/portal-frame";
import { NoProjects, PageHeader } from "../../_components/ui";
import { loadPortal } from "../../_lib/load-portal";
import { PlaygroundForm } from "./playground-form";

const PATH = "/developers/classic/playground";

/**
 * `/developers/classic/playground` — run one real `/v1` call against the selected project's TEST env with
 * the developer's own test key, and see the request, the response and the log row it wrote. The
 * call runs on the server (`/api/developers/playground`); live keys are refused there.
 */
export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { projects, params } = await loadPortal(searchParams, PATH);
  const title = "Playground";

  if (projects.length === 0) {
    return (
      <PortalFrame projects={projects} params={params} title={title}>
        <PageHeader title={title} />
        <NoProjects />
      </PortalFrame>
    );
  }

  const project = params.project === "all" ? null : projects.find((p) => p.id === params.project) ?? null;
  const toTest = `${PATH}?${portalQuery({ ...params, env: "test", filters: { ...EMPTY_FILTERS } })}`;

  return (
    <PortalFrame projects={projects} params={params} title={title}>
      <PageHeader title={title} />
      {!project ? (
        <EmptyState title="Pick a project" description="The playground runs calls against one project's test data." />
      ) : params.env !== "test" ? (
        <EmptyState title="The playground uses test data only" description="Live keys never run here. Switch to Test to try calls safely.">
          <Link href={toTest} className={pillButton("outline", "sm")}>
            Switch to Test
          </Link>
        </EmptyState>
      ) : (
        <PlaygroundForm projectId={project.id} keysHref={`/developers/classic/keys?${portalQuery({ ...params, filters: { ...EMPTY_FILTERS } })}`} />
      )}
    </PortalFrame>
  );
}
