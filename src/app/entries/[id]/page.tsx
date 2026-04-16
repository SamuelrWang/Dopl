"use client";

import { useParams } from "next/navigation";
import { EntryPageClient } from "./entry-page-client";

export default function EntryPage() {
  const params = useParams();
  const id = params.id as string;
  return <EntryPageClient entryKey={id} />;
}
