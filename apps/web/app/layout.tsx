import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VideoRoulette RT Translate",
  description:
    "Random video chat with real-time AI voice translation — speak your language, be heard in theirs.",
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
