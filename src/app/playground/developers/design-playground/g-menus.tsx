import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, Download, FolderInput, Link2, LogOut, Pencil, Search, Settings, Trash2, User } from "lucide-react";
import b from "./sys-base.module.css";
import f from "./sys-forms.module.css";
import o from "./sys-surfaces.module.css";
import { Card, Face, Initials, Section, cx, ICON } from "./sys";

const DAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const LEAD = [30];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const RANGE_START = 9;
const RANGE_END = 15;
const TAIL = [1, 2, 3];

function DatePicker() {
  return (
    <Card>
      <div className={b.between}>
        <span className={cx(b.btn, b.sm, b.square)} aria-label="Previous month">
          <ChevronLeft {...ICON} />
        </span>
        <span className={b.h3}>October 2024</span>
        <span className={cx(b.btn, b.sm, b.square)} aria-label="Next month">
          <ChevronRight {...ICON} />
        </span>
      </div>
      <div className={o.calendar}>
        {DAY_NAMES.map((d) => (
          <span key={d} className={o.dayName}>
            {d}
          </span>
        ))}
        {LEAD.map((d) => (
          <span key={`l${d}`} className={cx(o.day, o.dayOut)}>
            {d}
          </span>
        ))}
        {DAYS.map((d) => (
          <span key={d} className={cx(o.day, d > RANGE_START && d < RANGE_END && o.dayRange, (d === RANGE_START || d === RANGE_END) && o.dayEnd)}>
            {d}
          </span>
        ))}
        {TAIL.map((d) => (
          <span key={`t${d}`} className={cx(o.day, o.dayOut)}>
            {d}
          </span>
        ))}
      </div>
      <div className={b.between}>
        <span className={b.muted}>Oct 9 to Oct 15</span>
        <span className={cx(b.btn, b.primary, b.sm)}>Apply</span>
      </div>
    </Card>
  );
}

function TimePicker() {
  return (
    <Card>
      <div className={b.between}>
        <div className={b.row}>
          <Clock {...ICON} className={b.iconInk} />
          <span className={b.h3}>Start time</span>
        </div>
        <span className={cx(b.strong, b.num)}>09:30 AM</span>
      </div>
      <div className={o.timeCols}>
        {[
          ["08", "09", "10"],
          ["15", "30", "45"],
          ["AM", "PM", ""],
        ].map((col, c) => (
          <div key={c} className={b.tight}>
            {col.map((v, i) => (
              <span key={v || i} className={cx(o.timeCell, v && (c === 2 ? i === 0 : i === 1) && o.timeOn)}>
                {v}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function MenusGroup() {
  return (
    <Section label="Menus">
      <div className={cx(b.cols, b.c3)}>
        <div className={b.col}>
          <Card>
            <div className={b.row}>
              <Face who="ada" />
              <div className={cx(b.tight, b.grow)}>
                <span className={b.strong}>Ada Komeng</span>
                <span className={b.small}>ada@jawa.id</span>
              </div>
              <ChevronDown {...ICON} className={b.iconSoft} />
            </div>
            <div className={o.menu}>
              <div className={cx(o.item, o.itemOn)}>
                <User {...ICON} />
                Profile
                <span className={o.itemEnd}>⇧P</span>
              </div>
              <div className={o.item}>
                <Settings {...ICON} />
                Settings
                <span className={o.itemEnd}>⌘,</span>
              </div>
              <div className={o.menuLine} />
              <div className={cx(o.item, o.itemDanger)}>
                <LogOut {...ICON} />
                Log out
              </div>
            </div>
          </Card>
          <Card>
            <div className={b.row}>
              <span className={b.pill}>
                Region
                <ChevronDown {...ICON} className={b.iconSoft} />
              </span>
            </div>
            <div className={o.menu}>
              {["Central Java", "East Java", "West Java", "Banten", "Yogyakarta"].map((r, i) => (
                <div key={r} className={cx(o.item, i === 4 && o.itemOn)}>
                  {r}
                  {i === 4 && (
                    <span className={o.itemEnd}>
                      <Check {...ICON} className={b.iconInk} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <DatePicker />
          <TimePicker />
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Assign To</div>
            <div className={cx(f.field, f.focus)}>
              <Search {...ICON} className={b.iconInk} />
              <span>Ag</span>
              <span className={f.caret} />
            </div>
            <div className={cx(o.menu, o.menuWide)}>
              <div className={o.menuHead}>People</div>
              <div className={cx(o.item, o.itemOn)}>
                <Face who="agus" small clip />
                <span>
                  <mark className={o.mark}>Ag</mark>us lagi sedih
                </span>
                <span className={o.itemEnd}>Graphic Designer</span>
              </div>
              <div className={o.item}>
                <Initials text="AN" small />
                <span>
                  <mark className={o.mark}>Ag</mark>ung Nugroho
                </span>
                <span className={o.itemEnd}>Researcher</span>
              </div>
              <div className={o.menuLine} />
              <div className={o.menuHead}>Files</div>
              <div className={o.item}>
                <Link2 {...ICON} className={b.iconSoft} />
                <span>
                  <mark className={o.mark}>Ag</mark>enda Oct 2024.pdf
                </span>
              </div>
            </div>
          </Card>
          <Card>
            <div className={b.between}>
              <div className={b.tight}>
                <span className={b.strong}>Parang Rusak scan.tiff</span>
                <span className={b.smallMuted}>Scan, Oct 12</span>
              </div>
              <span className={b.badge}>42 MB</span>
            </div>
            <div className={o.menu}>
              <div className={o.item}>
                <Pencil {...ICON} className={b.iconSoft} />
                Rename
                <span className={o.itemEnd}>⌘R</span>
              </div>
              <div className={cx(o.item, o.itemOn)}>
                <Copy {...ICON} />
                Duplicate
                <span className={o.itemEnd}>⌘D</span>
              </div>
              <div className={o.item}>
                <FolderInput {...ICON} className={b.iconSoft} />
                Move to
                <span className={o.itemEnd}>
                  <ChevronRight {...ICON} className={b.iconSoft} />
                </span>
              </div>
              <div className={cx(o.item, o.itemOff)}>
                <Download {...ICON} />
                Download
              </div>
              <div className={o.menuLine} />
              <div className={cx(o.item, o.itemDanger)}>
                <Trash2 {...ICON} />
                Delete
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
