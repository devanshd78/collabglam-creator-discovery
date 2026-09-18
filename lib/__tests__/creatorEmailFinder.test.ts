import { describe, it, expect } from "vitest";
import {
  classifyUrl,
  extractUrls,
  extractEmailsFromText,
  isJunkEmail,
  channelTokens,
  scoreEmail,
  parseHtml,
  robotsAllows,
  isPrivateAddress,
  rootDomain,
  ACCEPT_SCORE,
} from "../creatorEmailFinder";

describe("link handling", () => {
  it("reads links with and without a scheme", () => {
    const urls = extractUrls("Shop my faves: linktr.ee/janedoe. Website → www.janedoehome.com, and https://amzn.to/3xyz!");
    expect(urls).toEqual(["https://www.janedoehome.com/", "https://amzn.to/3xyz", "https://linktr.ee/janedoe"].sort((a, b) => urls.indexOf(a) - urls.indexOf(b)));
    expect(urls).toHaveLength(3);
  });

  it("never reads social profiles, stores or sponsor links", () => {
    expect(classifyUrl("https://linktr.ee/janedoe")).toBe("linkInBio");
    expect(classifyUrl("https://www.instagram.com/janedoe")).toBe("social");
    expect(classifyUrl("https://www.pinterest.co.uk/janedoe")).toBe("social");
    expect(classifyUrl("https://www.amazon.com/shop/janedoe")).toBe("skip");
    expect(classifyUrl("https://nordvpn.com/janedoe")).toBe("skip");
    expect(classifyUrl("https://sofabrand.com/?ref=janedoe")).toBe("skip");
    expect(classifyUrl("https://bit.ly/abc")).toBe("shortener");
    expect(classifyUrl("https://janedoehome.com")).toBe("website");
    expect(classifyUrl("ftp://janedoe.com")).toBe("skip");
  });

  it("finds the registrable domain", () => {
    expect(rootDomain("shop.jane-doe.co.uk")).toBe("jane-doe.co.uk");
    expect(rootDomain("www.blog.janedoe.com")).toBe("janedoe.com");
  });
});

describe("email extraction", () => {
  it("decodes the usual hand-obfuscated forms", () => {
    expect(extractEmailsFromText("Business: jane [at] gmail [dot] com")).toEqual(["jane@gmail.com"]);
    expect(extractEmailsFromText("collabs(at)janedoehome.com")).toEqual(["collabs@janedoehome.com"]);
    expect(extractEmailsFromText("email me: jane @ janedoehome.com")).toEqual(["jane@janedoehome.com"]);
    expect(extractEmailsFromText("hello&#64;janedoehome.com")).toEqual(["hello@janedoehome.com"]);
  });

  it("drops placeholder, image and platform addresses", () => {
    expect(isJunkEmail("icon@2x.png")).toBe(true);
    expect(isJunkEmail("noreply@janedoehome.com")).toBe(true);
    expect(isJunkEmail("support@linktr.ee")).toBe(true);
    expect(isJunkEmail("you@example.com")).toBe(true);
    expect(isJunkEmail("jane@gmail.com")).toBe(false);
  });

  it("reads mailto links, text, and Linktree's embedded link JSON", () => {
    const html = `<a href="mailto:Collabs%40JaneDoeHome.com?subject=Hi">Email</a>
      <p>or partnerships@janedoehome.com</p>
      <script id="__NEXT_DATA__" type="application/json">{"links":[{"url":"https:\\u002F\\u002Fwww.instagram.com\\u002Fjanedoe"}]}</script>
      <a href="/about">About</a>`;
    const parsed = parseHtml(html, "https://janedoehome.com/");
    expect(parsed.emails.sort()).toEqual(["collabs@janedoehome.com", "partnerships@janedoehome.com"]);
    expect(parsed.links).toContain("https://janedoehome.com/about");
    expect(parsed.links).toContain("https://www.instagram.com/janedoe");
  });
});

describe("ownership scoring", () => {
  const tokens = channelTokens("Jane Doe Home", "https://www.youtube.com/@janedoehome");

  it("accepts emails the creator published themselves", () => {
    expect(scoreEmail("jane@gmail.com", { fromDescription: true, tokens })).toBeGreaterThanOrEqual(ACCEPT_SCORE);
    expect(scoreEmail("hello@anything.com", { fromLinkPage: true, tokens })).toBeGreaterThanOrEqual(ACCEPT_SCORE);
    expect(scoreEmail("info@janedoehome.com", { ownedRoot: "janedoehome.com", tokens })).toBeGreaterThanOrEqual(ACCEPT_SCORE);
  });

  it("rejects store support inboxes and unrelated domains", () => {
    expect(scoreEmail("support@janedoehome.com", { ownedRoot: "janedoehome.com", tokens })).toBeLessThan(ACCEPT_SCORE);
    expect(scoreEmail("partnerships@sofabrand.com", { ownedRoot: "janedoehome.com", tokens })).toBeLessThan(ACCEPT_SCORE);
  });
});

describe("safety", () => {
  it("honours robots.txt, with this bot's own rules taking priority", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/contact\n\nUser-agent: CollabGlamBot\nDisallow: /";
    expect(robotsAllows(robots, "/contact")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /private\nAllow: /private/contact", "/private/contact")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /private", "/private/x")).toBe(false);
    expect(robotsAllows("", "/anything")).toBe(true);
  });

  it("refuses private and internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.9", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });
});
