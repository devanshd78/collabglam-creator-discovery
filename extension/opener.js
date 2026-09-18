// Runs in YouTube's own page context (manifest "world": "MAIN"), because opening the About panel
// means running the same command YouTube runs when "…more" is clicked, and only the page can do
// that — YouTube ignores clicks that don't come from a real user. content.js asks for it, once per
// page, with a "cg-open-about" event.
(() => {
  function findOnTap(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 30) return null;
    if (node.descriptionPreviewViewModel) {
      return node.descriptionPreviewViewModel.rendererContext?.commandContext?.onTap?.innertubeCommand ?? null;
    }
    for (const value of Object.values(node)) {
      const found = findOnTap(value, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const aboutVisible = () => [...document.querySelectorAll("ytd-about-channel-renderer")].some((e) => e.getClientRects().length > 0);

  document.addEventListener("cg-open-about", () => {
    // The page may still be building its header when asked, so wait for the command to exist.
    const started = Date.now();
    const timer = setInterval(() => {
      if (aboutVisible() || Date.now() - started > 10000) {
        clearInterval(timer);
        return;
      }
      const header = document.querySelector("ytd-tabbed-page-header") || document.querySelector("yt-page-header-renderer");
      const command = findOnTap(header?.data);
      const app = document.querySelector("ytd-app");
      if (command && typeof app?.resolveCommand === "function") {
        clearInterval(timer);
        app.resolveCommand(command);
      }
    }, 400);
  });
})();
