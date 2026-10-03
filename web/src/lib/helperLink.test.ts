import { describe, expect, it } from "vitest";
import { LANGUAGES, READING_LEVELS } from "./schema";
import {
  buildHelperLink, entryHeaders, helperBanner, helperSmsHref, helperSmsText, LANG_CODE, MAX_FRAGMENT, parseHelperFragment,
} from "./helperLink";

const ORIGIN = "https://atlas-team12.vercel.app";

describe("parseHelperFragment", () => {
  it("reads a full helper link", () => {
    expect(parseHelperFragment("#try&via=helper&lang=es&level=simple&zip=30310")).toEqual({ language: "Spanish", level: "simple", zip: "30310" });
  });

  it("accepts any key order and no #try anchor", () => {
    expect(parseHelperFragment("#zip=30340&lang=vi&via=helper")).toEqual({ language: "Vietnamese", zip: "30340" });
  });

  it("needs exactly one via=helper, otherwise it is a normal page", () => {
    expect(parseHelperFragment("#try&lang=es&zip=30310")).toBeNull();
    expect(parseHelperFragment("#try&via=sponsor&lang=es")).toBeNull();
    expect(parseHelperFragment("#try&via=helper&via=helper&lang=es")).toBeNull();
    expect(parseHelperFragment("#try")).toBeNull();
    expect(parseHelperFragment("")).toBeNull();
  });

  it("drops each invalid field on its own and keeps the rest", () => {
    expect(parseHelperFragment("#via=helper&lang=xx&level=simple&zip=30310")).toEqual({ level: "simple", zip: "30310" });
    expect(parseHelperFragment("#via=helper&lang=es&level=expert&zip=30310")).toEqual({ language: "Spanish", zip: "30310" });
    expect(parseHelperFragment("#via=helper&lang=es&zip=3031")).toEqual({ language: "Spanish" });
    expect(parseHelperFragment("#via=helper&lang=es&zip=303100")).toEqual({ language: "Spanish" });
    expect(parseHelperFragment("#via=helper&lang=es&zip=00000")).toEqual({ language: "Spanish" });
    expect(parseHelperFragment("#via=helper&lang=ES&level=SIMPLE")).toEqual({});
    expect(parseHelperFragment("#via=helper&lang=Spanish")).toEqual({});
  });

  it("ignores unknown keys and drops repeated ones as ambiguous", () => {
    expect(parseHelperFragment("#via=helper&lang=es&org=grady&name=Ana&note=hi")).toEqual({ language: "Spanish" });
    expect(parseHelperFragment("#via=helper&lang=es&lang=fr&zip=30310")).toEqual({ zip: "30310" });
    expect(parseHelperFragment("#via=helper&zip=30310&zip=30311")).toEqual({});
    expect(parseHelperFragment("#via=helper&__proto__=x&constructor=y&lang=toString")).toEqual({});
  });

  it("never lets an injection attempt through", () => {
    const bad = [
      "#via=helper&lang=javascript:alert(1)",
      "#via=helper&lang=<script>alert(1)</script>",
      "#via=helper&lang=%65%73",
      "#via=helper&zip=30310%00",
      "#via=helper&zip=30310<img src=x onerror=alert(1)>",
      "#via=helper&level=simple\"><svg onload=alert(1)>",
      "#via=helper&zip=３０３１０",
    ];
    for (const h of bad) {
      const p = parseHelperFragment(h);
      expect(p, h).toEqual({});
    }
  });

  it("refuses oversized fragments outright", () => {
    const long = `#try&via=helper&lang=es&pad=${"a".repeat(MAX_FRAGMENT)}`;
    expect(parseHelperFragment(long)).toBeNull();
    expect(parseHelperFragment(`#via=helper&zip=${"3".repeat(5000)}`)).toBeNull();
  });
});

describe("buildHelperLink", () => {
  it("round-trips every language and reading level", () => {
    for (const language of LANGUAGES) for (const level of READING_LEVELS) {
      const link = buildHelperLink(ORIGIN, { language, level, zip: "30310" });
      expect(link.startsWith(`${ORIGIN}/#try&via=helper`)).toBe(true);
      expect(link.length).toBeLessThan(ORIGIN.length + MAX_FRAGMENT);
      expect(parseHelperFragment(new URL(link).hash)).toEqual({ language, level, zip: "30310" });
    }
  });

  it("leaves a bad or missing ZIP out of the link", () => {
    expect(buildHelperLink(`${ORIGIN}/`, { language: "Korean", zip: "303" })).toBe(`${ORIGIN}/#try&via=helper&lang=ko`);
    expect(buildHelperLink(ORIGIN, {})).toBe(`${ORIGIN}/#try&via=helper`);
  });

  it("puts nothing in the query string, so nothing reaches server logs", () => {
    const u = new URL(buildHelperLink(ORIGIN, { language: "Amharic", level: "detailed", zip: "30310" }));
    expect(u.search).toBe("");
    expect(u.pathname).toBe("/");
  });
});

describe("text message and banner", () => {
  const link = buildHelperLink(ORIGIN, { language: "Spanish", zip: "30310" });

  it("has a message in every language that ends with the link", () => {
    const seen = new Set<string>();
    for (const language of LANGUAGES) {
      const t = helperSmsText(language, link);
      expect(t.endsWith(link)).toBe(true);
      expect(t).toContain("ATLAS");
      expect(t).not.toMatch(/[\u2013\u2014\u201c\u201d\u2018\u2019]/); // no en/em dashes or curly quotes
      expect(t.length).toBeLessThan(320);
      seen.add(t);
    }
    expect(seen.size).toBe(LANGUAGES.length);
    expect(helperSmsText("Spanish", link)).toContain("español");
    expect(helperSmsText("French", link)).toContain("français");
    expect(helperSmsText("Vietnamese", link)).toContain("tiếng Việt");
    expect(helperSmsText("Korean", link)).toContain("한국어");
    expect(helperSmsText("Chinese", link)).toContain("中文");
    expect(helperSmsText("Amharic", link)).toContain("አማርኛ");
  });

  it("encodes the message for an sms: link", () => {
    const href = helperSmsHref(helperSmsText("Spanish", link));
    expect(href.startsWith("sms:?&body=")).toBe(true);
    expect(href).not.toContain(" ");
    expect(decodeURIComponent(href.slice("sms:?&body=".length))).toBe(helperSmsText("Spanish", link));
  });

  it("says the spec banner in English and adds the person's language", () => {
    expect(helperBanner({ language: "English", zip: "30310" })).toEqual({
      text: "Someone helping you set this up in English for 30310. You can change anything.", lang: "en", english: null,
    });
    const es = helperBanner({ language: "Spanish", zip: "30310" });
    expect(es.lang).toBe(LANG_CODE.Spanish);
    expect(es.text).toContain("30310");
    expect(es.english).toBe("Someone helping you set this up in Spanish for 30310. You can change anything.");
    expect(helperBanner({}).text).toBe("Someone helping you set this up. You can change anything.");
    expect(helperBanner({ language: "French" }).english).toBe("Someone helping you set this up in French. You can change anything.");
  });

  it("adds no entry header outside a browser tab that came from a helper link", () => {
    expect(entryHeaders()).toEqual({});
  });
});
