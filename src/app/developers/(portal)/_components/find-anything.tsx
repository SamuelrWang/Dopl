"use client";

/**
 * The sidebar's one search box: a user or a device by name or id, and a pasted id goes to its call. It searches
 * only ids and names the sidebar already holds, never message text, so nothing typed here leaves the page.
 */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SearchField } from "../_design/ui";
import { SearchEmpty, SearchHit, SearchPanel } from "../_design/ui-sidebar";
import { BASE } from "./format";

export interface FindEntry {
  id: string;
  label: string;
  kind: "User" | "Device";
  href: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function search(entries: readonly FindEntry[], raw: string): FindEntry[] {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = entries.filter((e) => e.id.toLowerCase().includes(q) || e.label.toLowerCase().includes(q)).slice(0, 8);
  return hits.length === 0 && UUID.test(q) ? [{ id: q, label: q, kind: "User", href: `${BASE}/activity?call=${q}` }] : hits;
}

export function FindAnything({ entries }: { entries: readonly FindEntry[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => search(entries, q), [entries, q]);
  return (
    <SearchPanel open={open && q.trim().length >= 2} onOpenChange={setOpen} field={<SearchField value={q} placeholder="Find anything" onChange={setQ} />}>
      {hits.length === 0 ? (
        <SearchEmpty>No matches</SearchEmpty>
      ) : (
        hits.map((h) => (
          <SearchHit
            key={`${h.kind}:${h.id}`}
            label={h.label}
            kind={h.href.includes("/activity") ? "Call" : h.kind}
            onClick={() => {
              setOpen(false);
              setQ("");
              router.push(h.href);
            }}
          />
        ))
      )}
    </SearchPanel>
  );
}
