import { readKeyViews } from "@/features/device-sdk/server/portal-keys";
import { designFont } from "../_design/font";
import { loadScope, loadSnapshot } from "../_lib/portal-page";
import { KeysSection } from "../_sections/keys";

export default async function Page() {
  const [{ project, env, now }, { metrics }] = await Promise.all([loadScope(), loadSnapshot()]);
  const keys = await readKeyViews(project.id, env, project.org.internal, metrics, now);
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <KeysSection keys={keys} />
    </div>
  );
}
