import { ChevronDown, Copy, Download, FileText, Heart, Loader2, MoreHorizontal, Pencil, Plus, Share2, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card } from "../_design/ui";
import b from "../_design/base.module.css";
import { Section, cx, ICON } from "../_design/components";

const Spin = () => <Loader2 {...ICON} className={b.spinner} />;

export function ButtonsGroup() {
  return (
    <Section label="Buttons">
      <div className={cx(b.cols, b.c3)}>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Variants</div>
            <div className={cx(b.row, b.wrap)}>
              <Button variant="primary">Publish</Button>
              <Button>Save draft</Button>
              <Button variant="ghost">Discard</Button>
            </div>
            <div className={cx(b.row, b.wrap)}>
              <Button variant="danger">Delete project</Button>
              <Button variant="dangerOutline">Revoke</Button>
            </div>
            <div className={cx(b.row, b.wrap)}>
              <Button variant="primary">
                <Spin />
                Publishing
              </Button>
              <Button>
                <Spin />
                Saving
              </Button>
              <Button disabled>Disabled</Button>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Sizes and icons</div>
            <div className={cx(b.row, b.wrap)}>
              <Button variant="primary" size="lg">Large</Button>
              <Button variant="primary">Medium</Button>
              <Button variant="primary" size="sm">Small</Button>
            </div>
            <div className={cx(b.row, b.wrap)}>
              <Button size="lg">Large</Button>
              <Button>Medium</Button>
              <Button size="sm">Small</Button>
            </div>
            <div className={cx(b.row, b.wrap)}>
              <Button>
                <Upload {...ICON} />
                Upload
              </Button>
              <Button variant="primary">
                <Plus {...ICON} />
                New file
              </Button>
              <Button label="Copy" square>
                <Copy {...ICON} />
              </Button>
              <Button label="More" square>
                <MoreHorizontal {...ICON} />
              </Button>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card spread>
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
              <Badge tone="ring">Draft</Badge>
            </div>
            <div className={b.line} />
            <div className={cx(b.row, b.wrap)}>
              <Button size="sm">
                <Pencil {...ICON} />
                Edit
              </Button>
              <Button size="sm">
                <Share2 {...ICON} />
                Share
              </Button>
              <Button size="sm">
                <Download {...ICON} />
                Export
              </Button>
              <Button label="Favorite" size="sm" square>
                <Heart {...ICON} />
              </Button>
              <Button label="Delete" size="sm" square variant="dangerOutline">
                <Trash2 {...ICON} />
              </Button>
            </div>
            <div className={b.between}>
              <Button>Back</Button>
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
