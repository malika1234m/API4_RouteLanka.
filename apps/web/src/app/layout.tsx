import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Noto_Sans_Sinhala, Noto_Sans_Tamil } from "next/font/google";
import { DemoProvider } from "@/lib/store";
import "./globals.css";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const barlowCond = Barlow_Condensed({ variable: "--font-barlow-cond", subsets: ["latin"], weight: ["500", "600", "700"] });
// Sinhala and Tamil for field staff; Barlow has Latin only.
const sinhala = Noto_Sans_Sinhala({ variable: "--font-si", subsets: ["sinhala"], weight: ["400", "600", "700"], display: "swap" });
const tamil = Noto_Sans_Tamil({ variable: "--font-ta", subsets: ["tamil"], weight: ["400", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "RouteLanka",
  description: "Delivery planning and tracking for Waypoint Group: ordering, planning, loading, delivery and receipt in one relay.",
};

export const viewport: Viewport = { themeColor: "#16233a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCond.variable} ${sinhala.variable} ${tamil.variable} h-full antialiased`}>
      <body className="min-h-full">
        <DemoProvider>{children}</DemoProvider>
      </body>
    </html>
  );
}
