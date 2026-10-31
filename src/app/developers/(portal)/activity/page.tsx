import { readCalls } from "@/features/device-sdk/server/portal-activity";
import { designFont } from "../_design/font";
import { loadScope, loadSnapshot } from "../_lib/portal-page";
import { ActivitySection } from "../_sections/activity";

export default async function Page({ searchParams }: { searchParams: Promise<{ call?: string; user?: string; device?: string; status?: string }> }) {
  const [params, { project, env }, { users }] = await Promise.all([searchParams, loadScope(), loadSnapshot()]);
  const calls = await readCalls({ projectId: project.id, env, internal: project.org.internal });
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <ActivitySection calls={calls} users={users} initial={params} />
    </div>
  );
}
