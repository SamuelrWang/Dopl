import { readCalls } from "@/features/device-sdk/server/portal-activity";
import { isUuid } from "@/shared/lib/id/uuid";
import { loadScope, loadSnapshot } from "../_lib/portal-page";
import { ActivitySection } from "../_sections/activity";

export default async function Page({ searchParams }: { searchParams: Promise<{ call?: string; user?: string; device?: string; status?: string }> }) {
  const [params, { project, env }, { users }] = await Promise.all([searchParams, loadScope(), loadSnapshot()]);
  const scope = { projectId: project.id, env, internal: project.org.internal };
  const calls = await readCalls(scope);
  // A linked call older than the newest page still opens.
  if (params.call && isUuid(params.call) && !calls.some((c) => c.id === params.call)) calls.push(...(await readCalls({ ...scope, ids: [params.call] })));
  return <ActivitySection calls={calls} users={users} initial={params} />;
}
