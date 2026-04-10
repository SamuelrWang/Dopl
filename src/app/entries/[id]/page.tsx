"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EntryDetail } from "@/components/entries/entry-detail";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface FullEntry {
  id: string;
  title: string | null;
  summary: string | null;
  source_url: string;
  source_author: string | null;
  use_case: string | null;
  complexity: string | null;
  status: string;
  readme: string | null;
  agents_md: string | null;
  manifest: Record<string, unknown> | null;
  raw_content: Record<string, unknown> | null;
  created_at: string;
  ingested_at: string | null;
  sources: {
    source_type: string;
    url: string | null;
    raw_content: string | null;
    extracted_content: string | null;
  }[];
  tags: { tag_type: string; tag_value: string }[];
}

export default function EntryPage() {
  const params = useParams();
  const id = params.id as string;
  const [entry, setEntry] = useState<FullEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/entries/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Entry not found");
        return r.json();
      })
      .then(setEntry)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading entry...</p>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="text-center py-12">
        <p className="text-lg text-destructive">{error || "Entry not found"}</p>
        <Link href="/entries">
          <Button variant="ghost" className="mt-4">
            ← Back to entries
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/entries">
        <Button variant="ghost" size="sm" className="mb-4">
          ← Back to entries
        </Button>
      </Link>
      <EntryDetail entry={entry} />
    </div>
  );
}
