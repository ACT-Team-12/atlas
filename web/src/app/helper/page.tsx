import type { Metadata } from "next";
import { Nav } from "@/ui/Nav";
import { Footer } from "@/ui/Footer";
import { HelperLinkMaker } from "@/ui/HelperLinkMaker";

export const metadata: Metadata = {
  title: "Make a plan link for someone you help · ATLAS",
  description: "For family, friends, neighbors, community health workers, navigators and nurses: make a link and QR code that opens ATLAS in the right language for the person you help.",
};

/** Every line here describes what the code does (lib/helperLink.ts); change them together. */
export default function HelperPage() {
  return (
    <>
      <Nav />
      <main className="pt-24 px-3">
        <section className="section-card bg-mint-soft px-4 sm:px-12 py-16" aria-labelledby="helper-title">
          <p className="hand text-3xl text-ink-soft -rotate-1 mb-4">for helpers</p>
          <h1 id="helper-title" className="display text-[clamp(2.4rem,5vw,4.6rem)] max-w-[16em]">Make a plan link for someone you help: a patient, a parent, a neighbor</h1>
          <p className="mt-4 max-w-[44em] text-lg font-semibold text-ink-soft">
            Family members can use it too: a son setting it up for his mother counts, the same as a community health worker, navigator
            or nurse. Pick the language, the reading level and the ZIP for the person you are helping. They open the link on their own
            phone and ATLAS starts with those choices. They can change any of them.
          </p>

          <HelperLinkMaker />

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <div className="card p-6 sm:p-8 bg-paper">
              <h2 className="display text-2xl sm:text-3xl">What the link does</h2>
              <div className="mt-3 space-y-3 font-semibold text-ink-soft leading-7">
                <p>It opens ATLAS at &ldquo;Try it&rdquo; with the language, reading level and ZIP already picked, and a short note saying someone helping them set it up. Nothing else changes: they still choose what to share.</p>
                <p>The link has no name, no organization and nothing about the person in it. If any part is wrong or missing, ATLAS just opens normally.</p>
              </div>
            </div>
            <div className="card p-6 sm:p-8 bg-paper">
              <h2 className="display text-2xl sm:text-3xl">We keep nothing about either of you</h2>
              <div className="mt-3 space-y-3 font-semibold text-ink-soft leading-7">
                <p>This page makes the link and the QR code on your device. We do not save what you pick.</p>
                <p>The choices live only in the link itself, after the #, a part of a link that browsers do not send to our server. Once ATLAS has put them into the page, it clears them from the address bar, so they do not linger in the browser history or in a link shared again. When the first plan is built from the link, we add one to an anonymous count of plans built from helper links, and nothing more. The ZIP is used to find nearby clinics, the same as typing it: we do not keep it, and like a typed ZIP it stays only in the person&apos;s own saved plans on their phone until they clear them. <a className="underline decoration-2 underline-offset-4" href="/privacy">Privacy</a>.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
