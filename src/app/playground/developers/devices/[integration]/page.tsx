import { notFound } from "next/navigation";
import { integrationById } from "../../_data/catalog";
import { IntegrationPageSection } from "../../_sections/integration-page";

export default async function Page({ params, searchParams }: { params: Promise<{ integration: string }>; searchParams: Promise<{ tab?: string; model?: string }> }) {
  const { integration } = await params;
  const { tab, model } = await searchParams;
  if (!integrationById(integration)) notFound();
  return <IntegrationPageSection integrationId={integration} initialTab={tab} initialModel={model} />;
}
