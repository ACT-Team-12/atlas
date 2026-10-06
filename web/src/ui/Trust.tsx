import { DATASET } from "@/lib/resources";
import { NATIONAL, nationalPrograms } from "@/lib/national";
import { SiteText } from "./SiteLang";

/** Server component: data provenance straight from the dataset file, so the page can't drift from the data. */
export function Trust() {
  return (
    <section id="trust" className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="trust-title">
      <div className="section-card bg-lilac px-6 sm:px-12 py-24">
        {/* The section's point leads (a teammate's review, Oct 4): what it is about, big; the line under it, smaller. */}
        <h2 id="trust-title" className="display text-[clamp(2.6rem,5.5vw,5.5rem)]"><SiteText k="trust.title" /></h2>
        <p className="mt-4 text-[clamp(1.35rem,2.4vw,2.1rem)] font-bold leading-snug max-w-[24em]"><SiteText k="trust.lead" /></p>
        <div className="mt-12 grid lg:grid-cols-3 gap-6">
          <div className="card p-6">
            <span className="chip bg-mint text-teal-deep"><SiteText k="trust.grounded.chip" /></span>
            <p className="mt-3 font-semibold"><SiteText k="trust.grounded" /></p>
          </div>
          <div className="card p-6">
            <span className="chip bg-sky text-sky-deep"><SiteText k="trust.verified.chip" /></span>
            <p className="mt-3 font-semibold"><SiteText k="trust.verified" vars={{ clinics: DATASET.clinicCount, programs: DATASET.programCount, area: DATASET.area, national: NATIONAL.clinicCount.toLocaleString("en-US"), federal: nationalPrograms().length }} /></p>
          </div>
          <div className="card p-6">
            <span className="chip bg-peach text-peach-deep"><SiteText k="trust.private.chip" /></span>
            <p className="mt-3 font-semibold"><SiteText k="trust.private" /></p>
          </div>
        </div>
        <div className="mt-10 card p-6 bg-paper">
          <p className="font-semibold"><SiteText k="trust.proof" /> <a className="underline decoration-2 underline-offset-4 hover:text-teal-deep" href="/tests"><SiteText k="trust.proofLink" /></a><SiteText k="trust.proofRest" /></p>
          <p className="display text-2xl mt-6"><SiteText k="trust.sources" vars={{ date: DATASET.generatedAt }} /></p>
          <ul className="mt-4 space-y-2 text-sm font-semibold">
            {DATASET.sources.map((s) => (
              <li key={s.id} lang="en">
                <a className="underline decoration-2 underline-offset-4 hover:text-teal-deep" href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
