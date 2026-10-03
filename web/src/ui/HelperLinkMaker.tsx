"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import qrcode from "qrcode-generator";
import { LANGUAGES, READING_LEVELS } from "@/lib/schema";
import { buildHelperLink, helperSmsHref, helperSmsText, isZip, LANG_CODE, type Language, type ReadingLevel } from "@/lib/helperLink";

const PRODUCTION = "https://atlas-team12.vercel.app";
const noop = () => () => {};

/** The QR code, drawn on this device as one SVG path. No image service sees the link. */
function QrCode({ text, labelId }: { text: string; labelId: string }) {
  const { d, size } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    const n = qr.getModuleCount(), quiet = 4;
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + quiet},${r + quiet}h1v1h-1z`;
    return { d: path, size: n + quiet * 2 };
  }, [text]);
  return (
    <svg role="img" aria-labelledby={labelId} viewBox={`0 0 ${size} ${size}`} width={208} height={208}
      className="rounded-xl border-2 border-ink bg-white" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={d} fill="#102a43" />
    </svg>
  );
}

export function HelperLinkMaker() {
  // The link points at the site this page is on. The server render uses production; the browser corrects it.
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => PRODUCTION);
  const [language, setLanguage] = useState<Language>("English");
  const [level, setLevel] = useState<ReadingLevel>("simple");
  const [zip, setZip] = useState("");
  const [copied, setCopied] = useState<"" | "link" | "message" | "failed">("");
  const ids = { lang: useId(), level: useId(), zip: useId(), zipHint: useId(), qr: useId(), link: useId() };

  const zipOk = isZip(zip);
  const link = buildHelperLink(origin, { language, level, ...(zipOk ? { zip } : {}) });
  const message = helperSmsText(language, link);

  async function copy(what: "link" | "message") {
    try {
      await navigator.clipboard.writeText(what === "link" ? link : message);
      setCopied(what);
    } catch {
      setCopied("failed");
    }
  }

  const field = "mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5 font-semibold";
  return (
    <div className="card mt-10 p-5 sm:p-8 bg-paper grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
      <form className="grid grid-cols-1 min-w-0 gap-4 content-start" onSubmit={(e) => e.preventDefault()} aria-label="Choices for the link">
        <div>
          <label htmlFor={ids.lang} className="text-sm font-bold">Explain things in</label>
          <select id={ids.lang} className={field} value={language} onChange={(e) => { setLanguage(e.target.value as Language); setCopied(""); }}>
            {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={ids.level} className="text-sm font-bold">Reading level</label>
          <select id={ids.level} className={field} value={level} onChange={(e) => { setLevel(e.target.value as ReadingLevel); setCopied(""); }}>
            {READING_LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={ids.zip} className="text-sm font-bold">Their ZIP (optional)</label>
          <input id={ids.zip} inputMode="numeric" autoComplete="off" maxLength={5} className={field} placeholder="e.g. 30310"
            aria-describedby={ids.zipHint} value={zip} onChange={(e) => { setZip(e.target.value.replace(/\D/g, "").slice(0, 5)); setCopied(""); }} />
          <p id={ids.zipHint} className="mt-1 text-xs font-semibold text-ink/70">
            {zip && !zipOk ? "Type all 5 digits, or leave it empty. The link leaves the ZIP out until then." : "Used to find clinics near them. Leave it empty if you are not sure."}
          </p>
        </div>

        <div>
          <label htmlFor={ids.link} className="text-sm font-bold">The link</label>
          <input id={ids.link} readOnly value={link} onFocus={(e) => e.currentTarget.select()}
            className="mt-1 w-full rounded-xl border-2 border-teal bg-mint-soft p-2.5 font-mono text-sm" />
        </div>
        <div className="flex flex-wrap gap-3 text-sm font-bold">
          <button type="button" onClick={() => copy("link")} className="rounded-full bg-ink text-paper px-5 py-2.5">Copy the link</button>
          <a href={helperSmsHref(message)} className="rounded-full border-2 border-ink px-5 py-2 hover:bg-mint">Send as a text message</a>
          <button type="button" onClick={() => copy("message")} className="rounded-full border-2 border-ink px-5 py-2 hover:bg-mint">Copy the message</button>
        </div>
        <p role="status" className="text-sm font-bold text-teal-deep min-h-5">
          {copied === "link" ? "Link copied." : copied === "message" ? "Message copied." : copied === "failed" ? "This browser would not copy. Press and hold the link above to copy it." : ""}
        </p>
        <div>
          <p className="text-sm font-bold">The text message</p>
          <p lang={LANG_CODE[language]} className="mt-1 rounded-xl border-2 border-ink/20 bg-mint-soft/60 p-3 text-sm font-semibold [overflow-wrap:anywhere]">{message}</p>
        </div>
      </form>

      <figure className="justify-self-center text-center">
        <QrCode text={link} labelId={ids.qr} />
        <figcaption id={ids.qr} className="mt-2 max-w-[13rem] text-sm font-semibold text-ink-soft">
          QR code for the link above. Their phone camera opens it.
        </figcaption>
      </figure>
    </div>
  );
}
