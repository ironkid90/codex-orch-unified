import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Orchestrator",
  description: "Multi-agent orchestration platform with live telemetry",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
