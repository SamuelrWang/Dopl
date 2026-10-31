import { countActiveKeys } from "@/features/device-sdk/server/portal-keys";
import { loadScope, loadSnapshot } from "./_lib/portal-page";
import { OverviewSection } from "./_sections/overview";

export default async function Page() {
  const [{ project, env }, snapshot] = await Promise.all([loadScope(), loadSnapshot()]);
  const activeKeys = await countActiveKeys(project.id, env);
  return <OverviewSection users={snapshot.users} metrics={snapshot.metrics} endpoints={snapshot.endpoints} issues={snapshot.issues} activeKeys={activeKeys} />;
}
