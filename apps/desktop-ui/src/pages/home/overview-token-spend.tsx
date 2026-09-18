import { SectionPanel } from "@/shared/ui/section-panel";
import { Skeleton } from "@/shared/ui/skeleton";
import { useApiQuery } from "#/hooks/use-api-query";
import {
  TokenSpendStrip,
  type TokenSpendReport,
} from "#/components/overview/token-spend-strip";

/**
 * /home → Overview → **Token spend** — how many tokens this operator's agents
 * have spent, per day, over the last 31 days (Samuel, #1326: the per-agent
 * number "dies with the session", and he wants it "persistent knowledge in the
 * overview section").
 *
 * ⚠ **ITS OWN FILE AND ITS OWN READ**, beside `overview-panels.tsx` rather than
 * inside it: the Usage panel's card is the CREDITS story (bar + histogram, one
 * billing period, exact counts) and this is a different ledger with a different
 * accuracy story. Its loading state also must not gate anything above it — the
 * same argument `CreditsBar` makes for being its own component.
 *
 * ⚠ **THE STRIP AND ITS LOCAL-DAY ARITHMETIC MOVED TO
 * `#/components/overview/token-spend-strip.tsx` IN WAVE 8, UNCHANGED (R-40).**
 * The workspace Overview draws the same strip over its own container's rows.
 * What is left here is the /home HOST: the read, the fold-away, and the
 * account-wide scope that needs no label because there is nobody else on it.
 *
 * ⚠ **NO REALTIME AND NO POLL** (INVARIANTS §7), like every read on this face.
 */
export function TokenSpendPanel() {
  const spend = useApiQuery<TokenSpendReport>("/api/home/token-spend");

  // ⚠ NOTHING AT ALL UNTIL THERE IS SOMETHING TO SAY. An operator who has never
  // run an agent must not get a heading over an empty box — the exact defect the
  // first Overview attempt was rejected for ("five giant boxes with holes where
  // the empty ones were"), and the rule the Activity panel above already
  // follows by folding itself away.
  if (spend.error) return null;
  if (!spend.isPending && (spend.data?.marks?.length ?? 0) === 0) return null;

  return (
    <SectionPanel id="home-overview-token-spend" label="Token spend">
      <section className="bento flex flex-col gap-3 p-3.5">
        {spend.isPending || !spend.data ? (
          <Skeleton className="h-[104px] w-full rounded-lg" />
        ) : (
          <TokenSpendStrip report={spend.data} />
        )}
      </section>
    </SectionPanel>
  );
}

/** ⚠ RE-EXPORTED, NOT RE-IMPLEMENTED — `overview-token-spend.test.ts` pins the
 *  local-day arithmetic through this module and the rules it pins are the shared
 *  component's. */
export {
  bucketByLocalDay,
  formatTokens,
  localDayKey,
  windowDays,
} from "#/components/overview/token-spend-strip";
