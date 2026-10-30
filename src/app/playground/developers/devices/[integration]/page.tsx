import { notFound } from "next/navigation";
import { designFont } from "../../_design/font";
import { integrationById } from "../../_data/catalog";
import { IntegrationPageSection } from "../../_sections/integration-page";

export default async function Page({ params, searchParams }: { params: Promise<{ integration: string }>; searchParams: Promise<{ tab?: string; model?: string }> }) {
  const { integration } = await params;
  const { tab, model } = await searchParams;
  if (!integrationById(integration)) notFound();
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <IntegrationPageSection integrationId={integration} initialTab={tab} initialModel={model} />
    </div>
  );
}
