"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components";

/** Re-renders the current server page (used under an ErrorState on server-rendered screens). */
export function RetryButton({ label = "Try again" }: { label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button variant="secondary" size="sm" icon="reset" isPending={isPending} onPress={() => startTransition(() => router.refresh())}>
      {label}
    </Button>
  );
}
