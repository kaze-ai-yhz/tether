"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CHANGED_EVENT, announce, emitChanged, type ChangedDetail } from "./events";
import { getJson, postJson, type ApiOutcome } from "./request";

export type ActingAs = "agent" | "clinician";

export const ACTING_AS_LABEL: Record<ActingAs, string> = {
  agent: "Care agent",
  clinician: "Clinician",
};

/** The V_APP_STATE fields the shell reads (lower-case keys from GET /api/state). */
export interface AppStateSummary {
  as_of_date?: string | null;
  pending_count?: number | null;
  red_flag_count?: number | null;
  needs_clinician_count?: number | null;
  roles_mode?: string | null;
  models?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface ShellContextValue {
  /** From the httpOnly `tether_acting_as` cookie, read by the server layout. */
  actingAs: ActingAs;
  /** POSTs /api/session; resolves false (and keeps the old value) if the server refused. */
  setActingAs: (next: ActingAs) => Promise<boolean>;
  isSwitchingRole: boolean;
  appState: AppStateSummary | null;
  /** True when GET /api/state answered from fixtures. */
  fixtures: boolean;
  stateError: string | null;
  stateLoading: boolean;
  refreshAppState: () => Promise<void>;
  /** Call after any write: refetches app state, re-renders server components, emits `tether:changed`. */
  notifyChanged: (reason: string) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <AppShell>");
  return value;
}

/** Runs `callback` whenever any part of the app reports a write (clock, reset, review, role switch). */
export function useOnTetherChanged(callback: (detail: ChangedDetail) => void): void {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  }, [callback]);
  useEffect(() => {
    function onChanged(event: Event) {
      ref.current((event as CustomEvent<ChangedDetail>).detail);
    }
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHANGED_EVENT, onChanged);
  }, []);
}

export function ShellProvider({ initialActingAs, children }: { initialActingAs: ActingAs; children: ReactNode }) {
  const router = useRouter();
  const [actingAs, setActingAsValue] = useState<ActingAs>(initialActingAs);
  const [isSwitchingRole, setSwitchingRole] = useState(false);
  const [appState, setAppState] = useState<AppStateSummary | null>(null);
  const [fixtures, setFixtures] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [stateLoading, setStateLoading] = useState(true);

  const applyState = useCallback((outcome: ApiOutcome<AppStateSummary | AppStateSummary[]>) => {
    if (outcome.ok) {
      const row = Array.isArray(outcome.data) ? (outcome.data[0] ?? null) : outcome.data;
      setAppState(row);
      setStateError(null);
    } else {
      setStateError(outcome.text);
    }
    // The route reports the acting-as value it used; follow it (e.g. after the cookie expired).
    const serverActingAs =
      typeof outcome.raw === "object" && outcome.raw !== null
        ? (outcome.raw as { acting_as?: unknown }).acting_as
        : undefined;
    if (serverActingAs === "agent" || serverActingAs === "clinician") setActingAsValue(serverActingAs);
    setFixtures(outcome.fixtures);
    setStateLoading(false);
  }, []);

  const refreshAppState = useCallback(async () => {
    applyState(await getJson<AppStateSummary | AppStateSummary[]>("/api/state"));
  }, [applyState]);

  useEffect(() => {
    let cancelled = false;
    void getJson<AppStateSummary | AppStateSummary[]>("/api/state").then((outcome) => {
      if (!cancelled) applyState(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  const notifyChanged = useCallback(
    (reason: string) => {
      void refreshAppState();
      router.refresh();
      emitChanged(reason);
    },
    [refreshAppState, router],
  );

  const setActingAs = useCallback(
    async (next: ActingAs) => {
      if (next === actingAs) return true;
      setSwitchingRole(true);
      const outcome = await postJson("/api/session", { actingAs: next });
      setSwitchingRole(false);
      if (!outcome.ok) {
        announce(`Could not switch to ${ACTING_AS_LABEL[next]}. ${outcome.text}`);
        return false;
      }
      setActingAsValue(next);
      announce(`Acting as ${ACTING_AS_LABEL[next]}.`);
      notifyChanged("acting-as");
      return true;
    },
    [actingAs, notifyChanged],
  );

  const value = useMemo<ShellContextValue>(
    () => ({
      actingAs,
      setActingAs,
      isSwitchingRole,
      appState,
      fixtures,
      stateError,
      stateLoading,
      refreshAppState,
      notifyChanged,
    }),
    [actingAs, setActingAs, isSwitchingRole, appState, fixtures, stateError, stateLoading, refreshAppState, notifyChanged],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
