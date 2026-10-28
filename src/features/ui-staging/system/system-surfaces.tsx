import { Inbox } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { IdentityFace } from "@/shared/ui/identity-face";
import { LABEL_TEXT, LABEL_TEXT_MUTED, QUIET_HEADING_TEXT, IDENTITY_NAME_TEXT, SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { SECTION_TITLE } from "@/shared/ui/section-title";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { StatusPill, type StatusTone } from "@/shared/ui/status-pill";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { CHIP, FIELD_WELL, RAISED_INPUT, RAISED_WELL } from "@/shared/ui/wells";
import { SpecimenRow, Specimen, SystemSection } from "./specimen";

const PHOTO = "/img/avatars/grace-v2.jpg";
const TONES: ReadonlyArray<StatusTone> = ["neutral", "live", "attention", "done"];

export function SurfacesSection() {
  return (
    <SystemSection id="surfaces" title="Cards and wells" rule="White cards on hairlines and one soft shadow; grey only for wells inside a card.">
      <SpecimenRow>
        <Specimen name=".white-card">
          <div className="white-card h-20 w-40 p-3 text-caption text-text-secondary">Card</div>
        </Specimen>
        <Specimen name=".white-card .select-card">
          <div className="white-card select-card h-20 w-40 p-3 text-caption text-text-secondary" data-selected="true">
            Selected
          </div>
        </Specimen>
        <Specimen name=".bento">
          <div className="bento h-20 w-40 rounded-xl p-3 text-caption text-text-secondary">Bento</div>
        </Specimen>
        <Specimen name=".card-well">
          <div className="card-well h-20 w-40 p-3 text-caption text-text-secondary">Well</div>
        </Specimen>
        <Specimen name="RAISED_WELL">
          <div className={cn(RAISED_WELL, "h-20 w-40 p-3 text-caption text-text-secondary")}>Raised well</div>
        </Specimen>
        <Specimen name="FIELD_WELL">
          <input aria-label="Field well" placeholder="Concave field" className={cn(FIELD_WELL, "h-8 w-40 px-2.5 text-body")} />
        </Specimen>
        <Specimen name="RAISED_INPUT">
          <input aria-label="Raised input" placeholder="Pillow input" className={cn(RAISED_INPUT, "h-8 w-40 px-2.5")} />
        </Specimen>
        <Specimen name="CHIP">
          <span className={CHIP}>Chip</span>
        </Specimen>
      </SpecimenRow>
    </SystemSection>
  );
}

export function HeadingsSection() {
  const rows = [
    ["SECTION_HEADING_TEXT", SECTION_HEADING_TEXT],
    ["IDENTITY_NAME_TEXT", IDENTITY_NAME_TEXT],
    ["SECTION_TITLE", SECTION_TITLE],
    ["LABEL_TEXT", LABEL_TEXT],
    ["LABEL_TEXT_MUTED", LABEL_TEXT_MUTED],
    ["QUIET_HEADING_TEXT", QUIET_HEADING_TEXT],
  ] as const;
  return (
    <SystemSection id="headings" title="Headings and labels">
      <div className="flex flex-col gap-3">
        {rows.map(([name, cls]) => (
          <Specimen key={name} name={name}>
            <span className={cls}>Knowledge bases</span>
          </Specimen>
        ))}
      </div>
    </SystemSection>
  );
}

export function FacesSection() {
  return (
    <SystemSection id="faces" title="Faces, status, meters" rule="IdentityFace: 2px ring, 2px white, photo; badge is half the face.">
      <SpecimenRow label="IdentityFace">
        {(["xs", "s", "m", "l"] as const).map((size) => (
          <Specimen key={size} name={`size="${size}" ring="agent-03"`}>
            <IdentityFace size={size} photo={PHOTO} ring="agent-03" online={size === "m" || size === "l"} />
          </Specimen>
        ))}
        <Specimen name={`ring="neutral"`}>
          <IdentityFace size="m" photo={PHOTO} ring="neutral" />
        </Specimen>
        <Specimen name="no ring (a person)">
          <IdentityFace size="m" photo={PHOTO} />
        </Specimen>
        <Specimen name="initials">
          <IdentityFace size="m" name="Grace Kim" ring="agent-10" />
        </Specimen>
      </SpecimenRow>
      <SpecimenRow label="StatusPill">
        {TONES.map((tone) => (
          <Specimen key={tone} name={`tone="${tone}" dot`}>
            <StatusPill tone={tone} dot>
              {tone === "live" ? "Running" : tone}
            </StatusPill>
          </Specimen>
        ))}
        <Specimen name="StatusPill bare">
          <StatusPill tone="live" dot bare>
            Online
          </StatusPill>
        </Specimen>
      </SpecimenRow>
      <SpecimenRow label="ThinMeter">
        <Specimen name="ThinMeter" className="w-40">
          <ThinMeter used={38} limit={200} className="w-40" />
        </Specimen>
        <Specimen name="ThinMeter warnNearFull" className="w-40">
          <ThinMeter used={190} limit={200} warnNearFull className="w-40" />
        </Specimen>
      </SpecimenRow>
    </SystemSection>
  );
}

export function EmptyStatesSection() {
  return (
    <SystemSection id="empty" title="Empty states and skeletons">
      <SpecimenRow>
        <Specimen name={`EmptyState variant="well"`} className="w-56">
          <EmptyState variant="well" icon={Inbox} title="No tasks yet" className="w-56" />
        </Specimen>
        <Specimen name={`EmptyState variant="outline"`} className="w-56">
          <EmptyState variant="outline" icon={Inbox} title="No devices" className="w-56" />
        </Specimen>
        <Specimen name={`EmptyState variant="pane"`} className="w-56">
          <div className="h-28 w-56">
            <EmptyState title="Pick a chat" description="Its messages open here." />
          </div>
        </Specimen>
        <Specimen name="Skeleton / SkeletonLine" className="w-56">
          <div className="flex w-56 flex-col gap-2">
            <Skeleton className="h-8 rounded-md" />
            <SkeletonLine />
          </div>
        </Specimen>
      </SpecimenRow>
    </SystemSection>
  );
}
