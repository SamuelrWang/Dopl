import { INTEGRATIONS } from "@/features/device-sdk/portal/catalog";
import { connectStore } from "@/features/device-sdk/server/connect/store";
import { loadScope } from "../_lib/portal-page";
import { ConnectSection } from "../_sections/connect";

/** `connect/hosted.ts › PAIRING_STYLE`: what the hosted screen can pair today. The simulator is test only. */
const PAIRS = ["even_realities", "simulator"];

export default async function Page() {
  const { project, env } = await loadScope();
  const branding = (await connectStore.projectBranding(project.id)) as { display_name?: string; accent_color?: string; logo_url?: string } | null;
  const integrations = INTEGRATIONS.filter((i) => PAIRS.includes(i.id) && (!i.testOnly || env === "test"));
  return <ConnectSection branding={{ name: branding?.display_name ?? project.name, accent: branding?.accent_color ?? null, logoUrl: branding?.logo_url ?? null }} integrations={integrations} />;
}
