"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { USAGE_RANGES, type UsageRange } from "@/features/device-sdk/portal/usage";

const OPTIONS = USAGE_RANGES.map((key) => ({ key, label: key }));

/** The usage range switch. A URL change, so the server re-reads for it. */
export function UsageRangePicker({ value }: { value: UsageRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <SegmentedControl
      options={OPTIONS}
      value={value}
      ariaLabel="Range"
      onChange={(range) => {
        const q = new URLSearchParams(search.toString());
        q.set("range", range);
        router.push(`${pathname}?${q.toString()}`);
      }}
    />
  );
}
