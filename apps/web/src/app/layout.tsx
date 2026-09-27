import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { DemoProvider } from "@/lib/store";
import "./globals.css";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const barlowCond = Barlow_Condensed({ variable: "--font-barlow-cond", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "RouteLanka",
  description: "Delivery planning and tracking for Waypoint Group: ordering, planning, loading, delivery and receipt in one relay.",
};

export const viewport: Viewport = { themeColor: "#16233a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCond.variable} h-full antialiased`}>
      <body className="min-h-full">
        <DemoProvider>{children}</DemoProvider>
      </body>
    </html>
  );
}
