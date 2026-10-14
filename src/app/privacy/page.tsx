import { LegalPage } from "@/features/marketing/components/legal-page";
import { loadLegalDoc } from "@/features/marketing/legal/load-legal-doc";

export const metadata = {
  title: "Privacy Policy — Dopl",
};

/** Read from `docs/legal/PRIVACY.md` once, at build. */
export const dynamic = "force-static";

export default function PrivacyPage() {
  return <LegalPage doc={loadLegalDoc("privacy")} />;
}
