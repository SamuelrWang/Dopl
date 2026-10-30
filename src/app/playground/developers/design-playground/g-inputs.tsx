import { AlertCircle, CheckCircle2, ChevronDown, Eye, Mail, Paperclip, Search, X } from "lucide-react";
import b from "../_design/base.module.css";
import f from "../_design/forms.module.css";
import { Card, Section, cx, ICON, ICON_SM } from "../_design/components";

const TAGS = ["Batik", "Gamelan", "Wayang", "Oral history"];

export function InputsGroup() {
  return (
    <Section label="Inputs">
      <div className={cx(b.cols, b.c3r)}>
        <div className={b.col}>
          <Card>
            <div className={b.tight}>
              <span className={b.title}>Create Your Account</span>
              <span className={b.muted}>Jawa Archive</span>
            </div>
            <div className={f.floating}>
              <span className={f.floatLabel}>Full Name</span>
              <div className={cx(f.floatCell, f.floatValue)}>Ada Komeng</div>
            </div>
            <div className={f.floating}>
              <span className={f.floatLabel}>Phone Number</span>
              <div className={f.floatCell}>
                +62
                <ChevronDown {...ICON} className={b.iconSoft} />
              </div>
              <div className={f.floatDivider} />
              <div className={cx(f.floatCell, f.floatValue)}>812 3456 7890</div>
            </div>
            <div className={f.floating}>
              <span className={f.floatLabel}>Password</span>
              <div className={cx(f.floatCell, f.floatValue)}>••••••••••••</div>
              <div className={f.floatCell}>
                <Eye {...ICON} className={b.iconSoft} />
              </div>
            </div>
            <span className={cx(b.btn, b.primary, b.full)}>Create Account</span>
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Field States</div>
            <div className={b.stack}>
              <div className={f.field}>
                <Mail {...ICON} className={b.iconSoft} />
                <span className={f.placeholder}>name@jawa.id</span>
              </div>
              <div className={cx(f.field, f.focus)}>
                <Mail {...ICON} className={b.iconInk} />
                ada@jawa.id
                <span className={f.caret} />
              </div>
            </div>
            <div className={b.stack}>
              <div className={cx(f.field, f.error)}>
                <span className={b.grow}>ada@jawa</span>
                <AlertCircle {...ICON} className={f.iconError} />
              </div>
              <span className={f.helperError}>Enter a complete email address</span>
            </div>
            <div className={b.stack}>
              <div className={cx(f.field, f.success)}>
                <span className={b.grow}>adakomeng</span>
                <CheckCircle2 {...ICON} className={f.iconOk} />
              </div>
              <span className={f.helperOk}>Username is available</span>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.title}>New Entry</div>
            <div className={cx(f.field, f.focus)}>
              <Search {...ICON} className={b.iconInk} />
              <span className={b.grow}>Batik pattern</span>
              <X {...ICON} className={b.iconSoft} />
            </div>
            <div className={f.tags}>
              {TAGS.map((tag) => (
                <span key={tag} className={f.tag}>
                  {tag}
                  <X {...ICON_SM} className={b.iconSoft} />
                </span>
              ))}
              <span className={f.placeholder}>Add tag</span>
            </div>
            <div className={f.textarea}>
              Parang motifs trace their lines to the courts of Surakarta, and each width once marked a rank.
              <div className={b.between}>
                <Paperclip {...ICON} className={b.iconSoft} />
                <span className={b.smallMuted}>94 / 280</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
