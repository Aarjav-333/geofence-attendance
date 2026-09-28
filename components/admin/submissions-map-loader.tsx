"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window`, so the map only renders in the browser.
export const SubmissionsMap = dynamic(() => import("./submissions-map"), {
  ssr: false,
  loading: () => <div className="mb-6 h-72 animate-pulse rounded-xl border border-border bg-surface sm:h-96" />,
});
