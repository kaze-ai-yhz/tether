import { StepLoader } from "@/components";

export default function PatientsLoading() {
  return (
    <>
      <header className="page-header">
        <h1>Patients</h1>
      </header>
      <StepLoader label="Loading patients…" />
    </>
  );
}
