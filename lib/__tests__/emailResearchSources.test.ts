import { describe, it, expect } from "vitest";
import { decodeCfEmail, pageKey, parseHtml, recurringFooterText, scoreEmail, ACCEPT_SCORE } from "../creatorEmailFinder";
import { parseAboutLinks } from "../youtube/aboutLinks";

describe("About-panel links", () => {
  it("reads the real destination out of YouTube's redirect wrapper", () => {
    const html =
      '"channelExternalLinkViewModel":{"title":{"content":"My Site"},"link":{"content":"janedoe.com","commandRuns":[{"url":"https://www.youtube.com/redirect?event=channel_description\u0026redir_token=abc\u0026q=https%3A%2F%2Fwww.janedoe.com%2F"}]}}' +
      '"channelExternalLinkViewModel":{"title":{"content":"Instagram"},"link":{"content":"instagram.com/janedoe"}}';
    expect(parseAboutLinks(html)).toEqual([
      { title: "My Site", url: "https://www.janedoe.com/" },
      { title: "Instagram", url: "https://instagram.com/janedoe" },
    ]);
  });
});

describe("page parsing", () => {
  it("decodes Cloudflare-protected emails", () => {
    expect(decodeCfEmail("b6c2ded3c2c4d3d7d2dbdfdadad1c3c4c3f6d1dbd7dfda98d5d9db")).toBe("thetreadmillguru@gmail.com");
    const { emails } = parseHtml('<a href="/cdn-cgi/l/email-protection" data-cfemail="b6c2ded3c2c4d3d7d2dbdfdadad1c3c4c3f6d1dbd7dfda98d5d9db">[email protected]</a>', "https://x.com/");
    expect(emails).toContain("thetreadmillguru@gmail.com");
  });

  it("reads emails from meta descriptions", () => {
    const { emails } = parseHtml('<meta property="og:description" content="Email us at &#8211; jane@janedoe.com" />', "https://janedoe.com/");
    expect(emails).toContain("jane@janedoe.com");
  });

  it("accepts a freemail address on the creator's own contact page", () => {
    const ctx = { tokens: ["janedoe"], ownedRoot: "janedoereviews.com" };
    expect(scoreEmail("someone@gmail.com", { ...ctx, fromContactPage: true })).toBeGreaterThanOrEqual(ACCEPT_SCORE);
    expect(scoreEmail("someone@gmail.com", ctx)).toBeLessThan(ACCEPT_SCORE);
  });

  it("treats scheme, www and trailing slash variants as one page", () => {
    expect(pageKey("http://www.JaneDoe.com/")).toBe(pageKey("https://janedoe.com"));
  });
});

describe("video description footers", () => {
  it("keeps lines and domains that recur across uploads, drops one-offs", () => {
    const footer = recurringFooterText([
      "Great treadmill.\nFull review: https://janedoe.com/treadmill-x\nInstagram: https://instagram.com/janedoe\nUse code SAVE10 at https://sponsor.com",
      "Another one.\nFull review: https://janedoe.com/bike-y\nInstagram: https://instagram.com/janedoe",
      "Business inquiries: jane@janedoe.com",
    ]);
    expect(footer).toContain("Instagram: https://instagram.com/janedoe");
    expect(footer).toContain("https://janedoe.com/");
    expect(footer).toContain("jane@janedoe.com");
    expect(footer).not.toContain("sponsor.com");
  });
});
