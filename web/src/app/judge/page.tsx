import type { Metadata } from "next";
import { Nav } from "@/ui/Nav";
import { Footer } from "@/ui/Footer";
import results from "@/data/eval/results.json";
import meaning from "@/data/eval/meaning.json";
import { DATASET } from "@/lib/resources";
import { NATIONAL } from "@/lib/national";
import { helperFunnel, liveStats } from "@/lib/db";
import type { Count, HelperFunnelResult } from "@/lib/helperFunnel";
import { publicStats } from "@/lib/publicStats";

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

const show = (n: Count) => (typeof n === "number" ? n.toLocaleString("en-US") : n);

/** Plans from helper links vs all plans. Counts under 10 arrive already hidden as "<10" (lib/helperFunnel.ts). */
function HelperFunnelCard({ result }: { result: HelperFunnelResult }) {
  return (
    <section className="mt-10 card p-6 sm:p-8 bg-paper" aria-labelledby="helper-funnel-title">
      <h2 id="helper-funnel-title" className="display text-2xl sm:text-3xl">Helper links: how people arrive</h2>
      <p className="mt-2 font-semibold text-ink-soft">
        A helper, like a community health worker, makes a link at <a className="underline decoration-2 underline-offset-4" href="/helper">/helper</a> for
        someone they help. This counts the plans built after opening one, out of all plans.
      </p>
      {result.available ? (
        <>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {([["Last 7 days", result.funnel.last_7_days], ["All time", result.funnel.all_time]] as const).map(([label, c]) => (
              <div key={label} className="rounded-2xl border-2 border-ink p-4">
                <dt className="font-bold text-ink-soft">{label}</dt>
                <dd className="mt-1 text-lg font-semibold"><b className="text-2xl">{show(c.helper_link_plans)}</b> of {show(c.all_plans)} plans came from a helper link</dd>
              </div>
            ))}
          </dl>
          {result.funnel.by_language.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left font-semibold text-ink-soft">
                <caption className="sr-only">Plans from helper links by language</caption>
                <thead>
                  <tr className="border-b-2 border-ink">
                    <th scope="col" className="py-2 pr-4">Language</th>
                    <th scope="col" className="py-2 pr-4">Last 7 days (helper / all)</th>
                    <th scope="col" className="py-2">All time (helper / all)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.funnel.by_language.map((r) => (
                    <tr key={r.language} className="border-b border-ink/20">
                      <th scope="row" className="py-2 pr-4 font-bold text-ink">{r.language}</th>
                      <td className="py-2 pr-4">{show(r.last_7_days.helper_link_plans)} / {show(r.last_7_days.all_plans)}</td>
                      <td className="py-2">{show(r.all_time.helper_link_plans)} / {show(r.all_time.all_plans)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-lg font-bold">Not available yet.</p>
      )}
      <p className="mt-4 text-sm font-semibold text-ink-soft">
        Honest note: these counts are reported by the person&apos;s browser, not proven, and exclude our own test runs and preview sites.
        Any number under 10 shows as &lt;10, languages with fewer than 10 plans are grouped together, and a number marked hidden is 10 or more
        but would let a number under 10 be worked out by subtracting (from the total, from all plans, or from all time), so no small group can be picked out.
        No ZIP or location is ever kept.
      </p>
    </section>
  );
}

/** Every number on this page is read from the committed eval files or the live database, not typed in. */
export default async function JudgePage() {
  const T = results.totals;
  const M = meaning.totals;
  const [raw, funnel] = await Promise.all([liveStats(), helperFunnel()]);
  const live = raw ? publicStats(raw, funnel) : null;
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
                {live ? <><b>{show(live.reads)}</b> papers read, <b>{show(live.plans)}</b> plans, <b>{show(live.feedback)}</b> feedback answers so far. Raw: <a className="underline decoration-2 underline-offset-4" href="/api/stats">/api/stats</a>.</> : "not reachable right now."}
              </p>
            </Stop>
          </ol>

          <HelperFunnelCard result={funnel} />

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
