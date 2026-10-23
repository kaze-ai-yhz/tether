import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, StatusChip, formatSimDate } from "@/components";
import type { PatientDetail } from "@/lib/types";
import { conditionLabel, parsePrefs, settingLabel } from "./format";
import { ToneChip } from "./ToneChip";
import styles from "./patients.module.css";

function Directive({ label, value, noteId }: { label: string; value: string; noteId: string | null }) {
  return (
    <span className={styles.pref}>
      {label ? <span className={styles.prefLabel}>{label}:</span> : null}
      <span>{value}</span>
      {noteId ? (
        <span className={styles.prefNote}>
          <span className="visually-hidden">signed in note </span>
          {noteId}
        </span>
      ) : null}
    </span>
  );
}

function yesNo(value: boolean | null): string {
  return value === true ? "Yes" : value === false ? "No" : "Not recorded";
}

export interface PatientHeaderProps {
  patient: PatientDetail;
  /** Where the rows came from (fixtures only). */
  sourceTag?: ReactNode;
  /** In-page section links. */
  nav?: ReactNode;
}

/** Name, SYN id, status and reason, AI Plan directives and contact preferences, and any clinician hold. */
export function PatientHeader({ patient, sourceTag, nav }: PatientHeaderProps) {
  const prefs = parsePrefs(patient.prefs);
  const noteFor = (setting: string) => patient.active_overrides.find((o) => o.setting === setting)?.note_id ?? null;
  const goals = patient.active_overrides.filter((o) => o.setting === "A1C_GOAL" || o.setting === "BP_GOAL");
  const risks = [
    patient.has_diabetes ? "Diabetes" : null,
    patient.has_ckd ? "CKD" : null,
    patient.has_clinical_cvd ? "Clinical CVD" : null,
  ].filter((r): r is string => r !== null);
  const heldFiring = patient.firings.find((f) => f.is_held) ?? null;

  return (
    <header className={styles.header}>
      <div>
        <Link href="/patients" className={styles.back}>
          <Icon name="chevronLeft" size={14} />
          All patients
        </Link>
        <div className={styles.titleRow}>
          <h1>{patient.display_name}</h1>
          <span className={styles.titleId}>{patient.patient_id}</span>
          {sourceTag}
        </div>
      </div>

      <dl className={styles.meta}>
        <div>
          <dt>Age</dt>
          <dd>{patient.age ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Conditions</dt>
          <dd>{patient.conditions.length ? patient.conditions.map(conditionLabel).join(", ") : "None recorded"}</dd>
        </div>
        {patient.prevent_10yr_pct !== null ? (
          <div>
            <dt>PREVENT 10-year risk</dt>
            <dd>{patient.prevent_10yr_pct} %</dd>
          </div>
        ) : null}
        {risks.length ? (
          <div>
            <dt>Risk factors</dt>
            <dd>{risks.join(", ")}</dd>
          </div>
        ) : null}
        <div>
          <dt>Next visit</dt>
          <dd>{formatSimDate(patient.next_visit_on) ?? "Not scheduled"}</dd>
        </div>
        <div>
          <dt>Consent to AI calls</dt>
          <dd>{yesNo(patient.ai_call_consent)}</dd>
        </div>
        <div>
          <dt>Last reading</dt>
          <dd>{formatSimDate(patient.last_reading_on) ?? "None yet"}</dd>
        </div>
      </dl>

      <div className={styles.statusRow}>
        <StatusChip status={patient.display_status} />
        {patient.status_reason ? <span className={styles.statusReason}>{patient.status_reason}</span> : null}
      </div>

      <div className={styles.chipRows}>
        <div className={styles.chipRow}>
          <span className={styles.chipRowLabel}>AI Plan</span>
          <span>{patient.ai_plan_mode ?? "No AI Plan"}</span>
          {patient.plan_status === "NEEDS_REVIEW" ? <ToneChip tone="caution" icon="eye" label="Needs review" /> : null}
          {goals.map((g) => (
            <Directive key={g.setting} label={settingLabel(g.setting)} value={g.raw_value} noteId={g.note_id} />
          ))}
        </div>
        {prefs.length ? (
          <div className={styles.chipRow}>
            <span className={styles.chipRowLabel}>Preferences</span>
            {prefs.map((p) => (
              <Directive key={`${p.setting}-${p.value}`} label={p.label} value={p.value} noteId={p.setting ? noteFor(p.setting) : null} />
            ))}
          </div>
        ) : null}
      </div>

      {patient.held ? (
        <div className={styles.held} role="note">
          <Icon name="clock" className={styles.heldIcon} />
          <div className={styles.heldText}>
            <span className={styles.heldTitle}>
              Escalation held by the clinician until {formatSimDate(patient.held.held_until) ?? patient.held.held_until}
            </span>
            <span>
              Signed in note <span className="mono">{patient.held.note_id}</span>. Without the hold,{" "}
              <span className="mono">{patient.held.held_rule}</span> would fire; nothing is drafted for it while the hold
              lasts.
            </span>
            {heldFiring?.evidence ? <span className={styles.muted}>{heldFiring.evidence}</span> : null}
          </div>
        </div>
      ) : null}

      {nav}
    </header>
  );
}
