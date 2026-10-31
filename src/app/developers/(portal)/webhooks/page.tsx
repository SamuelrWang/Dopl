import { readWebhookCalls } from "@/features/device-sdk/server/portal-webhooks";
import { designFont } from "../_design/font";
import { loadScope, loadSnapshot } from "../_lib/portal-page";
import { WebhooksSection } from "../_sections/webhooks";

const EVENTS = 100;

export default async function Page() {
  const [{ project, env }, { endpoints }] = await Promise.all([loadScope(), loadSnapshot()]);
  const events = await readWebhookCalls(project.id, env, EVENTS);
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <WebhooksSection endpoints={endpoints} events={events} />
    </div>
  );
}
