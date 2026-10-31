import { readKeyViews } from "@/features/device-sdk/server/portal-keys";
import { designFont } from "./_design/font";
import { loadScope, loadSnapshot } from "./_lib/portal-page";
import { OverviewSection } from "./_sections/overview";

export default async function Page() {
  const [{ project, env, now }, snapshot] = await Promise.all([loadScope(), loadSnapshot()]);
  const keys = await readKeyViews(project.id, env, project.org.internal, snapshot.metrics, now);
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <OverviewSection users={snapshot.users} metrics={snapshot.metrics} endpoints={snapshot.endpoints} issues={snapshot.issues} activeKeys={keys.filter((k) => !k.revokedAt).length} />
    </div>
  );
}
