"use client";

import { Section } from "../_design/components";
import { G2Screen } from "../_design/g2-screen";
import { Button, Card } from "../_design/ui";
import { CaptureOutput, ChangeOutput, HapticOutput, LensScreen, PanelScreen, ReadOutput, SpeakerOutput, Stage } from "../_design/ui-output";

/** One output per kind of capability. A device with no screen still has one. */
export function OutputsGroup() {
  return (
    <Section label="Device output">
      <Card>
        <Stage>
          <G2Screen lines={["Pump 4 at Site 12 is over pressure.", "Close valve B before restart.", "", "> Yes", "  No"]} />
        </Stage>
        <Stage>
          <LensScreen lines={["Pump 4 at Site 12 is over", "pressure. Close valve B."]}>
            <Button size="sm">Yes</Button>
            <Button size="sm">No</Button>
          </LensScreen>
        </Stage>
        <Stage>
          <PanelScreen app="Larkfield Assist" lines={["Hot work permit for Bay 9 expires in 30 minutes."]} />
        </Stage>
        <Stage>
          <SpeakerOutput text="Pump 4 at Site 12 is over pressure." />
        </Stage>
        <Stage>
          <HapticOutput pattern={[{ on: 180, off: 70 }, { on: 180, off: 70 }, { on: 180, off: 0 }]} />
        </Stage>
        <Stage>
          <ChangeOutput label="Set to" before="70°" after="72°" />
        </Stage>
        <Stage>
          <ReadOutput rows={[["Temperature", "70°"], ["Mode", "Heat"]]} />
        </Stage>
        <Stage>
          <CaptureOutput />
        </Stage>
      </Card>
    </Section>
  );
}
