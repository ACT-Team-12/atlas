import type { Metadata } from "next";
import { Nav } from "@/ui/Nav";
import { Footer } from "@/ui/Footer";

export const metadata: Metadata = {
  title: "Privacy · ATLAS",
  description: "What ATLAS does with your visit paper, your location and your plan, on the website and in the mobile apps.",
};

const UPDATED = "October 2, 2026";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6 sm:p-8 bg-paper">
      <h2 className="display text-2xl sm:text-3xl">{title}</h2>
      <div className="mt-3 space-y-3 font-semibold text-ink-soft leading-7">{children}</div>
    </div>
  );
}

/** Every line here describes what the code actually does; change the code and this page together. */
export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <main className="pt-24 px-3">
        <section className="section-card bg-mint-soft px-6 sm:px-12 py-16" aria-labelledby="privacy-title">
          <p className="hand text-3xl text-ink-soft -rotate-1 mb-4">plain words</p>
          <h1 id="privacy-title" className="display text-[clamp(2.4rem,5vw,4.6rem)] max-w-[14em]">Privacy</h1>
          <p className="mt-4 max-w-[44em] text-lg font-semibold text-ink-soft">
            ATLAS is a student project by Team 12 in the ATL Innovation Cup 2026. There is no account and no sign-in. Updated {UPDATED}.
          </p>
          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            <Block title="Your visit paper">
              <p>When you press Read my paper, the text (or the photo, on the website) goes to our server and to Anthropic, the company whose AI model reads it. We use it only to build your checklist and send it back.</p>
              <p>We do not save your paper on our side. Anthropic says that by default it does not use inputs or outputs from its API to train its models (<a className="underline decoration-2 underline-offset-4" href="https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training" target="_blank" rel="noreferrer">Anthropic privacy center</a>).</p>
              <p>In the ATLAS phone apps, the photo is read on your phone and never leaves it. Only the text you check and confirm is sent.</p>
            </Block>
            <Block title="Your location">
              <p>If you type a ZIP code or tap Use my location, it is sent once to find nearby health centers for your plan. We do not save it, and it is never stored on your device.</p>
            </Block>
            <Block title="What stays on your device">
              <p>Your last checklist and plan are saved in this browser (or in the app) so you can come back to them. Nothing is uploaded when you do that. Clear it from this device removes it, and so does clearing your browser data or deleting the app.</p>
              <p>Reminders you set in the app are stored on your phone only.</p>
            </Block>
            <Block title="What our server keeps">
              <p>To stop abuse, the server counts requests per network address for 10 minutes, in memory only. Our host (Vercel) keeps standard request logs such as time, page and network address. If a request fails we log the kind of error, not your paper.</p>
              <p>We do not sell data, run ads, or use tracking or analytics tools.</p>
            </Block>
            <Block title="It is not medical advice">
              <p>ATLAS explains your paper and helps you plan around what gets in the way. It does not diagnose or change your care. Check with your doctor or clinic before changing anything, and if you have a warning sign from your paper, call your clinic or 911.</p>
            </Block>
            <Block title="Questions or deletion">
              <p>Because we do not keep your paper or plan, there is nothing on our side to delete. Your saved plan is removed with Clear it from this device. Questions: open an issue at <a className="underline decoration-2 underline-offset-4" href="https://github.com/ACT-Team-12/atlas/issues" target="_blank" rel="noreferrer">github.com/ACT-Team-12/atlas</a>.</p>
            </Block>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
