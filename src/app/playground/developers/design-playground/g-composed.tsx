import { AlertCircle, Battery, Bell, Check, ChevronRight, Download, FileText, Globe, Glasses, Lock, MessageCircle, MoreHorizontal, Plus, Trash2, Upload, Wifi } from "lucide-react";
import { Badge, Button, Chip } from "../_design/ui";
import b from "../_design/base.module.css";
import d from "../_design/data.module.css";
import f from "../_design/forms.module.css";
import o from "../_design/surfaces.module.css";
import { Switch } from "../_design/interactive";
import { Card, Face, Initials, Section, cx, ICON, ICON_SM, U, u } from "../_design/components";

const FEATURES = ["Unlimited collections", "20 GB of audio storage", "Version history", "Priority review"];
const FUNCTIONS = ["Camera", "Microphone", "Display", "Translate", "Navigate"];

function Pricing() {
  return (
    <Card className={b.spread}>
      <div className={b.between}>
        <span className={b.h3}>Curator</span>
        <Badge tone="ink">Most popular</Badge>
      </div>
      <div className={d.price}>
        <span className={b.big}>$12</span>
        <span className={b.muted}>per seat / month</span>
      </div>
      <div className={b.line} />
      <div className={b.stack}>
        {FEATURES.map((x) => (
          <div key={x} className={d.featureRow}>
            <Check {...ICON} className={b.iconInk} />
            {x}
          </div>
        ))}
      </div>
      <span className={cx(b.btn, b.primary, b.noGrowFull)}>Start Free Trial</span>
    </Card>
  );
}

function Profile() {
  return (
    <Card className={b.flush}>
      <div className={d.profileHead}>
        <div className={d.profileFace}>
          <Face who="agus" clip />
        </div>
      </div>
      <div className={d.profileBody}>
        <div className={b.between}>
          <div className={b.tight}>
            <span className={b.title}>Agus lagi sedih</span>
            <span className={b.muted}>Graphic Designer, Yogyakarta</span>
          </div>
          <Button size="sm">Follow</Button>
        </div>
        <div className={d.statTriple}>
          {[["128", "Entries"], ["2.4k", "Followers"], ["36", "Following"]].map(([n, l]) => (
            <div key={l} className={d.statCell}>
              <span className={b.h3}>{n}</span>
              <span className={b.smallMuted}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Notifications() {
  return (
    <Card>
      <div className={b.between}>
        <div className={b.row}>
          <Bell {...ICON} className={b.iconInk} />
          <span className={b.h3}>Notifications</span>
          <Badge tone="ink">3</Badge>
        </div>
        <Button variant="ghost" size="sm">Mark all read</Button>
      </div>
      <div>
        <div className={cx(d.listRow, d.rowLine)}>
          <Face who="ada" />
          <div className={cx(b.tight, b.grow)}>
            <span className={b.text}>
              <b className={b.strong}>Ada Komeng</b> commented on Parang Rusak
            </span>
            <span className={b.smallMuted}>5 min ago</span>
          </div>
          <span className={d.unread} />
        </div>
        <div className={cx(d.listRow, d.rowLine)}>
          <Face who="terus" />
          <div className={cx(b.tight, b.grow)}>
            <span className={b.text}>
              <b className={b.strong}>Terus Adul</b> approved your entry
            </span>
            <span className={b.smallMuted}>1h ago</span>
          </div>
          <span className={d.unread} />
        </div>
        <div className={d.listRow}>
          <span className={b.tile}>
            <AlertCircle {...ICON} />
          </span>
          <div className={cx(b.tight, b.grow)}>
            <span className={b.text}>Storage is almost full</span>
            <span className={b.smallMuted}>Yesterday</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Files() {
  return (
    <Card>
      <div className={b.between}>
        <span className={b.h3}>Files</span>
        <Button size="sm">
          <Upload {...ICON} />
          Upload
        </Button>
      </div>
      <div className={b.stack}>
        {[["Agenda October.pdf", "2.4 MB", Download], ["Interview transcript.doc", "860 KB", Download], ["Sekaten field notes.pdf", "12.8 MB", Trash2]].map(([name, size, Icon]) => {
          const I = Icon as typeof Download;
          return (
            <div key={name as string} className={cx(b.box, d.fileRow)}>
              <FileText {...ICON} className={b.iconSoft} />
              <span className={cx(b.strong, b.grow)}>{name as string}</span>
              <span className={b.smallMuted}>{size as string}</span>
              <I {...ICON} className={b.iconSoft} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Invite() {
  return (
    <Card>
      <div className={b.tight}>
        <span className={b.title}>Invite Your Team</span>
        <span className={b.muted}>3 of 10 seats used</span>
      </div>
      <div className={f.tags}>
        <span className={f.tag}>
          <Initials text="NS" small />
          nia@jawa.id
        </span>
        <span className={f.tag}>
          <Initials text="BW" small />
          budi@jawa.id
        </span>
        <span className={f.placeholder}>Add email</span>
      </div>
      <div className={b.row}>
        <Chip on>Editor</Chip>
        <Chip>Viewer</Chip>
        <Chip>Admin</Chip>
      </div>
      <div className={b.row}>
        <Button full>Copy Link</Button>
        <Button variant="primary" full>Send 2 Invites</Button>
      </div>
    </Card>
  );
}

function SettingsRows() {
  return (
    <Card className={b.flush}>
      {[
        { icon: Bell, label: "Push notifications", value: "All activity", toggle: true },
        { icon: Globe, label: "Language", value: "Bahasa Indonesia" },
        { icon: Lock, label: "Two-factor login", value: "Authenticator app", toggle: true },
      ].map(({ icon: Icon, label, value, toggle }, i, all) => (
        <div key={label} className={cx(b.between, b.padRow, i < all.length - 1 && d.rowLine)}>
          <div className={b.row}>
            <span className={b.tile}>
              <Icon {...ICON} />
            </span>
            <div className={b.tight}>
              <span className={b.strong}>{label}</span>
              <span className={b.smallMuted}>{value}</span>
            </div>
          </div>
          {toggle ? <Switch on label={label} /> : <ChevronRight {...ICON} className={b.iconSoft} />}
        </div>
      ))}
    </Card>
  );
}

function Comments() {
  return (
    <Card>
      <div className={b.row}>
        <MessageCircle {...ICON} className={b.iconInk} />
        <span className={b.h3}>Comments</span>
        <Badge>3</Badge>
      </div>
      <div className={d.comment}>
        <Face who="ada" />
        <div className={d.commentBody}>
          <div className={b.row}>
            <span className={b.strong}>Ada Komeng</span>
            <span className={b.smallMuted}>2h ago</span>
          </div>
          <span className={b.text}>Is this scan from the 1930 batch? The border looks different.</span>
        </div>
      </div>
      <div className={cx(d.comment, d.reply)}>
        <Face who="terus" small />
        <div className={d.commentBody}>
          <div className={b.row}>
            <span className={b.strong}>Terus Adul</span>
            <span className={b.smallMuted}>1h ago</span>
          </div>
          <span className={b.text}>Yes, box 14. I will add the source.</span>
        </div>
      </div>
      <div className={cx(f.field, f.focus)}>
        <span className={b.grow}>
          Thanks, that helps
          <span className={f.caret} style={{ marginLeft: u(4), verticalAlign: "middle" }} />
        </span>
        <Button variant="primary" size="sm">Reply</Button>
      </div>
    </Card>
  );
}

function Device() {
  return (
    <Card>
      <div className={d.device}>
        <Glasses size={70 * U} strokeWidth={1} />
      </div>
      <div className={b.between}>
        <div className={b.tight}>
          <span className={b.h3}>Field Glasses 02</span>
          <span className={b.smallMuted}>Assigned to Terus Adul</span>
        </div>
        <Badge tone="ok" dot>
          Online
        </Badge>
      </div>
      <div className={b.row}>
        <Badge tone="ring">
          <Battery {...ICON_SM} />
          82%
        </Badge>
        <Badge tone="ring">
          <Wifi {...ICON_SM} />
          Strong
        </Badge>
        <Badge tone="ring">Firmware 2.4.1</Badge>
      </div>
      <div className={d.meter}>
        <div className={b.between}>
          <span className={b.strong}>Usage this month</span>
          <span className={cx(b.muted, b.num)}>64 of 100 hours</span>
        </div>
        <div className={o.bar}>
          <div className={o.barFill} style={{ width: "64%" }} />
        </div>
      </div>
      <div className={d.fnGrid}>
        {FUNCTIONS.map((fn, i) => (
          <Chip key={fn} ring={i < 3}>
            {fn}
          </Chip>
        ))}
        <Chip>
          <Plus {...ICON_SM} />
        </Chip>
      </div>
      <div className={b.between}>
        <Button size="sm">Open Device</Button>
        <Button label="More" size="sm" square>
          <MoreHorizontal {...ICON} />
        </Button>
      </div>
    </Card>
  );
}

export function ComposedGroup() {
  return (
    <Section label="Composed">
      <div className={cx(b.cols, b.c3)}>
        <div className={b.col}>
          <Pricing />
          <Profile />
          <Files />
        </div>
        <div className={b.col}>
          <Notifications />
          <Invite />
          <SettingsRows />
        </div>
        <div className={b.col}>
          <Device />
          <Comments />
        </div>
      </div>
    </Section>
  );
}
