import type { Metadata } from "next";
import { Nav } from "@/ui/Nav";
import { Footer } from "@/ui/Footer";
import results from "@/data/eval/results.json";
import meaning from "@/data/eval/meaning.json";
import { DATASET } from "@/lib/resources";
import { NATIONAL } from "@/lib/national";
import { liveStats } from "@/lib/db";

export const metadata: Metadata = {
  title: "For judges · ATLAS",
  description: "A three-minute tour of ATLAS: what to click, what to look for, and where every number comes from.",
};
export const dynamic = "force-dynamic";

const TESTFLIGHT = "https://testflight.apple.com/join/fkGdxGm4";

function Stop({ n, min, title, href, cta, children }: { n: number; min: string; title: string; href: string; cta: string; children: React.ReactNode }) {
  return (
    <li className="card p-6 sm:p-8 bg-paper">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-full border-2 border-ink font-extrabold bg-sun">{n}</span>
        <h2 className="display text-2xl sm:text-3xl">{title}</h2>
        <span className="chip bg-mint text-teal-deep">{min}</span>
      </div>
      <div className="mt-3 space-y-2 font-semibold text-ink-soft leading-7">{children}</div>
      <a href={href} className="mt-4 inline-block rounded-full bg-ink text-paper px-5 py-2.5 font-bold">{cta}</a>
    </li>
  );
}

/** Every number on this page is read from the committed eval files or the live database, not typed in. */
export default async function JudgePage() {
  const T = results.totals;
  const M = meaning.totals;
  const live = await liveStats();
  return (
    <>
      <Nav />
      <main className="pt-24 px-3">
        <section className="section-card bg-sky/40 px-6 sm:px-12 py-16" aria-labelledby="judge-title">
          <p className="hand text-3xl text-ink-soft -rotate-1 mb-4">three minutes</p>
          <h1 id="judge-title" className="display text-[clamp(2.4rem,5vw,4.6rem)] max-w-[14em]">For judges</h1>
          <p className="mt-4 max-w-[44em] text-lg font-semibold text-ink-soft">
            ATLAS turns a clinic&apos;s after-visit paper into steps a person understands and can finish. Every step quotes the paper,
            the person&apos;s understanding is checked, and help comes only from verified Atlanta programs. No account, no sign-in. Here is what to click.
          </p>

          <ol className="mt-10 grid gap-5">
            <Stop n={1} min="1 min" title="Read a paper" href="/#try" cta="Open the tool">
              <p>Press <b>Use the sample paper</b>, then <b>Read my paper</b>. The sample is written by our team, not a real patient.</p>
              <p>Look for: every step shows the exact line it came from, highlighted in the paper. A second AI double-checks each explanation against its line.</p>
            </Stop>
            <Stop n={2} min="30 sec" title="Check I understood" href="/#try" cta="Open the tool">
              <p>Press <b>Quiz me on my paper</b> and answer one wrong on purpose. ATLAS shows the line from the paper again. Each right answer is proven by words inside that same step, checked by our code.</p>
            </Stop>
            <Stop n={3} min="1 min" title="Make a plan around a barrier" href="/#try" cta="Open the tool">
              <p>Pick <b>Getting there</b> or <b>Time off work</b>, type ZIP <b>30310</b>, press <b>Make my plan</b>. Each step points to a verified clinic or program with its source, the nearest MARTA stop, and a call button.</p>
              <p>Try another language in step 1: the plan comes back in Spanish, Vietnamese, Amharic and more.</p>
            </Stop>
            <Stop n={4} min="30 sec" title="See the proof" href="/tests" cta="Our tests">
              <p>
                On labeled sample papers: <b>{T.found}/{T.expected}</b> instructions found and quoted, <b>{T.quiz_questions - T.quiz_dropped}/{T.quiz_questions}</b> quiz questions kept,
                {" "}<b>{M.caught}/{M.planted}</b> planted meaning mistakes caught, <b>{T.plan_dropped_refs}</b> made-up resources shown.
                The quote checker also runs live on that page every time it loads.
              </p>
              <p>
                Real use, counted anonymously (our own tests excluded):{" "}
                {live ? <><b>{live.reads}</b> papers read, <b>{live.plans}</b> plans, <b>{live.feedback}</b> feedback answers so far. Raw: <a className="underline decoration-2 underline-offset-4" href="/api/stats">/api/stats</a>.</> : "not reachable right now."}
              </p>
            </Stop>
          </ol>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <div className="card p-6 bg-paper">
              <h2 className="display text-2xl">Phone apps</h2>
              <p className="mt-2 font-semibold text-ink-soft">Native iOS (SwiftUI) and Android (Kotlin). The photo of the paper is read on the phone and never uploaded, and reminders quote the paper.</p>
              <p className="mt-2 font-semibold text-ink-soft">
                <a className="underline decoration-2 underline-offset-4" href="/download">Android APK and QR codes</a> · iOS: <a className="underline decoration-2 underline-offset-4" href={TESTFLIGHT}>TestFlight link</a> (opens once Apple finishes beta review).
              </p>
            </div>
            <div className="card p-6 bg-paper">
              <h2 className="display text-2xl">What the AI does, and what our code does</h2>
              <p className="mt-2 font-semibold text-ink-soft">The AI reads, explains in 7 languages, writes quiz questions and plans. Our code decides what is shown: quotes must be in the paper, resources must be on our verified list of {DATASET.clinicCount} Atlanta health centers and {DATASET.programCount} programs, or outside Atlanta the {NATIONAL.clinicCount.toLocaleString("en-US")} HRSA sites nationwide.</p>
            </div>
            <div className="card p-6 bg-paper">
              <h2 className="display text-2xl">What we don&apos;t claim</h2>
              <p className="mt-2 font-semibold text-ink-soft">It is not medical advice. Our sample papers, tests and evals contain no real patient records. A paper someone pastes is sent to build their plan and is not stored by us. Clinic hours come from each clinic&apos;s own site where we could confirm them, otherwise a public listing to confirm by phone. <a className="underline decoration-2 underline-offset-4" href="/privacy">Privacy</a>.</p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
