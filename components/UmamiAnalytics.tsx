"use client";

import Script from "next/script";

const UMAMI_SCRIPT_URL =
  process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL ||
  "https://cloud.umami.is/script.js";

/**
 * Umami Analytics – loads only when NEXT_PUBLIC_UMAMI_WEBSITE_ID is set and NODE_ENV is production.
 * Disabled in development to avoid 404s from api-gateway.umami.dev.
 */
export function UmamiAnalytics() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const isProduction = process.env.NODE_ENV === "production";

  if (!websiteId || !isProduction) {
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
