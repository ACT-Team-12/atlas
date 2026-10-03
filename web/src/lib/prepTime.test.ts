import { describe, expect, it } from "vitest";
import { firstClause, readWhen, type Slot } from "./prepTime";

const placed = (q: string) => readWhen(q).slot;

describe("readWhen: places a step only from the time words in its own quote", () => {
  const cases: [string, Slot][] = [
    ["Stop taking iron pills and fish oil 7 days before your procedure.", "days_before"],
    ["Starting 3 days before your procedure, do not eat nuts, seeds, popcorn, or raw vegetables.", "days_before"],
    ["Stop aspirin one week before your colonoscopy.", "days_before"],
    ["Stop it a week prior to your appointment.", "days_before"],
    ["Pick up the prep kit 1 day before your procedure.", "day_before"],
    ["The day before your procedure, drink only clear liquids all day.", "day_before"],
    ["On the day prior to your exam, eat a light breakfast only.", "day_before"],
    ["At 5 PM the evening before your procedure, drink the first half of the bowel prep.", "evening_before"],
    ["Do not eat or drink anything after midnight the night before your procedure.", "evening_before"],
    ["Stop eating at midnight the day before your exam.", "evening_before"],
    ["5 hours before your procedure, drink the second half of the bowel prep.", "hours_before"],
    ["Stop drinking all liquids 2 hours before your procedure.", "hours_before"],
    ["Stop drinking two hours prior to your exam.", "hours_before"],
    ["The morning of your procedure, take your blood pressure pill with a small sip of water.", "morning_of"],
    ["On the day of your procedure, wear loose clothes.", "day_of"],
    ["On the day of your procedure, stop drinking 2 hours before your procedure.", "hours_before"],
    ["Check in 30 minutes before you arrive at the desk.", "arrival"],
    ["The morning of your test, 4 hours before, finish the prep.", "morning_of"],
    ["Arrive at 7:00 AM at Midtown Endoscopy Center, 2nd floor.", "arrival"],
    ["Please check in 1 hour before your procedure time.", "arrival"],
    ["Arrive at 6:45 a.m. the morning of your procedure.", "arrival"],
    ["An adult must drive you home after your procedure.", "after"],
    ["Do not drive for 24 hours after your colonoscopy.", "after"],
  ];
  it.each(cases)("%s -> %s", (q, slot) => {
    const r = readWhen(q);
    expect(r.slot).toBe(slot);
    expect(r.reason).toBe("placed");
    expect(r.words.length).toBeGreaterThan(0);
    for (const w of r.words) expect(q).toContain(w); // the shown time words are the paper's own words
  });

  it("returns the time words exactly as written, in order", () => {
    expect(readWhen("At 5 PM the evening before your procedure, drink half.").words).toEqual(["5 PM", "the evening before your procedure"]);
    expect(readWhen("Do not eat after midnight the night before your test.").words).toEqual(["midnight", "the night before your test"]);
    expect(readWhen("Stop iron 1 day before your exam.").words).toEqual(["1 day before your exam"]);
  });
});

describe("readWhen: refuses to place what the quote does not say", () => {
  it("no time words -> ask your clinic", () => {
    for (const q of [
      "Bring your photo ID, insurance card, and a list of all your medicines.",
      "Call 404-555-0199 if you cannot finish the prep.",
      "Arrive at Midtown Endoscopy Center, 2nd floor.", // a place, but no time
      "Drink only clear liquids.",
      "Take 2 tablets with 8 ounces of water.",
      "Do not take your insulin tonight.", // "tonight" says no day relative to the procedure
      "Before your procedure, stop iron.", // "before" alone is not a time
    ]) {
      expect(readWhen(q), q).toEqual({ slot: null, reason: "no_time_words", words: [] });
    }
  });

  it("a clock time with no day -> ask, and keeps the time it saw", () => {
    expect(readWhen("Take 2 bisacodyl tablets at 3 PM.")).toEqual({ slot: null, reason: "clock_without_day", words: ["3 PM"] });
    expect(readWhen("Take your pill at noon.")).toEqual({ slot: null, reason: "clock_without_day", words: ["noon"] });
  });

  it("two different moments in one line -> ask, never a guess", () => {
    expect(readWhen("Starting the day before your procedure, drink only clear liquids until 2 hours before your procedure.").reason).toBe("conflict");
    expect(readWhen("Stop iron 7 days before your procedure and start again after your procedure.").reason).toBe("conflict");
    expect(readWhen("Arrive at 7 AM, 3 days before your procedure.").reason).toBe("conflict");
    expect(readWhen("Eat nothing after midnight the morning of your procedure.").reason).toBe("conflict");
  });

  it("a quote across lines is never placed", () => {
    expect(readWhen("Bring your ID.\nThe morning of your procedure, take your pill.", true)).toEqual({ slot: null, reason: "multi_line", words: [] });
  });

  it("time words in a later sentence do not belong to the first", () => {
    expect(placed("Take your blood pressure pill. Stop drinking 2 hours before your procedure.")).toBeNull();
    expect(placed("Bring your ID. The morning of your procedure, arrive early.")).toBeNull();
  });

  it("time words after an ellipsis do not count: the ellipsis can skip anything", () => {
    expect(placed("Take your pill ... 2 hours before your procedure")).toBeNull();
    expect(placed("Take your pill … the morning of your procedure")).toBeNull();
  });

  it("does not read numbers that are not times", () => {
    expect(placed("Drink 8 ounces every 15 minutes until it is gone.")).toBeNull();
    expect(placed("Call 404-555-0199.")).toBeNull();
    expect(placed("Go to the 2nd floor, room 7 PMR.")).toBeNull();
    expect(placed("Take 10 amps of courage.")).toBeNull();
    expect(placed("Stop eating 2 days after you get the kit.")).toBeNull();
    expect(placed("Afterward, go to bed.")).toBeNull(); // after what? the line doesn't say // "after" with no procedure word is not "after your procedure"
  });

  it("'after midnight' is not 'after your procedure', and midnight alone names no day", () => {
    expect(readWhen("Do not eat after midnight.")).toEqual({ slot: null, reason: "clock_without_day", words: ["midnight"] });
  });
});

describe("adversarial: the AI places a step at a time its quote doesn't say", () => {
  // readWhen never sees the AI's slot. These are the quotes the AI could pair with a wrong slot claim; the slot
  // our code returns depends only on the words, so the claim is ignored whatever it was.
  const attacks: { quote: string; aiSays: Slot; expected: Slot | null }[] = [
    { quote: "Bring your photo ID and insurance card.", aiSays: "arrival", expected: null },
    { quote: "Take 2 bisacodyl tablets at 3 PM.", aiSays: "day_before", expected: null },
    { quote: "Stop taking iron pills 7 days before your procedure.", aiSays: "morning_of", expected: "days_before" },
    { quote: "Stop drinking all liquids 2 hours before your procedure.", aiSays: "evening_before", expected: "hours_before" },
    { quote: "An adult must drive you home after your procedure.", aiSays: "arrival", expected: "after" },
    { quote: "Call us if you cannot finish the prep.", aiSays: "evening_before", expected: null },
  ];
  it.each(attacks)("$quote (AI says $aiSays)", ({ quote, expected }) => {
    expect(readWhen(quote).slot).toBe(expected);
  });
});

describe("firstClause", () => {
  it("stops at the first sentence end or ellipsis", () => {
    expect(firstClause("Take one. Then two.")).toBe("Take one.");
    expect(firstClause("Take one ... then two")).toBe("Take one");
    expect(firstClause("Arrive at 7:00 a.m. at the clinic.")).toBe("Arrive at 7:00 a.m. at the clinic.");
    expect(firstClause("  Drink\n water  ")).toBe("Drink water");
  });
});

describe("Codex review: a relative time must be relative to the procedure", () => {
  it.each([
    "Take your sleeping pill 2 hours before bedtime.",
    "Stop the cream a week before your trip.",
    "Eat a light dinner the night before your flight.",
    "Call your sister the morning of your birthday.",
    "Do not eat 3 days before.",
    "Stop it the day before.",
    "Shower the evening before.",
    "Take it 30 minutes before meals.",
    "Rest when you get home.",
    "You may eat after the movie.",
  ])("%s -> ask your clinic", (q) => {
    const r = readWhen(q);
    expect(r.slot).toBeNull();
  });

  it("'On the day of your procedure' is the day, never the morning", () => {
    expect(readWhen("On the day of your procedure, do not wear jewelry.")).toMatchObject({ slot: "day_of", reason: "placed" });
    expect(readWhen("The day of your test, bring your glasses.").slot).toBe("day_of");
    expect(readWhen("On the day of your procedure, take your pill in the morning.").slot).toBe("day_of");
  });
});

describe("Codex review: every Unicode line break ends a line", () => {
  const breaks: [string, string][] = [["U+0085", "\u0085"], ["U+2028", "\u2028"], ["U+2029", "\u2029"], ["vertical tab", "\v"], ["form feed", "\f"], ["CR", "\r"]];
  it.each(breaks)("a quote holding a %s is never placed", (_name, br) => {
    const q = `Bring your ID.${br}The morning of your procedure, take your pill.`;
    expect(readWhen(q)).toEqual({ slot: null, reason: "multi_line", words: [] });
    expect(readWhen(`Bring your ID${br}2 hours before your procedure`).reason).toBe("multi_line");
  });
});

describe("Codex review: \"before your arrival\" is a time, not an arrival", () => {
  it.each<[string, Slot]>([
    ["Stop drinking 2 hours before your arrival.", "hours_before"],
    ["Stop drinking 2 hours before you arrive.", "hours_before"],
    ["Stop drinking all liquids 2 hours before your arrival time.", "hours_before"],
    ["Take your blood pressure pill 1 hour before your arrival.", "hours_before"],
    ["Take your blood pressure pill 1 hour before you arrive.", "hours_before"],
    ["Take your seizure medicine 2 hours prior to your arrival.", "hours_before"],
    ["Stop drinking 2 hours before you check in.", "hours_before"],
  ])("%s", (q, slot) => expect(placed(q)).toBe(slot));

  it.each<[string, Slot]>([
    ["Arrive at 7:30 AM.", "arrival"],
    ["Arrive at 7:30 AM at the main entrance.", "arrival"],
    ["Please arrive 1 hour before your procedure.", "arrival"],
    ["Check in at 6:45 AM on the 2nd floor.", "arrival"],
    ["Your arrival time is 7:30 AM.", "arrival"],
    ["Check in 30 minutes before you arrive at the desk.", "arrival"],
  ])("a genuine arrival stays an arrival: %s", (q, slot) => expect(placed(q)).toBe(slot));
});

describe("Codex re-review: a conditional mention of arriving is not the arrival step", () => {
  it.each([
    "If you cannot arrive by 7:00 AM, call the clinic.",
    "Call us if check-in at 7:00 AM is impossible.",
    "If you will arrive after 7:30 AM, call the front desk.",
    "Call the clinic if you can't check in at 6:45 AM.",
    "Unless you arrive by 7:00 AM, your procedure may be canceled.",
    "When you arrive at 7:00 AM, the nurse will check your prep.",
  ])("%s goes under Ask your clinic when", (q) => {
    const r = readWhen(q);
    expect(r.slot).toBeNull();
    expect(r.reason).toBe("clock_without_day");
  });

  it.each<[string, Slot]>([
    ["You must arrive at 7:00 AM.", "arrival"],
    ["Please check in at 6:45 AM at the front desk.", "arrival"],
    ["Plan to arrive 1 hour before your procedure.", "arrival"],
    ["Your check-in time is 6:30 AM.", "arrival"],
    ["On the day of your procedure, arrive at 7:00 AM.", "arrival"],
  ])("an instruction or a stated arrival time is still arrival: %s", (q, slot) => expect(placed(q)).toBe(slot));
});

describe("Codex round 4: a sentence ends at its period whatever the next letter's case", () => {
  it.each([
    "Take bisacodyl. stop iron 3 days before your procedure.",
    "take bisacodyl. stop iron 3 days before your procedure.",
    "Take bisacodyl.stop iron 3 days before your procedure.",
    "Take bisacodyl! stop iron 3 days before your procedure.",
    "Take your pill at 8 a.m. Stop iron 3 days before your procedure.",
    "Take 5 mg. Stop iron 3 days before your procedure.",
  ])("%s: the first instruction stays unplaced", (q) => {
    expect(readWhen(q).slot).toBeNull();
  });

  it.each([
    ["Arrive at 6:45 a.m. the morning of your procedure.", "Arrive at 6:45 a.m. the morning of your procedure."],
    ["Call Dr. Lee 7 days before your procedure.", "Call Dr. Lee 7 days before your procedure."],
    ["Take 2.5 mg 2 hours before your procedure.", "Take 2.5 mg 2 hours before your procedure."],
    ["Bring snacks, drinks, etc. Stop iron 3 days before your procedure.", "Bring snacks, drinks, etc."],
  ])("explicit exceptions: %s", (q, first) => expect(firstClause(q)).toBe(first));
});
