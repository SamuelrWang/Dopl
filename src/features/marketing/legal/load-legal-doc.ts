import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { parseLegalMarkdown, type LegalDoc } from "./parse-legal-markdown";

/**
 * Reads a legal doc from `docs/legal/` at BUILD time. Both pages that call this are
 * `dynamic = "force-static"`, so the read happens once during `next build` and the HTML
 * is prerendered; `next.config.ts › outputFileTracingIncludes` also traces the two files
 * into the route bundle in case a page is ever rendered on demand.
 *
 * ⚠ The paths are LITERALS, one per doc, so the tracer can see them.
 */
const DOCS = {
  "services-agreement": () =>
    readFileSync(path.join(process.cwd(), "docs", "legal", "SERVICES-AGREEMENT.md"), "utf8"),
  privacy: () => readFileSync(path.join(process.cwd(), "docs", "legal", "PRIVACY.md"), "utf8"),
} as const;

export type LegalDocName = keyof typeof DOCS;

export function loadLegalDoc(name: LegalDocName): LegalDoc {
  return parseLegalMarkdown(DOCS[name]());
}
