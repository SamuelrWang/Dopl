import type { DeviceKind } from "@dopl/device-contracts";
import { notFound } from "next/navigation";
import { integrationById, type Integration } from "@/features/device-sdk/portal/catalog";
import { DOPL_KIND_PROFILES } from "@/features/device-sdk/delivery/default-profiles";
import { scopeCovers } from "@/features/device-sdk/delivery/resolve-profile";
import { wiredDeviceAdapters } from "@/features/device-sdk/server/device-adapters";
import { readCalls } from "@/features/device-sdk/server/portal-activity";
import { designFont } from "../../_design/font";
import { loadScope, loadSnapshot } from "../../_lib/portal-page";
import type { RulesOfModel } from "../../_sections/integration-capabilities";
import { IntegrationPageSection } from "../../_sections/integration-page";

const KIND_OF: Record<string, DeviceKind> = { even_realities: "glasses", dopl_desktop: "desktop", google_home: "home_hub", simulator: "phone" };
const LIMIT_WORDS: [RegExp, string][] = [[/_/g, " "]];

/** The rules in force, read from the adapter and Dopl's default profile, so the page cannot disagree with delivery. */
function rulesOf(integration: Integration): RulesOfModel {
  const kind = KIND_OF[integration.id];
  const profile = DOPL_KIND_PROFILES[kind];
  const adapter = wiredDeviceAdapters.get(integration.adapterId)!;
  const descriptors = adapter.describe({ id: "", kind, vendor: "", model: "", firmware: null, adapter_id: adapter.id, adapter_version: adapter.version, capabilities: [], online: false, last_seen_at: null });
  const overflow = profile.overflow;
  return {
    profileId: profile.id,
    profileVersion: profile.version ?? 1,
    guidance: profile.prompt_append ?? "",
    format: profile.output?.format ?? null,
    maxLines: profile.output?.max_lines ?? null,
    maxChars: profile.output?.max_chars ?? null,
    overflow: overflow === "truncate" ? "Cut to fit" : overflow === "callback" ? "Returned to the caller" : overflow ? `Sent to ${overflow.send_to}` : "None",
    published: descriptors.map((d) => ({
      id: d.capability,
      allowed: (profile.allowed_capabilities ?? []).some((s) => scopeCovers(s, d.capability)),
      limits: Object.entries(d.limits ?? {}).map(([k, v]) => [LIMIT_WORDS.reduce((text, [re, to]) => text.replace(re, to), k), String(v)] as [string, string]),
    })),
  };
}

export default async function Page({ params, searchParams }: { params: Promise<{ integration: string }>; searchParams: Promise<{ tab?: string; model?: string }> }) {
  const [{ integration: id }, { tab, model }, { project, env }, { users, metrics }] = await Promise.all([params, searchParams, loadScope(), loadSnapshot()]);
  const integration = integrationById(id);
  if (!integration) notFound();
  const calls = await readCalls({ projectId: project.id, env, internal: project.org.internal });
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <IntegrationPageSection integration={integration} users={users} calls={calls} metrics={metrics} rules={rulesOf(integration)} initialTab={tab} initialModel={model} />
    </div>
  );
}
