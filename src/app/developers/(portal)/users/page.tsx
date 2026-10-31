import { readCalls } from "@/features/device-sdk/server/portal-activity";
import { designFont } from "../_design/font";
import { loadScope, loadSnapshot } from "../_lib/portal-page";
import { UsersSection } from "../_sections/users";

export default async function Page() {
  const [{ project, env }, { users }] = await Promise.all([loadScope(), loadSnapshot()]);
  const calls = await readCalls({ projectId: project.id, env, internal: project.org.internal });
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <UsersSection users={users} calls={calls} />
    </div>
  );
}
