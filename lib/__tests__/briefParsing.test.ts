import { describe, it, expect } from "vitest";
import { buildKeywordMatrix, heuristicParseBrief } from "../discovery/campaignProfile";

describe("brief parsing", () => {
  it("keeps the product and drops conversational wording", () => {
    const { profile } = heuristicParseBrief(
      "Looking for US creators, who try the product and creates a 3- min review video while applying and showcasing the sunscreen"
    );
    expect(profile.market).toBe("US");
    expect(profile.targetProducts).toEqual(["sunscreen"]);
    expect(profile.category).toBe("beauty");
    expect(profile.relatedTerms).toContain("spf");
  });

  it("plans enough searches for a one-product brief", () => {
    const { profile } = heuristicParseBrief("US sunscreen reviewers");
    const queries = buildKeywordMatrix(profile).map((q) => q.query);
    expect(queries.length).toBeGreaterThanOrEqual(8);
    expect(queries).toContain("sunscreen review");
    expect(queries.every((q) => !/\b(min|while|try the)\b/.test(q))).toBe(true);
  });


  it("builds the full Deep query budget even for a one-product brief", () => {
    const { profile } = heuristicParseBrief("US sunscreen reviewers");
    const queries = buildKeywordMatrix(profile, 30).map((q) => q.query);
    expect(queries).toHaveLength(30);
    expect(new Set(queries).size).toBe(30);
    expect(queries.slice(0, 4).some((q) => q.includes("sunscreen"))).toBe(true);
  });

  it("still reads a multi-product brief", () => {
    const { profile } = heuristicParseBrief(
      "Find US YouTube creators with 10K–50K subscribers who create treadmill, walking pad, home gym, fitness equipment, unboxing, testing, and review videos."
    );
    expect(profile.targetProducts).toEqual(["treadmill", "walking pad", "home gym", "fitness equipment"]);
    expect(profile.minSubscribers).toBe(10000);
    expect(profile.maxSubscribers).toBe(50000);
  });
});
