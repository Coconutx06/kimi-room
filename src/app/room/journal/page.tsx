import Link from "next/link";
import { getTheme } from "@/lib/day-theme";
import { JournalClient } from "@/components/journal/JournalClient";

export default async function JournalPage() {
  const theme = await getTheme();
  const isDay = theme === "day";
  const palette = isDay
    ? {
        bg: "#eee3d8",
        paper: "rgba(255, 250, 245, .78)",
        ink: "#3a2d2a",
        mute: "#88736d",
        hair: "rgba(114, 87, 79, .25)",
        self: "#a42b5e",
        companion: "#9a7132",
        shadow: "rgba(91, 62, 49, .14)",
      }
    : {
        bg: "#0d0908",
        paper: "rgba(27, 21, 17, .82)",
        ink: "#f0e4d1",
        mute: "#9e8f7e",
        hair: "rgba(201, 167, 104, .22)",
        self: "#c87598",
        companion: "#d0a85d",
        shadow: "rgba(0, 0, 0, .45)",
      };

  return (
    <main style={{ minHeight: "100dvh", background: palette.bg, color: palette.ink }}>
      <div style={{ width: "min(100%, 480px)", margin: "0 auto", padding: "max(22px, env(safe-area-inset-top)) 18px max(24px, env(safe-area-inset-bottom))" }}>
        <Link href="/room" aria-label="回到 room" style={{ color: palette.mute, textDecoration: "none", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, letterSpacing: 1 }}>
          ‹ room
        </Link>
        <JournalClient palette={palette} />
      </div>
    </main>
  );
}
