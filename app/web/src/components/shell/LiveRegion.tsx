"use client";

import { useEffect, useState } from "react";
import { ANNOUNCE_EVENT, type AnnounceDetail } from "./events";

/** One polite and one assertive live region, mounted once by the shell. Fed by `announce()`. */
export function LiveRegion() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");

  useEffect(() => {
    let timer: number | undefined;
    function onAnnounce(event: Event) {
      const { message, politeness } = (event as CustomEvent<AnnounceDetail>).detail;
      const set = politeness === "assertive" ? setAssertive : setPolite;
      // Clear first so a repeated message is announced again.
      set("");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => set(message), 60);
    }
    window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    return () => {
      window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="visually-hidden" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </>
  );
}
