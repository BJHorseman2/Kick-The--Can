import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareLedger",
  description:
    "The admin command center for caring for an aging parent. Track facility bills, split family expenses, store documents, and log visits.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
