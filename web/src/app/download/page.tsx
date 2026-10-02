import type { Metadata } from "next";
import { Nav } from "@/ui/Nav";
import { Footer } from "@/ui/Footer";

export const metadata: Metadata = {
  title: "Get the apps · ATLAS",
  description: "Install ATLAS on Android or iPhone. The photo of your paper is read on your phone and never leaves it.",
};

/** One record per published build. Update these together when a new build is uploaded. */
const ANDROID = {
  version: "1.0 (build 1)",
  url: "https://f8xnfpxjjfmtpmft.public.blob.vercel-storage.com/downloads/atlas-android-1.0-87aZVmJdcnnDz8689kBQpUuL4eqHr6.apk",
  sizeMb: 44.8,
  sha256: "5f3516c32b6f970184f247e951ece7f2a1436ea8277cd34e6abfda279aca762d",
  signer: "CN=Stephen Sookra, OU=Team 12, O=ATLAS, Atlanta, Georgia, US",
  signerSha256: "13d702734dde7a7ff0a29fadad8dbb8c3b799c45dddfd9ce83233c4c9d3a8dad",
  minAndroid: "Android 8.0 or newer",
};
const IOS = { testflight: "https://testflight.apple.com/join/fkGdxGm4" };

function Card({ title, qr, qrAlt, children }: { title: string; qr: string; qrAlt: string; children: React.ReactNode }) {
  return (
    <div className="card p-6 sm:p-8 bg-paper grid gap-6 sm:grid-cols-[1fr_auto] items-start">
      <div>
        <h2 className="display text-3xl">{title}</h2>
        <div className="mt-3 space-y-3 font-semibold text-ink-soft leading-7">{children}</div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt={qrAlt} width={168} height={168} className="rounded-xl border-2 border-ink bg-white p-1 justify-self-center" />
    </div>
  );
}

export default function DownloadPage() {
  return (
    <>
      <Nav />
      <main className="pt-24 px-3">
        <section className="section-card bg-mint-soft px-6 sm:px-12 py-16" aria-labelledby="dl-title">
          <p className="hand text-3xl text-ink-soft -rotate-1 mb-4">on your phone</p>
          <h1 id="dl-title" className="display text-[clamp(2.4rem,5vw,4.6rem)] max-w-[14em]">Get the apps</h1>
          <p className="mt-4 max-w-[44em] text-lg font-semibold text-ink-soft">
            The apps do two things the website can&apos;t: they read the photo of your paper on the phone, so it never leaves it,
            and they remind you on the day of a lab or visit with the exact line from your paper. They use the same checked server as this site.
          </p>

          <div className="mt-10 grid gap-5">
            <Card title="Android" qr="/qr-android.svg" qrAlt="QR code to download the ATLAS Android app">
              <p>
                <a className="inline-block rounded-full bg-ink text-paper px-5 py-2.5 font-bold no-underline" href={ANDROID.url} download>
                  Download the APK ({ANDROID.sizeMb} MB)
                </a>
              </p>
              <p>Version {ANDROID.version}, for {ANDROID.minAndroid}. It is not on the Play Store yet, so your phone will ask you to allow installs from your browser. Allow it once, open the file, and tap Install.</p>
              <details className="text-sm">
                <summary className="cursor-pointer font-bold">Check the file before installing</summary>
                <p className="mt-2 break-all">SHA-256: <code className="font-mono">{ANDROID.sha256}</code></p>
                <p className="mt-1 break-all">Signed by {ANDROID.signer}. Certificate SHA-256: <code className="font-mono">{ANDROID.signerSha256}</code></p>
              </details>
            </Card>

            <Card title="iPhone" qr="/qr-ios.svg" qrAlt="QR code to join the ATLAS TestFlight beta">
              <p>
                <a className="inline-block rounded-full bg-ink text-paper px-5 py-2.5 font-bold no-underline" href={IOS.testflight}>Join the TestFlight beta</a>
              </p>
              <p>Install Apple&apos;s free TestFlight app, then open the link. The link opens once Apple finishes reviewing the beta build.</p>
            </Card>
          </div>

          <div className="mt-8 card p-6 bg-paper font-semibold text-ink-soft leading-7">
            <h2 className="display text-2xl text-ink">What the apps send</h2>
            <p className="mt-2">
              Only the text you check and confirm, the help you asked for, a ZIP code or one-time location, and your language. Never the photo.
              On Android, Google&apos;s on-device text reader (ML Kit) sends Google anonymous usage metrics about itself and offers no switch to turn that off.
              Details on the <a className="underline decoration-2 underline-offset-4" href="/privacy">privacy page</a>.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
