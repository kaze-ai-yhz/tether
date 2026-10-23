"use client";

import { useState } from "react";
import { announce, postJson, useShell } from "@/components";

export interface WriteResult {
  /** Which button produced the result, e.g. "ANSWERED". */
  key: string;
  ok: boolean;
  /** The proc's message or the error text, verbatim. */
  text: string;
  code: string | null;
  fixtures: boolean;
}

/**
 * POSTs to a route handler, keeps the last result for display, announces it, and on success
 * refreshes the server-rendered page (and the shell's app state).
 */
export function useWrite(reason: string) {
  const { notifyChanged } = useShell();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<WriteResult | null>(null);

  async function run(key: string, url: string, payload: unknown, describe: (ok: boolean, text: string) => string) {
    setBusy(key);
    const outcome = await postJson(url, payload);
    setBusy(null);
    const next: WriteResult = { key, ok: outcome.ok, text: outcome.text, code: outcome.code, fixtures: outcome.fixtures };
    setResult(next);
    announce(describe(outcome.ok, outcome.text));
    if (outcome.ok) notifyChanged(reason);
    return next;
  }

  return { busy, result, run };
}
