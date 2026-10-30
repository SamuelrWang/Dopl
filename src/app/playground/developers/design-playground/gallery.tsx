import { ButtonsGroup } from "./g-buttons";
import { ComposedGroup } from "./g-composed";
import { CredentialsGroup } from "./g-credentials";
import { DataGroupA, DataGroupB } from "./g-data";
import { FeedbackGroup } from "./g-feedback";
import { InputsGroup } from "./g-inputs";
import { MenusGroup } from "./g-menus";
import { NavigationGroup } from "./g-navigation";
import { OverlaysGroup } from "./g-overlays";
import { SelectionGroup } from "./g-selection";
import b from "../_design/base.module.css";

/** Everything below the clone, built from the recipes named on .canvas. */
export function Gallery() {
  return (
    <div className={b.gallery}>
      <ButtonsGroup />
      <InputsGroup />
      <SelectionGroup />
      <MenusGroup />
      <FeedbackGroup />
      <OverlaysGroup />
      <NavigationGroup />
      <div className={b.section}>
        <DataGroupA />
        <DataGroupB />
      </div>
      <ComposedGroup />
      <CredentialsGroup />
    </div>
  );
}
