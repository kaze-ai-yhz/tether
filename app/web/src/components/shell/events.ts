/** Client-side app events: screen-reader announcements and "state changed" notifications. */

export const ANNOUNCE_EVENT = "tether:announce";
export const CHANGED_EVENT = "tether:changed";

export type Politeness = "polite" | "assertive";

export interface AnnounceDetail {
  message: string;
  politeness: Politeness;
}

export interface ChangedDetail {
  /** What changed, e.g. "clock", "reset", "acting-as", "review". */
  reason: string;
}

/**
 * Announces a message through the shell's live region, e.g. "Draft approved for SYN-011".
 * Use "assertive" only for new urgent escalations.
 */
export function announce(message: string, politeness: Politeness = "polite"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AnnounceDetail>(ANNOUNCE_EVENT, { detail: { message, politeness } }));
}

export function emitChanged(reason: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChangedDetail>(CHANGED_EVENT, { detail: { reason } }));
}
