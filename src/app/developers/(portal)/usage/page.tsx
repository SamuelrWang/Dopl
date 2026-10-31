import { MAX_ACTIVE_KEYS } from "@/features/device-sdk/server/portal-admin";
import { readKeyViews } from "@/features/device-sdk/server/portal-keys";
import { readTeam } from "@/features/device-sdk/server/portal-team";
import { designFont } from "../_design/font";
import { loadScope, loadSnapshot } from "../_lib/portal-page";
import { UsageSection } from "../_sections/usage";

export default async function Page() {
  const [{ userId, org, project, env, now }, snapshot] = await Promise.all([loadScope(), loadSnapshot()]);
  const [keys, team] = await Promise.all([readKeyViews(project.id, env, project.org.internal, snapshot.metrics, now), readTeam(userId, org, now)]);
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <UsageSection users={snapshot.users} metrics={snapshot.metrics} keys={keys} keyLimit={MAX_ACTIVE_KEYS} seats={team.members.length} endpoints={snapshot.endpoints.length} />
    </div>
  );
}
