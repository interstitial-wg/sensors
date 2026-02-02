"use client";

import Script from "next/script";

const UMAMI_SCRIPT_URL =
  process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL ||
  "https://cloud.umami.is/script.js";

/**
 * Umami Analytics – loads only when NEXT_PUBLIC_UMAMI_WEBSITE_ID is set (e.g. in production).
 * Set the env var in your deployment to enable tracking.
 */
export function UmamiAnalytics() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

  if (!websiteId) {
    return null;
  }

  return (
    <Script
      async
      src={UMAMI_SCRIPT_URL}
      data-website-id={websiteId}
      strategy="afterInteractive"
    />
  );
}
