import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocsPage } from "@/features/marketing/docs/components/docs-page";
import { DOC_PAGES, getDocPage } from "@/features/marketing/docs/content";

/** Every docs page is static content from `features/marketing/docs/content`. */
export const dynamic = "force-static";
export const dynamicParams = false;

type Params = { slug: string[] };

export function generateStaticParams(): Params[] {
  return DOC_PAGES.map((p) => ({ slug: p.slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const page = getDocPage((await params).slug.join("/"));
  return { title: page ? `${page.title} — Dopl Docs` : "Dopl Docs" };
}

export default async function DocsRoute({ params }: { params: Promise<Params> }) {
  const page = getDocPage((await params).slug.join("/"));
  if (!page) notFound();
  return <DocsPage page={page} />;
}
