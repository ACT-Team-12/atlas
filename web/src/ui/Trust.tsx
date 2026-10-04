import { DATASET } from "@/lib/resources";
import { NATIONAL, nationalPrograms } from "@/lib/national";

/** Server component: data provenance straight from the dataset file, so the page can't drift from the data. */
export function Trust() {
  return (
    <section id="trust" className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="trust-title">
      <div className="section-card bg-lilac px-6 sm:px-12 py-24">
        {/* The section's point leads (a teammate's review, Oct 4): what it is about, big; the line under it, smaller. */}
        <h2 id="trust-title" className="display text-[clamp(2.6rem,5.5vw,5.5rem)]">How we keep it honest</h2>
        <p className="mt-4 text-[clamp(1.35rem,2.4vw,2.1rem)] font-bold leading-snug max-w-[24em]">It shows its work, and it holds back when it can&apos;t.</p>
        <div className="mt-12 grid lg:grid-cols-3 gap-6">
          <div className="card p-6">
            <span className="chip bg-mint text-teal-deep">Grounded</span>
            <p className="mt-3 font-semibold">Every care step must quote your paper word for word. Our own checker (not the AI) confirms the quote is really there. Anything it can&apos;t find is held back to protect you.</p>
          </div>
          <div className="card p-6">
            <span className="chip bg-sky text-sky-deep">Verified</span>
            <p className="mt-3 font-semibold">The AI can only recommend places from our verified list: {DATASET.clinicCount} community health centers and {DATASET.programCount} programs in {DATASET.area}, and outside Atlanta the nearest of {NATIONAL.clinicCount.toLocaleString("en-US")} HRSA health center sites nationwide plus {nationalPrograms().length} federal programs. Phone numbers and addresses come from the record, never from the AI.</p>
          </div>
          <div className="card p-6">
            <span className="chip bg-peach text-peach-deep">Private by default</span>
            <p className="mt-3 font-semibold">No account. Nothing is stored on our side: your paper goes to our server and the AI provider only to be read. Your plan is saved in this browser so you can come back, and you can clear it anytime. ATLAS explains paperwork and is not medical advice.</p>
          </div>
        </div>
        <div className="mt-10 card p-6 bg-paper">
          <p className="font-semibold">Want proof? <a className="underline decoration-2 underline-offset-4 hover:text-teal" href="/tests">See our tests</a>: a live check that our quote checker catches planted fakes, and a measured run on labeled sample papers.</p>
          <p className="display text-2xl mt-6">Data sources (retrieved {DATASET.generatedAt})</p>
          <ul className="mt-4 space-y-2 text-sm font-semibold">
            {DATASET.sources.map((s) => (
              <li key={s.id}>
                <a className="underline decoration-2 underline-offset-4 hover:text-teal" href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
