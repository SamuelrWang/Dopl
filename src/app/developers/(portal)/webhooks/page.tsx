import { readWebhookCalls } from "@/features/device-sdk/server/portal-webhooks";
import { loadScope, loadSnapshot } from "../_lib/portal-page";
import { WebhooksSection } from "../_sections/webhooks";

const EVENTS = 100;

export default async function Page() {
  const [{ project, env }, { endpoints }] = await Promise.all([loadScope(), loadSnapshot()]);
  const events = await readWebhookCalls(project.id, env, { limit: EVENTS, payloads: true });
  return <WebhooksSection endpoints={endpoints} events={events} />;
}
