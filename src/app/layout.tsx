import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Copy pre-check",
  description: "Checks UI copy for a fictional bank before compliance review.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
