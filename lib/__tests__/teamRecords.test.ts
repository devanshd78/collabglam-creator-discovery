import { describe, it, expect } from "vitest";
import { creatorsToCsv, csvCell, type CsvRow } from "../creatorRecord";
import { parseBriefInput } from "../briefs";

const row: CsvRow = {
  channelId: "UC1",
  title: '=HYPERLINK("x")',
  channelUrl: "https://www.youtube.com/@jane",
  thumbnailUrl: "",
  country: "US",
  subscriberCount: 12000,
  averageViews: 3400,
  medianViews: 2100,
  engagementRate: 4.2,
  email: "jane@janedoe.com",
  emailSource: "janedoe.com/contact",
  emailSourceUrl: "https://janedoe.com/contact",
  otherEmails: ["hello@janedoe.com"],
  platformLinks: { instagram: "https://instagram.com/jane" },
  websiteLinks: ["https://janedoe.com/"],
  mainContent: "Product Review · fitness",
  matchScore: 91,
  tier: "A",
  relevantVideos: 20,
  analyzedVideos: 50,
  lastUploadAt: "2026-09-01T10:00:00.000Z",
  whyFit: ["20 of 50 videos are about treadmills"],
  concerns: [],
  evidenceTitle: "Treadmill review, 6 months later",
  evidenceUrl: "https://www.youtube.com/watch?v=abc",
  foundVia: ["treadmill review"],
  brand: "Acme",
  savedBy: "Riya",
  savedAt: "2026-09-16 10:00",
};

describe("CSV export", () => {
  it("neutralizes spreadsheet formulas and escapes quotes", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-5)).toBe(`"'-5"`);
    expect(csvCell(null)).toBe('""');
  });

  it("writes a header and one line per creator, with who saved it", () => {
    const csv = creatorsToCsv([row]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, line] = csv.slice(1).split("\r\n");
    expect(header).toContain('"Email"');
    expect(header).toContain('"Saved by"');
    expect(line).toContain('"jane@janedoe.com"');
    expect(line).toContain('"Riya"');
    expect(line).toContain('"2026-09-01"');
  });
});

describe("brand brief validation", () => {
  it("accepts a complete brief and normalizes it", () => {
    const parsed = parseBriefInput({ brandName: " Acme ", brief: "US fitness reviewers", targetNiche: " Fitness, Home Gym ", briefDate: "2026-09-16", market: "us", minSubscribers: "10000" });
    expect("data" in parsed && parsed.data).toMatchObject({
      brandName: "Acme",
      title: "Acme",
      targetNiche: "Fitness, Home Gym",
      market: "US",
      minSubscribers: 10000,
      maxSubscribers: null,
    });
    expect("data" in parsed && parsed.data.briefDate.toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });

  it("rejects a brief without a brand, text or date", () => {
    expect(parseBriefInput({ brief: "x", targetNiche: "DIY", briefDate: "2026-09-16" })).toEqual({ error: "Brand name is required" });
    expect("error" in parseBriefInput({ brandName: "Acme", targetNiche: "DIY", briefDate: "2026-09-16" })).toBe(true);
    expect(parseBriefInput({ brandName: "Acme", brief: "x", briefDate: "2026-09-16" })).toEqual({ error: "Target niche is required" });
    expect("error" in parseBriefInput({ brandName: "Acme", brief: "x", targetNiche: "DIY", briefDate: "16/09/2026" })).toBe(true);
  });
});
