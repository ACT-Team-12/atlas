import type { Metadata } from "next";
import { Nav } from "@/ui/Nav";
import { Footer } from "@/ui/Footer";

export const metadata: Metadata = {
  title: "Privacy · ATLAS",
  description: "What ATLAS does with your visit paper, your location and your plan, on the website and in the mobile apps.",
};

const UPDATED = "October 3, 2026";

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
              <p>If you type a ZIP code or tap Use my location, it is sent once to find nearby health centers for your plan. We do not save it on our side. A ZIP you type stays with that plan in your saved plans on this device until you clear it; a location from Use my location is never stored.</p>
            </Block>
            <Block title="Phone calls (Call me with my plan)">
              <p>Only enter your own number. ATLAS calls only after you type a number and tick the box: first a short call that says a 4-digit code, then, once you type that code, a call that asks for the same code on the keypad before it reads your plan, so voicemail or anyone else who answers hears only &quot;This is ATLAS&quot; and a request for a code, nothing about your plan.</p>
              <p>While your call is in progress, our server holds your number, the plan text and the voice recording of it, all encrypted, plus the last 4 digits of your number in plain text so this page can show which phone it is calling. The calls go through Vonage, our phone provider, which gets your number and plays the call and keeps its own record of it (number, time and length). The natural voice, when it is used, is made by ElevenLabs from your plan text; otherwise Vonage reads it.</p>
              <p>When the call ends, or once a code has gone unused for 10 minutes, your number, plan text and recording are deleted from our database. What is left is only whether the call finished or was missed, with nothing about you, and our cleanup deletes that too. The cleanup runs every 5 minutes. Your number and plan are stored encrypted, and ATLAS refuses to open them after 30 minutes. If a delete fails (for example, our database is down), the cleanup removes them once it can.</p>
              <p>To limit calls, we count them per number and per network for up to 2 days, under a scrambled key that is not your number or address.</p>
            </Block>
            <Block title="What stays on your device">
              <p>Your last checklist and plan are saved in this browser (or in the app) so you can come back to them. Nothing is uploaded when you do that. Clear it from this device removes it, and so does clearing your browser data or deleting the app.</p>
              <p>Reminders you set in the app are stored on your phone only.</p>
              <p>Show on my paper uses only what is already on your device: for a photo, the website downloads a text reader from our own site the first time and reads the photo inside your browser, so the photo is not uploaded again.</p>
            </Block>
            <Block title="What our server keeps">
              <p>To stop abuse, the server counts requests per network address for 10 minutes, in memory only (phone calls are counted separately, see Phone calls). Our host (Vercel) keeps standard request logs such as time, page and network address. If a request fails we log the kind of error, not your paper.</p>
              <p>When you press Read it out loud and the natural voice is used, the server keeps that recording in its memory (never on disk or in a database) so playing it again does not make a new one, until newer recordings push it out or the server restarts. The recording made for a phone call is not kept there; a recording you made with Read it out loud is kept as described here, separately from your call.</p>
              <p>To show how ATLAS is used, we count each read, plan and feedback answer without anything about you: the language, how many steps, how long it took, which kinds of barriers were picked, and your three feedback taps. No paper text, no name, no ZIP or location, no network address, no free text. The totals are public on our tests page.</p>
              <p>Helper links (made at /helper by someone helping you) carry a language, reading level and ZIP only inside the link, after the #, which is not sent to our server; ATLAS clears them from the address bar once it has filled them in, and if you build a plan from one, that plan&apos;s anonymous record (described above) is marked as coming from a helper link, which is how we count plans built from helper links (your browser reports this, so it is a count, not proof).</p>
              <p>We do not sell data, run ads, or add tracking or analytics tools of our own.</p>
              <p>One exception to know about: the Android app reads your paper with Google&apos;s ML Kit, which runs on your phone. Google says ML Kit sends it diagnostics that cannot be turned off: device model and system version, the app version, an installation identifier, how long reading took, and the image size. Google&apos;s list does not include the photo or the words on it (<a className="underline decoration-2 underline-offset-4" href="https://developers.google.com/ml-kit/android-data-disclosure" target="_blank" rel="noreferrer">ML Kit data disclosure</a>). The iPhone app uses Apple&apos;s built-in reading and sends nothing extra.</p>
            </Block>
            <Block title="It is not medical advice">
              <p>ATLAS explains your paper and helps you plan around what gets in the way. It does not diagnose or change your care. Check with your doctor or clinic before changing anything, and if you have a warning sign from your paper, call your clinic or 911.</p>
            </Block>
            <Block title="Questions or deletion">
              <p>We do not keep your paper or plan, except while a phone call you asked for is in progress: then the plan is stored encrypted, ATLAS refuses to open it after 30 minutes, and it is deleted when the call ends. So there is nothing on our side to delete. Your saved plan is removed with Clear it from this device. Questions: reach Team 12 through the ATL Innovation Cup organizers.</p>
            </Block>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
