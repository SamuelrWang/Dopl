"use client";

/** The sidebar's one search box: a user id, device id, request id or webhook id takes you there. */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MenuItem } from "@/shared/ui/popover-menu";
import { SearchField } from "@/shared/ui/search-field";
import { ALL_CALLS } from "../_data/activity";
import { ALL_DEVICES, ALL_USERS } from "../_data/users";
import { BASE } from "./ui";

interface Hit {
  key: string;
  label: string;
  id: string;
  kind: string;
  href: string;
}

function search(raw: string): Hit[] {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  for (const u of ALL_USERS) {
    if (u.id.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)) {
      hits.push({ key: u.id, label: u.name, id: u.id, kind: "User", href: `${BASE}/users/${u.id}` });
    }
  }
  for (const d of ALL_DEVICES) {
    if (d.id.toLowerCase().includes(q)) {
      hits.push({ key: d.id, label: d.name, id: d.id, kind: "Device", href: `${BASE}/users/${d.userId}` });
    }
  }
  for (const c of ALL_CALLS) {
    if (c.id.toLowerCase().includes(q) || c.requestId?.toLowerCase().includes(q)) {
      const kind = c.kind === "webhook" ? "Webhook" : c.kind === "request" ? "Request" : "Delivery";
      hits.push({ key: c.id, label: c.title, id: c.id, kind, href: `${BASE}/activity?call=${c.id}` });
    }
  }
  return hits.slice(0, 8);
}

export function FindAnything() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => search(q), [q]);
  const show = open && q.trim().length >= 2;
  return (
    <div className="relative">
      <SearchField
        size="sm"
        value={q}
        onChange={setQ}
        placeholder="Find anything"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onClear={() => setQ("")}
      />
      {show && (
        <div className="white-card absolute left-0 top-full z-(--layer-menu) mt-1 flex w-90 flex-col gap-0.5 p-1.75">
          {hits.length === 0 ? (
            <p className="px-2 py-2 text-caption text-text-muted">No user, device, request or webhook matches.</p>
          ) : (
            hits.map((h) => (
              <MenuItem
                key={h.key}
                description={`${h.kind}, ${h.id}`}
                onSelect={() => {
                  setOpen(false);
                  setQ("");
                  router.push(h.href);
                }}
              >
                {h.label}
              </MenuItem>
            ))
          )}
        </div>
      )}
    </div>
  );
}

