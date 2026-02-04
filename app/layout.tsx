import type { Metadata } from "next";
import {
  Fira_Code,
  Geist_Mono,
  JetBrains_Mono,
  Noto_Sans,
} from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { UmamiAnalytics } from "@/components/UmamiAnalytics";

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Global sensors map",
  description: "Explore global sensors by type and location",
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params?: Promise<Record<string, string | string[]>>;
}>) {
  // Next.js 16: params is a Promise and must be awaited before any use/serialization
  if (params) await params;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('sensors-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');})();`,
          }}
        />
      </head>
      <body
        className={`${notoSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${firaCode.variable} antialiased min-h-screen`}
      >
        <ThemeProvider>
          {children}
          <UmamiAnalytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
