import { redirect } from "next/navigation";
import type { RawSearchParams } from "@/features/device-sdk/portal/scope";

/** `/developers` opens on the request log, keeping whatever scope the URL carried. */
export default async function DevelopersIndex({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const q = new URLSearchParams();
  for (const key of ["project", "env"]) {
    const v = raw[key];
    if (typeof v === "string") q.set(key, v);
  }
  const query = q.toString();
  redirect(`/developers/logs${query ? `?${query}` : ""}`);
}
