"use client";

import { ErrorState } from "@/components";

// Error boundary for the patients screens (data errors render inline; this catches the rest).
export default function PatientsError({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <ErrorState
      title="Could not show this screen"
      message={message}
      code={digest ? `digest ${digest}` : null}
      onRetry={retry}
    />
  );
}
