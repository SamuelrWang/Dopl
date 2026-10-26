import type { Metadata } from "next";
import { StagingOntologyPage } from "@/features/ontology-staging/staging-ontology-page";

export const metadata: Metadata = { title: "Ontology · UI staging" };

/** UI staging for the desktop /home Ontology face (`src/features/ontology-staging/`). */
export default function OntologyStagingPage() {
  return <StagingOntologyPage />;
}
