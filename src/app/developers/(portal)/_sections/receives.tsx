"use client";

/** What a device receives: the rules in force and the hardware's limits. Read only until rules can be published. */
import { Card, TwoLine } from "../_design/ui";
import { CodeBlock, ListRow, ReviewWell, Stack, Text } from "../_design/ui-page";
import type { RulesOfModel } from "./integration-capabilities";

export function ReceivesTab({ rules }: { rules: RulesOfModel }) {
  const limited = rules.published.filter((c) => c.limits.length > 0);
  return (
    <>
      <Card label="Rules in force">
        <TwoLine title={<Text kind="h3">Rules in force</Text>} sub={`${rules.profileId} v${rules.profileVersion}`} />
        <ReviewWell
          items={[
            ["Max lines", rules.maxLines ?? "None"],
            ["Max characters", rules.maxChars ?? "None"],
            ["Format", rules.format ?? "None"],
            ["Over the limit", rules.overflow],
          ]}
        />
        <CodeBlock title="Agent instructions">{rules.guidance}</CodeBlock>
      </Card>
      {limited.length > 0 && (
        <Card label="Hardware limits">
          <Text kind="h3">Hardware limits</Text>
          {limited.map((c) => (
            <Stack key={c.id}>
              <Text kind="mono">{c.id}</Text>
              <div>
                {c.limits.map(([k, v], i) => (
                  <ListRow key={k} line={i < c.limits.length - 1}>
                    <Text clip>{k}</Text>
                    <Text num>{v}</Text>
                  </ListRow>
                ))}
              </div>
            </Stack>
          ))}
        </Card>
      )}
    </>
  );
}
