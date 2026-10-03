import type { Metadata } from "next";
import { Nav } from "@/ui/Nav";
import { Footer } from "@/ui/Footer";
import { PAPERS, runCheckerTest } from "@/lib/checkerTest";
import results from "@/data/eval/results.json";
import meaningRaw from "@/data/eval/meaning.json";
import { helperFunnel, liveStats } from "@/lib/db";
import { publicStats, type PublicStats } from "@/lib/publicStats";
import type { Count } from "@/lib/helperFunnel";
import labEvalRaw from "@/data/eval/lab-eval.json";
import labPlantedRaw from "@/data/eval/lab-planted.json";
import type { LabPlantedReport } from "@/lib/labPlanted";
import { deviceParitySet } from "@/lib/deviceParity";
import { DeviceParity } from "@/ui/DeviceParity";
import { PREP_TRUTH, runPrepPlantedTest } from "@/lib/prepPlanted";

type LabTotals = { rows: number; found: number; right: number; false_flags: number; missed_flags: number; dropped: number };
type LabEval = {
  measured_at: string; base_url: string; commit: string; model: string; command: string; reports: number;
  text: { totals: LabTotals & { flags_truth: number; flags_right: number; lines_checked: number; lines_found: number; median_ms: number }; rows: { id: string; rows: { test: string; truth: string; got: string; right: boolean }[] }[] };
  photo: { note: string; totals: LabTotals & { lines_numbers_right: number; lines_exact: number; unreadable_marks: number; median_read_ms: number }; rows: { id: string; rows: { test: string; truth: string; got: string; right: boolean }[] }[] };
};
const labEval = labEvalRaw as unknown as LabEval;
const labPlanted = labPlantedRaw as unknown as LabPlantedReport & { measured_at: string; command: string };

// Typed explicitly: inferring from the JSON breaks when a run has no flags or no misses.
type MeaningEval = {
  checker_model: string; commit: string; base_url: string; command: string;
  totals: { originals: number; false_alarms: number; planted: number; caught: number; caught_by_numbers: number; caught_by_model: number; by_kind: Record<string, { planted: number; caught: number }> };
  rows: { id: string; false_alarms: { id: string; numbers: string[]; why: string }[]; by_kind: { kind: string; flagged: boolean; quote?: string; planted_text?: string }[] }[];
};
const meaning = meaningRaw as unknown as MeaningEval;

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Our tests · ATLAS",
  description: "How well ATLAS reads after-visit papers, measured on labeled sample papers, plus a live test of the quote checker.",
};

const T = results.totals;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
// Live counts arrive through publicStats(): under 10 is "<10", and a count that would give one away is "hidden".
const show = (n: Count) => (typeof n === "number" ? n.toLocaleString("en-US") : n);
// A breakdown leaves out values nobody picked, and none is the same as under 10.
const pick = (m: Record<string, Count>, k: string): Count => m[k] ?? "<10";

function Stat({ big, label, note, tone = "bg-paper" }: { big: string; label: string; note?: string; tone?: string }) {
  return (
    <div className={`card p-6 ${tone}`}>
      <p className="display text-5xl">{big}</p>
      <p className="mt-2 font-bold">{label}</p>
      {note && <p className="mt-1 text-sm font-semibold text-ink-soft">{note}</p>}
    </div>
  );
}

export default async function TestsPage() {
  const c = runCheckerTest();
  const prep = runPrepPlantedTest();
  const [raw, funnel] = await Promise.all([liveStats(), helperFunnel()]);
  const live: PublicStats | null = raw ? publicStats(raw, funnel) : null;
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

        <section className="relative px-3 mt-3" aria-labelledby="device-title">
          <div className="section-card bg-mint px-6 sm:px-12 py-20">
            <span className="chip bg-paper text-teal-deep">Live · runs in your browser · no AI</span>
            <h2 id="device-title" className="display text-[clamp(2rem,4vw,3.6rem)] mt-4 max-w-[18em]">Same checker, server and this browser</h2>
            <p className="mt-4 max-w-[44em] font-semibold text-ink-soft">
              Our server checks every quote with one program. After a read, your browser downloads the same checker (built from Rust as
              WebAssembly) and checks every step again on your own device. Here it runs over all {PAPERS.length} sample papers: every real
              instruction, every non-instruction, and every planted fake from the test above. The server&apos;s answers were computed when this page
              loaded; your browser computes its own and we count how many match.
            </p>
            <DeviceParity set={deviceParitySet()} />
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
              <Stat big={`${T.quiz_questions}/${T.quiz_questions + T.quiz_dropped}`} label="check-I-understood questions kept" note="each answer's proof must be in the paper, inside its own step" tone="bg-mint" />
              <Stat big={sec(T.median_quiz_ms)} label="median time to write the questions" />
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
              Run with <code className="font-mono">{meaning.command}</code> on a {meaning.base_url} of commit {meaning.commit}. Each run reads the papers fresh, so counts move a little between runs. We read every flag on a real explanation:
              {" "}{meaning.rows.flatMap((r) => r.false_alarms).map((f) => f.why).join(" ") || "none."}
            </p>
            {meaning.rows.flatMap((r) => r.by_kind.filter((c) => !c.flagged)).length > 0 && (
              <div className="mt-6 card p-6 bg-paper">
                <p className="font-bold">What it missed</p>
                <ul className="mt-2 text-sm font-semibold list-disc pl-5 space-y-1">
                  {meaning.rows.flatMap((r) => r.by_kind.filter((c) => !c.flagged).map((c, i) => (
                    <li key={`${r.id}-${i}`}>{r.id}, {c.kind}: the paper says &ldquo;{c.quote ?? ""}&rdquo;; the planted explanation said &ldquo;{c.planted_text ?? ""}&rdquo;.</li>
                  )))}
                </ul>
              </div>
            )}
          </div>
        </section>

        <section className="relative px-3 mt-3" aria-labelledby="labs-tests-title">
          <div className="section-card bg-peach px-6 sm:px-12 py-20">
            <span className="chip bg-paper text-peach-deep">Measured runs · lab results</span>
            <h2 id="labs-tests-title" className="display text-[clamp(2rem,4vw,3.6rem)] mt-4 max-w-[18em]">Lab results: does it flag the right lines?</h2>
            <p className="mt-4 max-w-[44em] font-semibold text-ink-soft">
              We wrote {labEval.reports} sample lab reports (no real patients) in different layouts: a blood count, a lipid panel with H and L flags,
              a thyroid panel with ranges only, ranges with &lt; and &gt;=, counts with commas, and tricky lines like a liter &quot;L&quot;. By hand we
              marked each result as high, low, inside its range, or no range. Then we checked what ATLAS showed.
            </p>

            <h3 className="mt-10 text-2xl font-extrabold">Planted mistakes (no AI)</h3>
            <p className="mt-2 max-w-[44em] font-semibold text-ink-soft">
              We took the correct rows and planted the mistakes a wrong AI could make. Our code must leave each one out, or still judge it from what the report prints.
            </p>
            <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <Stat big={`${labPlanted.real.right}/${labPlanted.real.total}`} label="correct rows judged right" />
              <Stat big={`${labPlanted.planted.caught}/${labPlanted.planted.total}`} label="planted mistakes caught" note={`${labPlanted.planted.dropped} left out, ${labPlanted.planted.judged_right} still judged right`} tone="bg-mint" />
            </div>
            <ul className="mt-6 max-w-[50em] space-y-2 text-sm font-semibold">
              {Object.entries(labPlanted.planted.byKind).map(([k, v]) => (
                <li key={k} className="card p-4 bg-paper">
                  <span className="font-extrabold">{k}: {v.caught}/{v.total} caught.</span> For example: {labPlanted.planted.examples[k]}.
                </li>
              ))}
            </ul>
            {labPlanted.planted.slipped.length > 0 && (
              <div className="mt-6 card p-6 bg-red-soft">
                <p className="font-bold">Mistakes that got through:</p>
                <ul className="mt-2 text-sm font-semibold list-disc pl-5">
                  {labPlanted.planted.slipped.map((s, i) => <li key={i}>{s.report}, {s.test}: {s.what} (shown as {s.got}, should be {s.truth})</li>)}
                </ul>
              </div>
            )}
            <p className="mt-4 text-sm font-semibold">Run with <code className="font-mono">{labPlanted.command}</code>. The test suite fails if this file is out of date with the code.</p>

            <h3 className="mt-12 text-2xl font-extrabold">With real AI calls</h3>
            <p className="mt-2 max-w-[44em] font-semibold text-ink-soft">
              Run on {new Date(labEval.measured_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} against a {labEval.base_url} of
              commit {labEval.commit}, model {labEval.model}, with <code className="font-mono">{labEval.command}</code>. These are the numbers from that run, not from this page load.
            </p>
            <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <Stat big={`${labEval.text.totals.right}/${labEval.text.totals.rows}`} label="pasted text: results judged right" tone="bg-mint" />
              <Stat big={`${labEval.text.totals.flags_right}/${labEval.text.totals.flags_truth}`} label="high or low results flagged" />
              <Stat big={`${labEval.text.totals.false_flags}`} label="normal results wrongly flagged" note="lower is better" />
              <Stat big={sec(labEval.text.totals.median_ms)} label="median time per report" />
              <Stat big={`${labEval.photo.totals.lines_numbers_right}/${labEval.photo.totals.rows}`} label="screenshot: lines read with every number right" note={`${labEval.photo.totals.lines_exact} copied character for character`} />
              <Stat big={`${labEval.photo.totals.right}/${labEval.photo.totals.rows}`} label="screenshot: results judged right" note="using the read text with no fixes" tone="bg-mint" />
              <Stat big={sec(labEval.photo.totals.median_read_ms)} label="median time to read a screenshot" />
            </div>
            {[...labEval.text.rows, ...labEval.photo.rows].some((r) => r.rows.some((x) => !x.right)) && (
              <div className="mt-6 card p-6 bg-paper">
                <p className="font-bold">Where it went wrong</p>
                <ul className="mt-2 text-sm font-semibold list-disc pl-5">
                  {labEval.text.rows.flatMap((r) => r.rows.filter((x) => !x.right).map((x) => <li key={`t${r.id}${x.test}`}>Text, {r.id}, {x.test}: shown as {x.got}, should be {x.truth}</li>))}
                  {labEval.photo.rows.flatMap((r) => r.rows.filter((x) => !x.right).map((x) => <li key={`p${r.id}${x.test}`}>Screenshot, {r.id}, {x.test}: shown as {x.got}, should be {x.truth}</li>))}
                </ul>
              </div>
            )}
            <ul className="mt-6 max-w-[46em] space-y-2 text-sm font-semibold list-disc pl-5">
              <li>Our team wrote these reports, so they are cleaner than many real ones. A perfect score here does not mean a perfect score on your report.</li>
              <li>The screenshots are drawn from the sample text, not taken with a camera. A blurry or tilted photo will be harder. That is why you check the text before anything is flagged.</li>
            </ul>
          </div>
        </section>

        <section className="relative px-3 mt-3" aria-labelledby="prep-tests-title">
          <div className="section-card bg-lilac px-6 sm:px-12 py-20">
            <span className="chip bg-paper text-ink">Live · rerun just now · no AI</span>
            <h2 id="prep-tests-title" className="display text-[clamp(2rem,4vw,3.6rem)] mt-4 max-w-[18em]">Prep mode: does every time come from the paper?</h2>
            <p className="mt-4 max-w-[44em] font-semibold text-ink-soft">
              We wrote a sample colonoscopy prep paper (no real patient) and, by hand, the answer a correct AI would give: {PREP_TRUTH.length} steps,
              each with its line from the paper and where a person reading that line would put it, or &quot;ask your clinic&quot; when the line
              doesn&apos;t say when. Then we planted the mistakes a wrong AI could make. These numbers are computed by our code each time this page loads.
            </p>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <Stat big={`${prep.real.right}/${prep.real.total}`} label="correct steps placed right" />
              <Stat big={`${prep.planted.caught}/${prep.planted.total}`} label="planted mistakes caught" tone="bg-mint" />
            </div>
            <ul className="mt-6 max-w-[50em] space-y-2 text-sm font-semibold">
              {Object.entries(prep.planted.byKind).map(([k, v]) => (
                <li key={k} className="card p-4 bg-paper [overflow-wrap:anywhere]">
                  <span className="font-extrabold">{k}: {v.caught}/{v.total} caught.</span> For example: {prep.planted.examples[k]}.
                </li>
              ))}
            </ul>
            {prep.planted.slipped.length > 0 && (
              <div className="mt-6 card p-6 bg-red-soft">
                <p className="font-bold">Mistakes that got through:</p>
                <ul className="mt-2 text-sm font-semibold list-disc pl-5">
                  {prep.planted.slipped.map((s, i) => <li key={i}>{s.kind}: {s.what} (shown as {s.got})</li>)}
                </ul>
              </div>
            )}
            <ul className="mt-6 max-w-[46em] space-y-2 text-sm font-semibold list-disc pl-5">
              <li>This tests our code, not the AI. How well the AI finds every step on a real prep paper has not been measured yet.</li>
              <li>For a reversed explanation (&quot;do not take insulin&quot; explained as &quot;take insulin&quot;), this checks that the explanation stays hidden until the second-model check certifies it, and that the step&apos;s headline is the paper&apos;s own words. Whether that second model notices the reversal needs the AI and is not counted here.</li>
              <li>One sample paper, written by our team, in English. Our time reader knows English time words only, so on a paper in another language every step goes under &quot;ask your clinic&quot;.</li>
            </ul>
          </div>
        </section>

        <section className="relative px-3 mt-3" aria-labelledby="live-title">
          <div className="section-card bg-mint px-6 sm:px-12 py-20">
            <span className="chip bg-paper text-teal-deep">Live · real use on this site · our own tests excluded</span>
            <h2 id="live-title" className="display text-[clamp(2rem,4vw,3.6rem)] mt-4 max-w-[18em]">What happens when people use it</h2>
            <p className="mt-4 max-w-[42em] font-semibold text-ink-soft">
              Counted anonymously from the live site and apps: no paper, no name, no location. Feedback is three taps after a plan.
            </p>
            {live ? (
              <>
                <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
                  <Stat big={show(live.reads)} label="papers read" note={live.median_read_ms ? `median ${sec(live.median_read_ms)}` : undefined} />
                  <Stat big={show(live.plans)} label="plans built" note={live.median_plan_ms ? `median ${sec(live.median_plan_ms)}` : undefined} />
                  <Stat big={show(live.feedback)} label="people told us how it went" note={live.avg_rating ? `average ${live.avg_rating.toFixed(1)} of 5` : undefined} />
                  <Stat big={`${show(pick(live.would_use, "yes"))} of ${show(live.feedback)}`} label="would use it again" note={`${show(pick(live.would_use, "maybe"))} maybe, ${show(pick(live.would_use, "no"))} no`} />
                </div>
                <p className="mt-6 text-sm font-semibold">
                  {Object.keys(live.roles).length ? `Who answered: ${Object.entries(live.roles).map(([k, v]) => `${show(v)} ${k}`).join(", ")}. ` : ""}
                  Counts under 10 show as &lt;10, and a count that would let a small one be worked out by subtracting shows as hidden. Averages from fewer than 10 answers are left out.{" "}
                  {live.since ? `Counting since ${new Date(live.since).toLocaleDateString("en-US", { month: "long", day: "numeric" })}. ` : "Nothing counted yet. "}
                  Raw numbers: <a className="underline decoration-2 underline-offset-4" href="/api/stats">/api/stats</a>.
                </p>
              </>
            ) : (
              <p className="mt-8 card p-6 bg-paper font-semibold">Live numbers are not reachable right now. The tests above still run.</p>
            )}
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
