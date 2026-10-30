import { AlertTriangle, Glasses, Monitor, Plus, QrCode, SearchX } from "lucide-react";
import { Section } from "../_design/components";
import { Badge, Button, Card, ICON, Meter, StatCard } from "../_design/ui";
import { AddCard, Alert, CardFoot, CardHead, CardSection, ChipRow, EmptyState, Figure, FigureWell, Mark, ReviewWell, Spark, StatRow, Text, Tile, Tiles } from "../_design/ui-page";

/** What a real page is built from: header action, stats, a section of item cards, a popup's parts. */
export function PagePartsGroup() {
  return (
    <Section label="Page parts">
      <div>
        <Button variant="ink">
          <Plus {...ICON} />
          Add device
        </Button>
      </div>
      <StatRow>
        <StatCard label="Total users" value="25" hint="8 Team, 12 Pro, 5 Free" />
        <StatCard label="Active 7d" value="25" hint="23 today" />
        <StatCard label="Devices per user" value="1.4" hint="35 devices, 23 online" />
        <StatCard label="Users with issues" value="5" hint="3 relink, 1 stale" pressed onClick={() => {}} />
      </StatRow>
      <CardSection icon={<Glasses {...ICON} />} title="Glasses" meta="24 devices">
        <Card>
          <CardHead mark={<Mark icon={Glasses} tone="ink" />} title="Field Glasses" sub={<Text kind="smallMuted">Even Realities</Text>} badges={<Badge tone="ok" dot>Live</Badge>} />
          <ChipRow>
            <Badge tone="ring">Notify</Badge>
            <Badge tone="ring">Display</Badge>
            <Badge>+2</Badge>
          </ChipRow>
          <FigureWell>
            <Figure label="Shown, 7d" value="94%">
              <Meter value={94} />
            </Figure>
            <Figure label="Users" value="22" />
            <Figure label="Online" value="16 of 24" />
          </FigureWell>
          <CardFoot main={<Spark bars={[40, 60, 45, 35, 30, 90, 75]} />}>
            <Button size="sm">Open</Button>
          </CardFoot>
        </Card>
        <AddCard title="Add new device" sub="Glasses" onClick={() => {}}>
          <Badge tone="ring">Field Glasses 02</Badge>
        </AddCard>
      </CardSection>
      <Tiles>
        <Tile selected onClick={() => {}}>
          <Mark icon={Monitor} />
          <Text kind="strong">Simulator</Text>
        </Tile>
        <Tile selected={false} onClick={() => {}}>
          <Mark icon={QrCode} />
          <Text kind="strong">Real hardware</Text>
        </Tile>
      </Tiles>
      <ReviewWell
        items={[
          ["Test device", "Simulated G2"],
          ["Tests passed", "4 of 5"],
        ]}
      />
      <Alert tone="warn" icon={AlertTriangle}>
        Shown once. Store it now.
      </Alert>
      <Button variant="dangerFlat">Revoke key</Button>
      <EmptyState icon={SearchX} title="No models match" action={<Button>Clear filters</Button>} />
    </Section>
  );
}
