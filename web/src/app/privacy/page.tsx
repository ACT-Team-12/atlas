import type { Metadata } from "next";
import { Nav } from "@/ui/Nav";
import { Footer } from "@/ui/Footer";
import { sttProvider } from "@/lib/transcribe";
import { aiProvider } from "@/lib/extract";

export const metadata: Metadata = {
  title: "Privacy · ATLAS",
  description: "What ATLAS does with your visit paper, your location and your plan, on the website and in the mobile apps.",
};

const UPDATED = "October 7, 2026";
// Rendered per request so the speech-to-text paragraph always names the service this deployment uses right now.
export const dynamic = "force-dynamic";

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
  const stt = sttProvider(); // names the speech-to-text service this deployment actually uses
  const ai = aiProvider();
  const aiDestination = ai === "openrouter"
    ? "OpenRouter, which routes it to a provider running Anthropic's Claude model"
    : "Anthropic, the company whose AI model reads it";
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
              <p>When you press Read my paper, the text (or the photo, on the website) goes to our server and to {aiDestination}. We use it only to build your checklist and send it back.</p>
              {ai === "openrouter" ? (
                <p>We do not save your paper on our side. OpenRouter sends it to the model provider. Retention and training policies depend on the provider and account settings; we have not verified zero data retention for this route. See <a className="underline decoration-2 underline-offset-4" href="https://openrouter.ai/docs/guides/privacy/provider-logging" target="_blank" rel="noreferrer">OpenRouter provider policies</a> and <a className="underline decoration-2 underline-offset-4" href="https://openrouter.ai/privacy/" target="_blank" rel="noreferrer">OpenRouter privacy policy</a>.</p>
              ) : (
                <p>We do not save your paper on our side. Anthropic says that by default it does not use inputs or outputs from its API to train its models (<a className="underline decoration-2 underline-offset-4" href="https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training" target="_blank" rel="noreferrer">Anthropic privacy center</a>).</p>
              )}
              <p>In the ATLAS phone apps, the photo is read on your phone and never leaves it. Only the text you check and confirm is sent.</p>
            </Block>
            <Block title="Asking your paper a question">
              <p>When you press Ask my paper, your question and the text of your paper go to our server and to {aiDestination}, so the AI model can point to the words in your paper that answer it. Our own checker then makes sure those words are really in your paper before anything is shown. If they are not, you see &quot;Your paper doesn&apos;t say&quot; instead.</p>
              {ai === "openrouter" && <p>OpenRouter and the model provider also receive your question. Their retention and training policies depend on the provider and account settings; we have not verified zero data retention for this route.</p>}
              <p>We do not save your question or your paper. To stay within budget, our database counts how many questions the whole site answers each day: only the day and the count, nothing about you, your question or your network address. A question our own check recognizes as an emergency (for example chest pain or trouble breathing) is never sent; it gets 911 and 211 guidance instead.</p>
            </Block>
            <Block title="Saying your answer out loud">
              <p>In Check I understood, you can tap Say your answer instead of typing or tapping. Only then, and only while you record (up to 20 seconds), the recording is sent to a speech-to-text service to turn it into words. The words come back to your screen so you can fix them before you check your answer. If you never tap Say your answer, nothing is recorded.</p>
              <p>To keep this fair and within budget, our database counts seconds of speaking per hour and per day, for the whole site and for each visitor. A visitor is counted by a keyed hash: a scrambled code made from the network address with a secret key, never the address itself. An hourly cleanup deletes any count older than two days, and every use of Say your answer also deletes counts that have expired. If the hourly cleanup stops running, Say your answer switches itself off within three hours, so no new counts are made.</p>
              {stt === "deepgram" && (
                <p>Right now that service is Deepgram. ATLAS does not store the recording or the words, and we do not log them. On every request we set Deepgram&apos;s Model Improvement Program opt-out, and Deepgram says opted-out data is kept only as long as it takes to process the request (<a className="underline decoration-2 underline-offset-4" href="https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program" target="_blank" rel="noreferrer">Deepgram model improvement program</a>).</p>
              )}
              {stt === "gateway" && (
                <p>Right now that service is xAI&apos;s speech-to-text model, reached through Vercel AI Gateway. ATLAS does not store the recording or the words, and we do not log them. We tell the gateway to use only providers with a zero data retention agreement that do not train on what we send.</p>
              )}
              {stt === null && <p>This is switched off right now, so no recording is ever sent.</p>}
            </Block>
            <Block title="Your location">
              <p>If you type a ZIP code or tap Use my location, it is sent once to find nearby health centers for your plan. We do not save it on our side. A ZIP you type stays with that plan in your saved plans on this device until you clear it; a location from Use my location is never stored.</p>
            </Block>
            <Block title="Phone calls (Call me with my plan)">
              <p>Only enter your own number. ATLAS calls only after you type a number and tick the box: first a short call that says a 4-digit code, then, once you type that code, a call that asks for the same code on the keypad before it reads your plan, so voicemail or anyone else who answers hears only &quot;This is ATLAS&quot; and a request for a code, nothing about your plan.</p>
              <p>While your call is in progress, our server holds your number, the plan text and the voice recording of it, all encrypted, plus the last 4 digits of your number in plain text so this page can show which phone it is calling. The calls go through Vonage, our phone provider, which gets your number and plays the call and keeps its own record of it (number, time and length). The natural voice, when it is used, is made by ElevenLabs from your plan text; otherwise Vonage reads it.</p>
              <p>When the call ends, or once a code has gone unused for 10 minutes, your number, plan text and recording are deleted from our database. What is left is only whether the call finished or was missed, with nothing about you, and our cleanup deletes that too. The cleanup runs every 5 minutes. Your number and plan are stored encrypted, and ATLAS refuses to open them after 30 minutes. If a delete fails (for example, our database is down), the cleanup removes them once it can. If Vonage tells us a call ended but cannot yet confirm it, the cleanup asks Vonage again each time it runs and deletes them as soon as Vonage confirms the call has ended.</p>
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
              <p>We do not keep your paper or your plan, except while a phone call you asked for is in progress: then the plan is stored encrypted, ATLAS refuses to open it after 30 minutes, and it is deleted when the call ends. The only thing we keep about each visitor for Say your answer is the usage counter described above, made from a keyed hash, never the network address. It is deleted automatically once it is two days old: the hourly cleanup deletes it, and every use of Say your answer also deletes counts that have expired.</p>
              <p>Your saved plan is removed with Clear it from this device. Questions: ask the ATL Innovation Cup organizers to reach Team 12.</p>
            </Block>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
