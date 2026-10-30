"use client";

/** The sidebar's one search box: a user id, device id, request id or webhook id takes you there. */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SearchPill } from "@/shared/ui/search-pill";
import b from "../_design/base.module.css";
import { cx } from "../_design/components";
import side from "../_design/sidebar.module.css";
import o from "../_design/surfaces.module.css";
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
    <div className={side.find} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}>
      <SearchPill value={q} onChange={setQ} label="Find anything" className="w-full" />
      {show && (
        <div className={cx(o.menu, o.popMenu, side.hits)}>
          {hits.length === 0 ? (
            <p className={cx(b.muted, side.none)}>No matches</p>
          ) : (
            hits.map((h) => (
              <button
                key={h.key}
                type="button"
                className={cx(o.item, o.itemBtn)}
                onClick={() => {
                  setOpen(false);
                  setQ("");
                  router.push(h.href);
                }}
              >
                <span className={side.navLabel}>{h.label}</span>
                <span className={o.itemEnd}>{h.kind}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
