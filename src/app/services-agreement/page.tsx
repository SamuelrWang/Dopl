import { LegalPage } from "@/features/marketing/components/legal-page";
import { loadLegalDoc } from "@/features/marketing/legal/load-legal-doc";

export const metadata = {
  title: "Services Agreement — Dopl",
};

/** Read from `docs/legal/SERVICES-AGREEMENT.md` once, at build. `/terms` 308s here
 *  (`next.config.ts › redirects`). */
export const dynamic = "force-static";

export default function ServicesAgreementPage() {
  return <LegalPage doc={loadLegalDoc("services-agreement")} />;
}
