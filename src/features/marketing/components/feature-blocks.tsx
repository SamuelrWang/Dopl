import {
  FEATURE_BLOCKS,
  KNOWLEDGE_PILLS,
  SKILL_PILLS,
  type FeatureBlock,
} from "../constants";
import { AdminMock } from "./mocks/admin-mock";
import { PillCascade } from "./mocks/pill-cascade";
import { WorkflowMock } from "./mocks/workflow-mock";
import { Reveal } from "./reveal";

function FeatureMock({ mock }: { mock: FeatureBlock["mock"] }) {
  switch (mock) {
    case "skills":
      return <PillCascade title="Your Skills" pills={SKILL_PILLS} />;
    case "knowledge":
      return (
        <PillCascade title="Your Knowledge" pills={KNOWLEDGE_PILLS} align="left" />
      );
    case "workflows":
      return <WorkflowMock />;
    case "admin":
      return <AdminMock />;
  }
}

/**
 * Alternating two-column feature blocks: serif headline + short body on
 * one side, an animated dark mock card on the other.
 */
export function FeatureBlocks() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-5xl space-y-28 px-6">
        {FEATURE_BLOCKS.map((block, i) => {
          const flipped = i % 2 === 1;
          return (
            <div
              key={block.id}
              className="grid items-center gap-12 lg:grid-cols-2"
            >
              <Reveal className={flipped ? "lg:order-2" : undefined}>
                <p className="text-sm font-semibold tracking-wide text-[#2f6fed] uppercase">
                  {block.eyebrow}
                </p>
                <h3 className="mt-3 font-(family-name:--font-playfair) text-3xl tracking-tight text-balance text-[#10131a] sm:text-4xl">
                  {block.title}
                </h3>
                <p className="mt-4 max-w-md text-[#5b6573]">{block.body}</p>
              </Reveal>
              <Reveal
                delay={150}
                className={flipped ? "lg:order-1" : undefined}
              >
                <FeatureMock mock={block.mock} />
              </Reveal>
            </div>
          );
        })}
      </div>
    </section>
  );
}
