import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "ATLAS: your visit paper, turned into a plan you can finish. Every step quotes your paper.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Built once at build time from our own self-hosted fonts (converted to static TTF) and the app icon.
export default async function Image() {
  const dir = join(process.cwd(), "src/app");
  const [display, body, icon] = await Promise.all([
    readFile(join(dir, "og/BricolageGrotesque-ExtraBold.ttf")),
    readFile(join(dir, "og/Figtree-Bold.ttf")),
    readFile(join(dir, "apple-icon.png")),
  ]);
  const chip = (text: string, bg: string) => (
    <div style={{ display: "flex", padding: "12px 24px", borderRadius: 999, border: "3px solid #102a43", background: bg, fontSize: 28 }}>{text}</div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#e6f6f0", color: "#102a43", fontFamily: "Figtree" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <img src={`data:image/png;base64,${icon.toString("base64")}`} width={92} height={92} style={{ borderRadius: 22 }} alt="" />
          <div style={{ fontFamily: "Bricolage", fontSize: 54 }}>ATLAS</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontFamily: "Bricolage", fontSize: 76, lineHeight: 1.02, maxWidth: 1000 }}>Your visit paper, turned into a plan you can finish.</div>
          <div style={{ fontSize: 32, color: "#334e68", maxWidth: 960 }}>Every step quotes your paper. Help comes from verified Atlanta health centers and programs.</div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {chip("Every step quotes your paper", "#bfe9dc")}
          {chip("7 languages", "#d6e9f8")}
          {chip("Not medical advice", "#ffe0c2")}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bricolage", data: display, style: "normal", weight: 800 },
        { name: "Figtree", data: body, style: "normal", weight: 700 },
      ],
    },
  );
}
