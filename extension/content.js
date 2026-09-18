// Runs on youtube.com. On a channel page it opens the About panel, highlights YouTube's own
// "View email address" button, and tells the CollabGlam side panel what it sees. It never clicks
// that button and never touches the reCAPTCHA — the member does both. Once YouTube shows the email,
// it's reported so the side panel can save it.
(() => {
  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
  const LIMIT_RE = /daily limit|reached (?:the|your) (?:daily )?limit|try again (?:later|tomorrow)|too many requests|limit reached/i;
  const SIGNED_OUT_RE = /sign in to see email/i;
  const VIEW_EMAIL_RE = /view email address/i;
  const NO_BUTTON_SETTLE_MS = 3500;

  let lastSent = "";
  let panelSeenAt = 0;
  let lastOpenRequest = 0;
  let pageStartedAt = Date.now();

  const isChannelPage = () => /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/.test(location.pathname);
  const OPEN_TIMEOUT_MS = 25000;
  // A channel's /about URL makes YouTube open the About panel by itself; only nudge it if it doesn't.
  const AUTO_OPEN_GRACE_MS = 12000;
  // YouTube keeps hidden About panels from earlier pages around — use the visible, newest one.
  const aboutRoot = () => [...document.querySelectorAll("ytd-about-channel-renderer")].filter(visible).pop() ?? null;
  const infoSection = () => aboutRoot()?.querySelector("#additional-info-container") ?? null;

  function visible(el) {
    return !!el && el.getClientRects().length > 0;
  }

  function viewEmailButton(root) {
    return [...root.querySelectorAll("button, a, yt-button-view-model, ytd-button-renderer")].find((b) => VIEW_EMAIL_RE.test(b.textContent || ""));
  }

  /**
   * On an /about URL YouTube opens the panel itself, so this first waits for that. Otherwise (or if it
   * doesn't) it asks opener.js (page context) to run YouTube's own "…more" command — once per page,
   * because the command toggles and the panel can take many seconds to appear. If it still hasn't
   * appeared, the member is asked to click "…more" themselves.
   */
  function openAboutPanel() {
    if (aboutRoot()) return "open";
    if (/\/about\/?$/.test(location.pathname) && Date.now() - pageStartedAt < AUTO_OPEN_GRACE_MS) return "waiting";
    if (!lastOpenRequest) {
      lastOpenRequest = Date.now();
      document.dispatchEvent(new CustomEvent("cg-open-about"));
    }
    return Date.now() - lastOpenRequest > OPEN_TIMEOUT_MS ? "needs-click" : "waiting";
  }

  function emailsIn(el) {
    const found = new Set();
    for (const a of el.querySelectorAll('a[href^="mailto:"]')) found.add(a.getAttribute("href").slice(7).split("?")[0].toLowerCase());
    for (const m of (el.innerText || "").matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
    return [...found];
  }

  function inspect() {
    if (!isChannelPage()) return { state: "not-channel" };
    const info = infoSection();
    if (!aboutRoot() || !info) {
      panelSeenAt = 0;
      return { state: openAboutPanel() === "needs-click" ? "needs-click" : "loading" };
    }
    if (!panelSeenAt) panelSeenAt = Date.now();
    // The "More info" section never contains an email until YouTube reveals one.
    const emails = emailsIn(info);
    if (emails.length > 0) return { state: "revealed", email: emails[0] };
    const text = info.innerText || "";
    if (LIMIT_RE.test(aboutRoot().innerText || "")) return { state: "limit" };
    if (SIGNED_OUT_RE.test(text)) return { state: "signed-out" };
    const button = viewEmailButton(info) || viewEmailButton(aboutRoot());
    if (button) {
      if (!button.dataset.cgHighlighted) {
        button.dataset.cgHighlighted = "1";
        button.style.outline = "3px solid #157a8c";
        button.style.outlineOffset = "3px";
        button.style.borderRadius = "18px";
        button.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return { state: "ready" };
    }
    // A reCAPTCHA dialog is open, or YouTube is still rendering the section.
    if (document.querySelector('iframe[src*="recaptcha"]')) return { state: "captcha" };
    // Give YouTube a moment to draw the button after the panel appears before calling it missing.
    if (Date.now() - panelSeenAt < NO_BUTTON_SETTLE_MS) return { state: "loading" };
    return { state: "no-email" };
  }

  function report(force) {
    const status = { ...inspect(), url: location.href };
    const key = `${status.url}|${status.state}|${status.email || ""}`;
    if (!force && key === lastSent) return status;
    lastSent = key;
    chrome.runtime.sendMessage({ type: "cg-status", status }).catch(() => {});
    return status;
  }

  function reset() {
    lastSent = "";
    panelSeenAt = 0;
    lastOpenRequest = 0;
    pageStartedAt = Date.now();
  }

  document.addEventListener("yt-navigate-finish", () => {
    reset();
    report(true);
  });
  setInterval(() => report(false), 700);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "cg-scan") {
      if (msg.reset) reset();
      sendResponse(report(true));
    }
  });
})();
