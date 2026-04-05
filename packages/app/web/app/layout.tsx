import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClawScale",
  description: "ClawScale — multi-user, multi-agent IM chatbot gateway",
  icons: { icon: "/logo.png" },
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
