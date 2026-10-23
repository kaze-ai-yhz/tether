import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/AppShell";
import type { ActingAs } from "@/components/shell/ShellContext";
import "@/styles/tokens.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Tether",
  description:
    "Chronic-care follow-up in Snowflake. Claude drafts the next step; a clinician approves every outbound action. Synthetic data only.",
};

/** Acting-as cookie set by POST /api/session (httpOnly, default clinician). */
const ACTING_AS_COOKIE = "tether_acting_as";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const actingAs: ActingAs = cookieStore.get(ACTING_AS_COOKIE)?.value === "agent" ? "agent" : "clinician";

  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <AppShell initialActingAs={actingAs}>{children}</AppShell>
      </body>
    </html>
  );
}
