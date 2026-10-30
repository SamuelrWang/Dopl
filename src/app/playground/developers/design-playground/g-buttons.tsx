import { ChevronDown, Copy, Download, FileText, Heart, Loader2, MoreHorizontal, Pencil, Plus, Share2, Trash2, Upload } from "lucide-react";
import b from "../_design/base.module.css";
import { Card, Section, cx, ICON } from "../_design/components";

const Spin = () => <Loader2 {...ICON} className={b.spinner} />;

export function ButtonsGroup() {
  return (
    <Section label="Buttons">
      <div className={cx(b.cols, b.c3)}>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Variants</div>
            <div className={cx(b.row, b.wrap)}>
              <span className={cx(b.btn, b.primary)}>Publish</span>
              <span className={b.btn}>Save draft</span>
              <span className={cx(b.btn, b.ghost)}>Discard</span>
            </div>
            <div className={cx(b.row, b.wrap)}>
              <span className={cx(b.btn, b.danger)}>Delete project</span>
              <span className={cx(b.btn, b.dangerOutline)}>Revoke</span>
            </div>
            <div className={cx(b.row, b.wrap)}>
              <span className={cx(b.btn, b.primary)}>
                <Spin />
                Publishing
              </span>
              <span className={b.btn}>
                <Spin />
                Saving
              </span>
              <span className={cx(b.btn, b.off)}>Disabled</span>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Sizes and icons</div>
            <div className={cx(b.row, b.wrap)}>
              <span className={cx(b.btn, b.primary, b.lg)}>Large</span>
              <span className={cx(b.btn, b.primary)}>Medium</span>
              <span className={cx(b.btn, b.primary, b.sm)}>Small</span>
            </div>
            <div className={cx(b.row, b.wrap)}>
              <span className={cx(b.btn, b.lg)}>Large</span>
              <span className={b.btn}>Medium</span>
              <span className={cx(b.btn, b.sm)}>Small</span>
            </div>
            <div className={cx(b.row, b.wrap)}>
              <span className={b.btn}>
                <Upload {...ICON} />
                Upload
              </span>
              <span className={cx(b.btn, b.primary)}>
                <Plus {...ICON} />
                New file
              </span>
              <span className={cx(b.btn, b.square)} aria-label="Copy">
                <Copy {...ICON} />
              </span>
              <span className={cx(b.btn, b.square)} aria-label="More">
                <MoreHorizontal {...ICON} />
              </span>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card className={b.spread}>
            <div className={b.between}>
              <div className={b.row}>
                <span className={b.tile}>
                  <FileText {...ICON} />
                </span>
                <div className={b.tight}>
                  <span className={b.h3}>Festival Guide 2024</span>
                  <span className={b.muted}>Edited by Ada Komeng, 4 min ago</span>
                </div>
              </div>
              <span className={cx(b.badge, b.badgeRing)}>Draft</span>
            </div>
            <div className={b.line} />
            <div className={cx(b.row, b.wrap)}>
              <span className={cx(b.btn, b.sm)}>
                <Pencil {...ICON} />
                Edit
              </span>
              <span className={cx(b.btn, b.sm)}>
                <Share2 {...ICON} />
                Share
              </span>
              <span className={cx(b.btn, b.sm)}>
                <Download {...ICON} />
                Export
              </span>
              <span className={cx(b.btn, b.sm, b.square)} aria-label="Favorite">
                <Heart {...ICON} />
              </span>
              <span className={cx(b.btn, b.sm, b.square, b.dangerOutline)} aria-label="Delete">
                <Trash2 {...ICON} />
              </span>
            </div>
            <div className={b.between}>
              <span className={b.btn}>Back</span>
              <span className={b.split}>
                <span className={b.splitMain}>Publish</span>
                <span className={b.splitDivider} />
                <span className={b.splitMore}>
                  <ChevronDown {...ICON} />
                </span>
              </span>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
