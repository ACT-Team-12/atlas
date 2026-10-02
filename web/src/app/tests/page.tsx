import type { Metadata } from "next";
import { Nav } from "@/ui/Nav";
import { Footer } from "@/ui/Footer";
import { PAPERS, runCheckerTest } from "@/lib/checkerTest";
import results from "@/data/eval/results.json";
import meaning from "@/data/eval/meaning.json";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Our tests · ATLAS",
  description: "How well ATLAS reads after-visit papers, measured on labeled sample papers, plus a live test of the quote checker.",
};

const T = results.totals;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function Stat({ big, label, note, tone = "bg-paper" }: { big: string; label: string; note?: string; tone?: string }) {
  return (
    <div className={`card p-6 ${tone}`}>
      <p className="display text-5xl">{big}</p>
      <p className="mt-2 font-bold">{label}</p>
      {note && <p className="mt-1 text-sm font-semibold text-ink-soft">{note}</p>}
    </div>
  );
}

export default function TestsPage() {
  const c = runCheckerTest();
  const promoted = results.rows.flatMap((r) => r.distractors_promoted.map((d) => ({ id: r.id, d })));
  const missed = results.rows.flatMap((r) => r.missed.map((m) => ({ id: r.id, m })));
  return (
    <>
      <Nav />
      <main className="pt-24">
        <section className="relative px-3" aria-labelledby="tests-title">
          <div className="section-card bg-mint-soft px-6 sm:px-12 py-20">
            <p className="hand text-3xl text-ink-soft -rotate-1 mb-5">check our work</p>
            <h1 id="tests-title" className="display text-[clamp(2.4rem,5vw,5rem)] max-w-[15em]">Our tests, in the open.</h1>
            <p className="mt-6 max-w-[42em] text-lg font-semibold text-ink-soft">
              We wrote {PAPERS.length} sample after-visit papers (no real patients) and marked, by hand, every instruction a correct reading has to
              find, plus lines that are not instructions. Below is what ATLAS actually did with them, and a test of our quote checker that runs
              again every time this page loads.
            </p>
          </div>
        </section>

        <section className="relative px-3 mt-3" aria-labelledby="checker-title">
          <div className="section-card bg-sky px-6 sm:px-12 py-20">
            <span className="chip bg-paper text-sky-deep">Live · rerun just now · no AI</span>
            <h2 id="checker-title" className="display text-[clamp(2rem,4vw,3.6rem)] mt-4 max-w-[18em]">Does the quote checker catch fakes?</h2>
            <p className="mt-4 max-w-[42em] font-semibold text-ink-soft">
              Every care step has to quote the paper word for word. We feed the checker each real instruction, then planted fakes made from them:
              a changed number, a swapped word (morning to evening), a flipped meaning (&quot;Do not ...&quot;), and invented instructions.
            </p>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <Stat big={`${c.real.accepted}/${c.real.total}`} label="real instructions accepted" />
              <Stat big={`${c.fakes.caught}/${c.fakes.total}`} label="planted fakes caught" tone="bg-mint" />
              {Object.entries(c.fakes.byKind).map(([k, v]) => (
                <Stat key={k} big={`${v.caught}/${v.total}`} label={k} />
              ))}
            </div>
            {c.fakes.slipped.length > 0 && (
              <div className="mt-6 card p-6 bg-red-soft">
                <p className="font-bold">Fakes that got through:</p>
                <ul className="mt-2 text-sm font-semibold list-disc pl-5">
                  {c.fakes.slipped.map((s, i) => <li key={i}>{s.paper}: {s.text} ({s.kind})</li>)}
                </ul>
              </div>
            )}
            <p className="mt-6 text-sm font-semibold">
              Raw numbers: <a className="underline decoration-2 underline-offset-4" href="/api/checker">/api/checker</a> (free, no key, recomputed on every request).
            </p>
          </div>
        </section>

        <section className="relative px-3 mt-3" aria-labelledby="ai-title">
          <div className="section-card bg-peach px-6 sm:px-12 py-20">
            <span className="chip bg-paper text-peach-deep">Measured run · real AI calls</span>
            <h2 id="ai-title" className="display text-[clamp(2rem,4vw,3.6rem)] mt-4 max-w-[18em]">How well does it read the paper?</h2>
            <p className="mt-4 max-w-[42em] font-semibold text-ink-soft">
              Run on {new Date(results.measured_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} against a{" "}
              {results.base_url} of commit {results.commit}, model {results.model}, with <code className="font-mono">{results.command}</code>.
              These are the numbers from that run, not from this page load.
            </p>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <Stat big={`${T.found}/${T.expected}`} label="instructions found" note={pct(T.found, T.expected)} tone="bg-mint" />
              <Stat big={`${T.grounded}/${T.extracted}`} label="steps that quote the paper" note={`${T.held_back} held back by the checker`} />
              <Stat big={`${T.distractors_promoted}/${T.distractors}`} label="non-instructions turned into steps" note="lower is better" />
              <Stat big={`${T.warnings_matched}/${results.papers}`} label="warning signs flagged correctly" />
              <Stat big={`${T.plan_dropped_refs}`} label="made-up clinic or step references" note={`across ${T.plan_steps} plan steps`} tone="bg-mint" />
              <Stat big={sec(T.median_read_ms)} label="median time to read a paper" />
              <Stat big={sec(T.median_plan_ms)} label="median time to build a plan" note="for a ride and cost barrier, ZIP 30303" />
              <Stat big="Pending" label="time with paper and pen alone" note="our non-AI baseline, timed in Mission 3 user tests. Not measured yet." tone="bg-lilac" />
            </div>
            {(promoted.length > 0 || missed.length > 0) && (
              <div className="mt-6 card p-6 bg-paper">
                <p className="font-bold">Where it went wrong</p>
                <ul className="mt-2 text-sm font-semibold list-disc pl-5 space-y-1">
                  {missed.map((x, i) => <li key={`m${i}`}>Missed in {x.id}: &quot;{x.m}&quot;</li>)}
                  {promoted.map((x, i) => (
                    <li key={`p${i}`}>In {x.id}, &quot;{x.d}&quot; became a step. It records something already done, so it is not an instruction.</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        <section className="relative px-3 mt-3" aria-labelledby="meaning-title">
          <div className="section-card bg-lilac px-6 sm:px-12 py-20">
            <span className="chip bg-paper text-ink">Measured run · a second AI checks the first</span>
            <h2 id="meaning-title" className="display text-[clamp(2rem,4vw,3.6rem)] mt-4 max-w-[18em]">Does the explanation say what the paper says?</h2>
            <p className="mt-4 max-w-[44em] font-semibold text-ink-soft">
              The quote checker proves a line is in your paper. It cannot prove the plain-language explanation next to it means the same thing.
              So a different model ({meaning.checker_model}) compares them, and our own code checks that every number in the explanation is in the line.
              To test it, we planted mistakes into real explanations: a changed number, a swapped time word, start and stop reversed.
            </p>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <Stat big={`${meaning.totals.caught}/${meaning.totals.planted}`} label="planted mistakes caught" tone="bg-mint" />
              {Object.entries(meaning.totals.by_kind).map(([k, v]) => (
                <Stat key={k} big={`${v.caught}/${v.planted}`} label={k} />
              ))}
              <Stat big={`${meaning.totals.false_alarms}/${meaning.totals.originals}`} label="real explanations flagged" note="lower is better; we read each one" />
              <Stat big={`${meaning.totals.caught_by_numbers}/${meaning.totals.planted}`} label="caught by the number check alone" note="no AI involved" />
            </div>
            <p className="mt-6 max-w-[46em] text-sm font-semibold text-ink-soft">
              Run with <code className="font-mono">{meaning.command}</code> on a {meaning.base_url} of commit {meaning.commit}. We read every flag on a real explanation:
              {" "}{meaning.rows.flatMap((r) => r.false_alarms).map((f) => f.why).join(" ") || "none."}
            </p>
          </div>
        </section>

        <section className="relative px-3 mt-3" aria-labelledby="limits-title">
          <div className="section-card bg-lilac px-6 sm:px-12 py-20">
            <h2 id="limits-title" className="display text-[clamp(2rem,4vw,3.6rem)] max-w-[18em]">What these tests don&apos;t prove</h2>
            <ul className="mt-6 max-w-[46em] space-y-3 font-semibold list-disc pl-5">
              <li>Six papers is a small set, and our team wrote them. Real papers are messier. We are collecting public sample formats next.</li>
              <li>For a photo, the quote is checked against the AI&apos;s own reading of the photo. We added a step where you can fix that reading before the plan is built.</li>
              <li>The checker proves a quote is in the paper. It does not prove the plain-language explanation is right, so the original line is always shown next to it.</li>
              <li>No test here shows patients do better with ATLAS. That is what our customer research is for.</li>
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
