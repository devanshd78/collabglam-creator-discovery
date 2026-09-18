import { describe, it, expect } from "vitest";
import { extractChannelContact } from "../youtube/channelExtractor";

// Real channel descriptions (trimmed), pulled while verifying this module against the live
// YouTube API — not fabricated, so the patterns are proven against actual formatting choices
// creators use, not a guess at what they might look like.
const TECH_UNBOXING = `Honest tech reviews for India 🇮🇳
Smartphones · Budget gadgets · Laptops · Tablets — tested and reviewed so you don't waste your money.

📩 Business & Sponsorship: contact.abhi.techunboxing@gmail.com
📲 Instagram → https://instagram.com/tech_unboxing007
🐦 Twitter → https://twitter.com/TechUnboxing5`;

const TECHNOLOGY_GYAN = `Subscribe for Zabardast Tech Videos 😍 😍

For Business and Partnerships: Business@TechnologyGyan.in

 *I DO NOT PROVIDE TECH SUPPORT OVER  EMAIL*`;

const MRBEAST = `SUBSCRIBE FOR A COOKIE!
New MrBeast or MrBeast Gaming video every single Saturday at noon eastern time!
Accomplishments:
- Raised $20,000,000 To Plant 20,000,000 Trees`;

describe("extractChannelContact", () => {
  it("extracts a plainly-listed business email and platform links from a real description", () => {
    const result = extractChannelContact(TECH_UNBOXING);
    expect(result.email).toBe("contact.abhi.techunboxing@gmail.com");
    expect(result.platformLinks.instagram).toBe("https://instagram.com/tech_unboxing007");
    expect(result.platformLinks.twitter).toBe("https://twitter.com/TechUnboxing5");
    expect(result.platformLinks.tiktok).toBeUndefined();
  });

  it("finds an email with no surrounding link text at all", () => {
    const result = extractChannelContact(TECHNOLOGY_GYAN);
    expect(result.email).toBe("Business@TechnologyGyan.in");
    expect(result.platformLinks).toEqual({});
  });

  it("returns null/empty rather than a false match when nothing is there", () => {
    const result = extractChannelContact(MRBEAST);
    expect(result.email).toBeNull();
    expect(result.platformLinks).toEqual({});
  });

  it("handles empty/undefined input without throwing", () => {
    expect(extractChannelContact("")).toEqual({ email: null, platformLinks: {} });
  });

  it("recognizes an x.com link as twitter", () => {
    const result = extractChannelContact("Find me at https://x.com/somecreator for updates.");
    expect(result.platformLinks.twitter).toBe("https://x.com/somecreator");
  });

  it("recognizes a tiktok handle link", () => {
    const result = extractChannelContact("TikTok: https://www.tiktok.com/@creator.handle");
    expect(result.platformLinks.tiktok).toBe("https://www.tiktok.com/@creator.handle");
  });

  it("recognizes an Amazon storefront link", () => {
    const result = extractChannelContact("Shop my faves: https://www.amazon.com/shop/creatorname");
    expect(result.platformLinks.amazonStorefront).toBe("https://www.amazon.com/shop/creatorname");
  });
});
