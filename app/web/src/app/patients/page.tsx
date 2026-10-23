import { ErrorState } from "@/components";
import { PatientTable, RetryButton, SourceTag, statusCounts } from "@/components/patients";
import styles from "@/components/patients/patients.module.css";
import { getPatients } from "@/lib/data";

/**
 * Space above and below the table at 100dvh (top bar, footer, content padding, page header,
 * bottom gap), plus the shell's fixture banner when it shows. Keeps the header sticky and all
 * rows above the fold at 1440 x 900.
 */
const TABLE_OFFSET = { live: "188px", fixtures: "240px" } as const;

// Patients: V_PATIENT_LIST, most urgent status first; a row opens the patient.
export default async function PatientsPage() {
  const result = await getPatients();

  if (!result.ok) {
    return (
      <>
        <header className="page-header">
          <h1>Patients</h1>
        </header>
        <div className={styles.errorBlock}>
          <ErrorState title="Could not load the patients" message={result.error.message} code={result.error.code} />
          <RetryButton />
        </div>
      </>
    );
  }

  const rows = result.data;
  const counts = statusCounts(rows);

  return (
    <>
      <header className="page-header">
        <div className={styles.headingRow}>
          <h1>Patients</h1>
          <SourceTag fixtures={result.fixtures} source={result.fixture_source} />
        </div>
        <p className={styles.counts}>
          <span>
            <strong>{rows.length}</strong> synthetic patients, most urgent first
          </span>
          {counts.map((c) => (
            <span key={c.status}>
              {c.status} <strong>{c.count}</strong>
            </span>
          ))}
        </p>
      </header>
      <PatientTable
        rows={rows}
        maxHeight={`calc(100dvh - ${result.fixtures ? TABLE_OFFSET.fixtures : TABLE_OFFSET.live})`}
      />
    </>
  );
}
