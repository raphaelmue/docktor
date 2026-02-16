import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Docktor",
  description: "Self-hosting management platform for Docker-based applications",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
