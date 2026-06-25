"use client";

import { BookOpen } from "lucide-react";
import { MetaCard, type MetaTeamRef } from "./meta-card";
import { longWhen } from "../utils";
import type { ViewModel } from "./view-model";
import styles from "../knowledge-v2.module.css";

interface Props {
  vm: ViewModel;
  /** Teams granted on this base (admin view); undefined for members. */
  teams?: MetaTeamRef[];
}

/**
 * Base overview — the meta card + description + subtasks shown when a whole
 * knowledge base (not a file) is selected. Status/subtasks are static
 * placeholders; dates, visibility, access, and teams are real.
 */
export function BaseOverview({ vm, teams }: Props) {
  return (
    <>
      <p className={styles.docSub}>{vm.subtitle}</p>

      <div className={styles.hr} />

      <MetaCard
        tint={vm.tint}
        containerName={vm.containerName}
        title={vm.title}
        ownerLabel="Owner"
        ownerInitial={vm.ownerInitial}
        createdAt={longWhen(vm.createdAt)}
        updatedAt={longWhen(vm.updatedAt)}
        scopeLabel={vm.scopeLabel}
        accessLabel={vm.accessLabel}
        teams={teams}
      />

      <div className={styles.hr} />

      <section>
        <h3 className={styles.descHead}>Description</h3>
        <div className={styles.descBody}>
          {vm.description ? <p>{vm.description}</p> : <p>No description yet.</p>}
        </div>
      </section>

      <div className={styles.hr} />

      <section>
        <h3 className={styles.subHead}>Subtasks</h3>
        <div className={styles.subDateRow}>
          <BookOpen size={15} />
          {new Date(vm.createdAt).toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}
        </div>
        <div className={styles.subItem}>
          <span className={styles.subCheck} />
          Kickoff: review brief &amp; goals
        </div>
        <div className={styles.subItem}>
          <span className={styles.subCheck} />
          Draft outline
        </div>
      </section>
    </>
  );
}
