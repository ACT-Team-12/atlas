import evalPapers from "@/data/eval/papers.json";
import { shield, type PhiKind } from "./phiShield";

/**
 * The planted-identifier test for the PHI shield (shown live on /tests, run in CI with a floor).
 *
 * Each of the 6 sample eval papers (no real patients) gets made-up identifiers planted where real papers put them: a
 * header in one of six layouts (labels with colons, bars, a header table, all caps, "Born", "Medical Record #"...), the
 * first name inside an instruction ("Maria, take ..."), and "Ms. Lopez" in a sentence. It also gets things that must
 * NOT be hidden: the clinic's name, the doctor's name, the clinic's phone, a visit date, and every instruction a
 * correct reading must find (the paper's `expected` lines), plus any phone number already on the paper.
 *
 * Three numbers, all measured by running the shield, never claimed:
 *  - caught: planted identifiers whose every character was hidden (a half-hidden one counts as missed);
 *  - false hides: hidden stretches that cover anything that is not a planted identifier;
 *  - kept: protected words with no hidden character in them.
 */

type Mark = { kind: PhiKind; value: string; start: number; end: number };
type Keep = { why: string; value: string; start: number; end: number };
export type PlantedPaper = { id: string; text: string; planted: Mark[]; keep: Keep[] };

/**
 * `swap` replaces the paper's own "Sample Patient" / "Sample Child" line text; `extra` is one more body line. Both hold
 * the hard cases, planted on purpose where text rules are weak: a name with no label that differs from the labeled one
 * (a child on a parent's paper), a caregiver named only in a sentence, and an emergency contact's unlabeled phone.
 */
type Person = { header: string; first: string; title: string; last: string; swap?: [string, string]; extra?: string };

// Made-up people and numbers. {{KIND|value}} marks a planted identifier.
const PEOPLE: Person[] = [
  {
    header: "Patient: {{NAME|Maria Lopez}}   DOB: {{DOB|04/12/1961}}   MRN: {{MRN|88412907}}\nPhone: {{PHONE|(404) 555-0182}}\nAddress: {{ADDR|1427 Pine St NW, Atlanta, GA 30318}}\nEmail: {{EMAIL|maria.lopez@example.com}}",
    first: "Maria", title: "Ms.", last: "Lopez",
    swap: ["Sample Patient", "{{NAME|Maria Lopez}}"], // the paper's own unlabeled name slot, same name as the label
  },
  {
    header: "Name: {{NAME|Carter, James}}  |  Date of Birth: {{DOB|March 3, 1948}}  |  Acct #: {{ACCT|55120934}}\nMember ID: {{ID|XJH448219077}}\nHome phone: {{PHONE|404-555-0119}}",
    first: "James", title: "Mr.", last: "Carter",
    swap: ["Sample Child", "{{NAME|Jayden Carter}}"], // hard: the child's first name appears nowhere labeled
  },
  {
    header: "PATIENT NAME: {{NAME|ANA RUIZ}}\nD.O.B. {{DOB|1932-07-21}}\nSSN: {{SSN|123-45-6789}}\nAge: {{AGE|94}}",
    first: "Ana", title: "Mrs.", last: "Ruiz",
    extra: "Your son {{NAME|Miguel}} can help you keep the blood pressure log.", // hard: a caregiver named only here
  },
  {
    header: "Name            DOB          MRN\n{{NAME|Terrence Hill}}   {{DOB|07/30/1955}}   {{MRN|00417733}}\nCell: {{PHONE|(470) 555-0101}}\nEmergency contact: {{NAME|Rhonda Hill}} {{PHONE|404-555-0144}}",
    first: "Terrence", title: "Mr.", last: "Hill", // hard: the contact's phone has no label of its own
  },
  {
    header: "Pt Name: {{NAME|Linh Nguyen}}   Born {{DOB|9/2/1940}}   Medical Record #: {{MRN|A1209938}}\nInsurance ID: {{ID|GA-0098-1123}}\nPatient address: {{ADDR|55 Oak Ave, Decatur GA 30030}}",
    first: "Linh", title: "Ms.", last: "Nguyen",
  },
  {
    header: "Patient: {{NAME|Grace Okafor}}\nDate of birth: {{DOB|12 Jan 1952}}\nMember #: {{ID|HMO44812-01}}\nPhone: {{PHONE|404.555.0177}}\nE-mail: {{EMAIL|g.okafor@mail.example}}",
    first: "Grace", title: "Ms.", last: "Okafor",
  },
];

/**
 * One more labeled line per paper (a second record on the same paper, e.g. a child or a prior visit) in the formats a
 * security review listed: "Pt:", "Patient Name -", ALL CAPS, a middle initial, hyphen and apostrophe names, accents,
 * and birth dates as 01/01/1970, 1970-01-01, Jan 1 1970, 7/4/76. `use` repeats that name later, unlabeled.
 */
const FORMATS: { line: string; use: string }[] = [
  { line: "Pt: {{NAME|SEAN O'NEIL}}   DOB {{DOB|01/01/1970}}", use: "{{NAME|Sean}}'s ride is set for the visit." },
  { line: "Patient Name - {{NAME|Mary-Kate J. Smith}}   Date of birth: {{DOB|1970-01-01}}", use: "Ms. {{NAME|Smith}} can call the clinic." },
  { line: "Pt Name: {{NAME|Dolores Haile}}   D.O.B. {{DOB|Jan 1 1970}}", use: "{{NAME|Dolores}} should rest today." },
  { line: "Patient: {{NAME|D'Angelo Brooks}}   Birthdate: {{DOB|12/31/1969}}", use: "{{NAME|Brooks}}, bring your log." },
  { line: "PATIENT NAME - {{NAME|MEI-LING KIM}}   DOB: {{DOB|7/4/76}}", use: "{{NAME|Mei-Ling}} may need a ride." },
  { line: "Patient: {{NAME|Ana María Ruiz}}   MRN: {{MRN|0041-7733-21}}", use: "{{NAME|Ana}} {{NAME|María}} will get a call about {{MRN|0041-7733-21}}." },
];

/**
 * One more record per paper written to slip past a text shield (a second security review's list): invisible characters
 * and lookalike letters inside a name, a non-breaking space or tab after the label, the value on the next line, a label
 * broken across two lines, the value in quotes, a placeholder bracket inside an id, an en dash in a date. `use`
 * repeats the name later, unlabeled and written plainly.
 */
const HARD: { line: string; use: string }[] = [
  { line: "Pt Name: {{NAME|Ro​sa Diaz}}   DOB:\t{{DOB|19 Feb 1958}}", use: "{{NAME|Rosa}} will get a reminder text." },
  { line: "Medical Record\nNumber: {{MRN|MR-0099.4412}}", use: "Your chart is {{MRN|MR-0099.4412}}." },
  { line: "Patient Name:\n{{NAME|Kwame Mensah}}", use: "{{NAME|Kwame}} can ask the front desk." },
  { line: "MRN: \"{{MRN|7730-221-09}}\"   DOB: {{DOB|1958/02/19}}", use: "Bring card {{MRN|7730-221-09}} with you." },
  { line: "PATIENT: {{NAME|Luсia Ferreira}}   DOB: {{DOB|02–19–1958}}", use: "{{NAME|Lucia}} should rest today." },
  { line: "Patient: “{{NAME|Omar Haddad}}”   Member ID: {{ID|ZZ1234⟦ID_A⟧5678}}", use: "Ms. {{NAME|Haddad}} can call the clinic." },
];

const CLINIC_LINE ="[[clinic name|Grady Primary Care]]   [[doctor name|Dr. Lee]]   Clinic phone: [[clinic phone|404-616-1234]]   Visit: [[visit date|10/14/2026]]";
const ASK_LINE = "Questions? Ask [[doctor name|Dr. Lee]] or call [[clinic phone|404-616-1234]] before [[visit date|October 14, 2026]].";
const IMPERATIVE = /^(?:Take|Call|Check|Drink|Count|Weigh|See|Keep|Start|Cut|Come|Go|Return|Walk|Limit)\b/;
const PHONE = /(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}/g;

/** Turns a marked-up template into text plus the exact offsets of every planted and protected value. */
function unmark(template: string): { text: string; planted: Mark[]; keep: Keep[] } {
  const planted: Mark[] = [];
  const keep: Keep[] = [];
  let text = "";
  const re = /\{\{([A-Z]+)\|([^}]*)\}\}|\[\[([^|\]]+)\|([^\]]*)\]\]/g;
  let at = 0;
  for (const m of template.matchAll(re)) {
    text += template.slice(at, m.index);
    const start = text.length;
    const value = m[2] ?? m[4];
    text += value;
    if (m[1]) planted.push({ kind: m[1] as PhiKind, value, start, end: text.length });
    else keep.push({ why: m[3], value, start, end: text.length });
    at = m.index + m[0].length;
  }
  text += template.slice(at);
  return { text, planted, keep };
}

/** The 6 eval papers with identifiers planted. Deterministic. */
export function plantedPapers(): PlantedPaper[] {
  return evalPapers.papers.map((p, i) => {
    const who = PEOPLE[i % PEOPLE.length];
    const lines = (who.swap ? p.text.replace(who.swap[0], who.swap[1]) : p.text).split("\n");
    // The first instruction line gets the first name in front ("Maria, take ..."), the last line "Ms. Lopez, ...".
    const k = lines.findIndex((l) => IMPERATIVE.test(l));
    if (k >= 0) lines[k] = `{{NAME|${who.first}}}, ${lines[k][0].toLowerCase()}${lines[k].slice(1)}`;
    const fmt = FORMATS[i % FORMATS.length];
    const hard = HARD[i % HARD.length];
    const body = lines.join("\n") + (who.extra ? `\n${who.extra}` : "") + `\n${fmt.use}\n${hard.use}`;
    const template = `${who.header}\n${fmt.line}\n${hard.line}\n${CLINIC_LINE}\n\n${body}\n\n${who.title} {{NAME|${who.last}}}, bring this paper to your next visit.\n${ASK_LINE}`;
    const { text, planted, keep } = unmark(template);
    // Every instruction a correct reading must find, and every phone already on the paper, must survive.
    const lower = text.toLowerCase();
    for (const e of p.expected) {
      const at = lower.indexOf(e.toLowerCase());
      if (at >= 0) keep.push({ why: "care instruction", value: text.slice(at, at + e.length), start: at, end: at + e.length });
    }
    for (const m of p.text.matchAll(PHONE)) {
      const at = text.indexOf(m[0]);
      keep.push({ why: "phone already on the paper", value: m[0], start: at, end: at + m[0].length });
    }
    return { id: p.id, text, planted, keep };
  });
}

export type PhiPlantedReport = {
  papers: number;
  planted: { total: number; caught: number; byKind: Record<string, { total: number; caught: number }>; missed: { paper: string; kind: PhiKind; value: string }[] };
  falseHides: { count: number; examples: { paper: string; hidden: string }[] };
  keep: { total: number; kept: number; byWhy: Record<string, { total: number; kept: number }>; lost: { paper: string; why: string; value: string }[] };
};

/** Runs the shield on every planted paper and counts. Pure: same answer every run. */
export function runPhiPlantedTest(papers: PlantedPaper[] = plantedPapers()): PhiPlantedReport {
  const report: PhiPlantedReport = {
    papers: papers.length,
    planted: { total: 0, caught: 0, byKind: {}, missed: [] },
    falseHides: { count: 0, examples: [] },
    keep: { total: 0, kept: 0, byWhy: {}, lost: [] },
  };
  for (const p of papers) {
    const { offsetMap } = shield(p.text);
    const hidden = new Uint8Array(p.text.length);
    for (const s of offsetMap) hidden.fill(1, s.start, s.end);
    const plantedAt = new Uint8Array(p.text.length);
    for (const m of p.planted) plantedAt.fill(1, m.start, m.end);

    for (const m of p.planted) {
      const k = (report.planted.byKind[m.kind] ??= { total: 0, caught: 0 });
      k.total++;
      report.planted.total++;
      if (hidden.subarray(m.start, m.end).every((x) => x === 1)) { k.caught++; report.planted.caught++; }
      else report.planted.missed.push({ paper: p.id, kind: m.kind, value: m.value });
    }
    for (const s of offsetMap) {
      if (plantedAt.subarray(s.start, s.end).some((x) => x === 0)) {
        report.falseHides.count++;
        report.falseHides.examples.push({ paper: p.id, hidden: p.text.slice(s.start, s.end) });
      }
    }
    for (const kp of p.keep) {
      const w = (report.keep.byWhy[kp.why] ??= { total: 0, kept: 0 });
      w.total++;
      report.keep.total++;
      if (hidden.subarray(kp.start, kp.end).every((x) => x === 0)) { w.kept++; report.keep.kept++; }
      else report.keep.lost.push({ paper: p.id, why: kp.why, value: kp.value });
    }
  }
  return report;
}
