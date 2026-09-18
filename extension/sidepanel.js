// The side panel: walks the member through their creators that still need an email. For each one it
// opens the channel's About panel in the current tab (with the chosen Google account), waits for the
// member to reveal the email on YouTube, saves it to CollabGlam, and moves on.
const $ = (id) => document.getElementById(id);

const cfg = { appUrl: "", token: "", accountCount: 1, dailyLimit: 10, account: 0, listId: "" };
let me = null; // { user, lists, today, defaultDailyLimit }
let queue = [];
let current = null; // { creator, openedAt, handled }
let tabId = null;
let done = 0;

/* ------------------------------ storage & API ------------------------------ */

async function loadConfig() {
  Object.assign(cfg, await chrome.storage.local.get(Object.keys(cfg)));
}

function saveConfig() {
  return chrome.storage.local.set(cfg);
}

async function api(path, body) {
  const res = await fetch(`${cfg.appUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `CollabGlam returned ${res.status}`);
  return data;
}

function log(text) {
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${text}`;
  $("log").prepend(line);
}

/* ------------------------------ accounts ------------------------------ */

function usage(index) {
  const t = me?.today?.[index];
  return { revealed: t?.revealed ?? 0, full: !!t?.limitHit || (t?.revealed ?? 0) >= cfg.dailyLimit };
}

/** The current account if it still has reveals left, otherwise the next one that does. */
function pickAccount() {
  for (let step = 0; step < cfg.accountCount; step++) {
    const index = (cfg.account + step) % cfg.accountCount;
    if (!usage(index).full) return index;
  }
  return -1;
}

function renderAccounts() {
  const box = $("accounts");
  box.textContent = "";
  for (let i = 0; i < cfg.accountCount; i++) {
    const u = usage(i);
    const chip = document.createElement("span");
    chip.className = `account${i === cfg.account ? " active" : ""}${u.full ? " full" : ""}`;
    chip.textContent = `Account ${i + 1} · ${u.revealed}/${cfg.dailyLimit}`;
    chip.title = u.full ? "Used up for today" : "Click to use this account";
    chip.onclick = () => {
      cfg.account = i;
      saveConfig();
      renderAccounts();
      if (current) openCurrent();
    };
    box.append(chip);
  }
}

/* ------------------------------ connect ------------------------------ */

async function connect() {
  $("connectError").textContent = "";
  let origin;
  try {
    origin = new URL($("appUrl").value.trim()).origin;
  } catch {
    $("connectError").textContent = "Enter the full CollabGlam address, e.g. https://collabglam.example.com";
    return;
  }
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    $("connectError").textContent = "The extension needs permission to reach CollabGlam.";
    return;
  }
  cfg.appUrl = origin;
  cfg.token = $("token").value.trim();
  try {
    await refreshMe();
    await saveConfig();
    showMain();
  } catch (err) {
    $("connectError").textContent = err.message;
  }
}

async function refreshMe() {
  me = await api("/api/ext/me");
  if (!cfg.dailyLimit) cfg.dailyLimit = me.defaultDailyLimit;
  $("who").textContent = `${me.user.name} · ${new URL(cfg.appUrl).host}`;
  const select = $("listSelect");
  const total = me.lists.reduce((s, l) => s + l.needsEmail, 0);
  select.textContent = "";
  select.append(new Option(`All my lists (${total})`, ""));
  for (const l of me.lists) select.append(new Option(`${l.name} (${l.needsEmail})`, l.id));
  select.value = me.lists.some((l) => l.id === cfg.listId) ? cfg.listId : "";
  $("queueCount").textContent = cfg.listId ? me.lists.find((l) => l.id === cfg.listId)?.needsEmail ?? 0 : total;
  renderAccounts();
}

function showMain() {
  $("connect").hidden = true;
  $("main").hidden = false;
  $("accountCount").value = cfg.accountCount;
  $("dailyLimit").value = cfg.dailyLimit;
}

function showConnect() {
  $("main").hidden = true;
  $("connect").hidden = false;
  $("who").textContent = "Not connected";
  $("appUrl").value = cfg.appUrl;
  $("token").value = "";
}

/* ------------------------------ the loop ------------------------------ */

function aboutUrl(creator, account) {
  return `${creator.channelUrl.replace(/\/$/, "")}/about?authuser=${account}`;
}

function samePage(statusUrl, creator) {
  try {
    const a = decodeURIComponent(new URL(statusUrl).pathname).toLowerCase();
    const b = decodeURIComponent(new URL(creator.channelUrl).pathname).toLowerCase().replace(/\/$/, "");
    return a === b || a.startsWith(`${b}/`);
  } catch {
    return false;
  }
}

function setState(text, tone = "") {
  const box = $("stateBox");
  box.className = `state ${tone}`;
  box.textContent = text;
}

async function start() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  tabId = tab.id;
  const data = await api(`/api/ext/queue${cfg.listId ? `?listId=${encodeURIComponent(cfg.listId)}` : ""}`);
  queue = data.creators;
  done = 0;
  if (queue.length === 0) {
    log("Nothing to reveal — every creator in this selection has an email.");
    return;
  }
  $("idle").hidden = true;
  $("current").hidden = false;
  next();
}

function stop() {
  current = null;
  queue = [];
  $("current").hidden = true;
  $("idle").hidden = false;
  refreshMe().catch(() => {});
}

function next() {
  const creator = queue.shift();
  if (!creator) {
    log(`Finished — ${done} emails saved this session.`);
    stop();
    return;
  }
  current = { creator, openedAt: 0, handled: false };
  $("curThumb").src = creator.thumbnailUrl || "";
  $("curTitle").textContent = creator.title;
  $("curMeta").textContent = `${creator.listName} · ${creator.subscriberCount.toLocaleString()} subscribers`;
  $("progress").textContent = `${done} saved · ${queue.length} left`;
  openCurrent();
}

function openCurrent() {
  if (!current) return;
  const account = pickAccount();
  if (account < 0) {
    setState(`All ${cfg.accountCount} accounts have used today's reveals. Add another Google account, or continue tomorrow.`, "bad");
    return;
  }
  if (account !== cfg.account) {
    log(`Switched to account ${account + 1}.`);
    cfg.account = account;
    saveConfig();
    renderAccounts();
  }
  current.openedAt = Date.now();
  current.handled = false;
  setState("Opening the About panel…");
  chrome.tabs.update(tabId, { url: aboutUrl(current.creator, account) });
}

async function record(outcome, email) {
  const data = await api("/api/ext/reveal", { creatorId: current.creator.id, outcome, email, accountIndex: cfg.account });
  me.today = data.today;
  renderAccounts();
}

async function onStatus(status) {
  if (!current || current.handled) return;
  // Ignore the page we just navigated away from.
  if (Date.now() - current.openedAt < 1200 || !samePage(status.url, current.creator)) return;

  switch (status.state) {
    case "loading":
      setState("Opening the About panel…");
      break;
    case "needs-click":
      setState("Click “…more” under the channel name on the page to open the About panel.", "warn");
      break;
    case "ready":
      setState("Click the highlighted “View email address” button on the page and complete YouTube's check. The email saves automatically.");
      break;
    case "captcha":
      setState("Complete YouTube's check on the page…");
      break;
    case "signed-out":
      setState(`Account ${cfg.account + 1} isn't signed in on YouTube. Sign in (avatar → Add account), or lower “Google accounts signed in”.`, "warn");
      break;
    case "no-email":
      setState("This channel doesn't offer a “View email address” button. Press “No email here” to move on.", "warn");
      break;
    case "limit": {
      current.handled = true;
      log(`Account ${cfg.account + 1} reached YouTube's daily limit.`);
      await record("limit").catch((err) => log(err.message));
      openCurrent();
      break;
    }
    case "revealed": {
      current.handled = true;
      setState(`Saving ${status.email}…`, "ok");
      try {
        await record("revealed", status.email);
        done++;
        log(`${current.creator.title}: ${status.email}`);
        setState(`Saved ${status.email}`, "ok");
        setTimeout(next, 900);
      } catch (err) {
        current.handled = false;
        setState(`Couldn't save: ${err.message}`, "bad");
      }
      break;
    }
    default:
      setState("The tab left this channel. Press Skip, or reopen it from the list.", "warn");
  }
}

/* ------------------------------ wiring ------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "cg-status" && sender.tab?.id === tabId) onStatus(msg.status);
});

$("connectBtn").onclick = () => connect();
$("disconnectBtn").onclick = async () => {
  stop();
  cfg.token = "";
  await saveConfig();
  showConnect();
};
$("startBtn").onclick = () => start().catch((err) => log(err.message));
$("stopBtn").onclick = () => stop();
$("skipBtn").onclick = () => {
  if (current) log(`Skipped ${current.creator.title}.`);
  next();
};
$("noEmailBtn").onclick = async () => {
  if (!current || current.handled) return;
  current.handled = true;
  try {
    await record("none");
    log(`${current.creator.title}: no public email.`);
  } catch (err) {
    log(err.message);
  }
  next();
};
$("listSelect").onchange = (e) => {
  cfg.listId = e.target.value;
  saveConfig();
  refreshMe().catch((err) => log(err.message));
};
$("accountCount").onchange = (e) => {
  cfg.accountCount = Math.min(Math.max(Number(e.target.value) || 1, 1), 10);
  if (cfg.account >= cfg.accountCount) cfg.account = 0;
  saveConfig();
  renderAccounts();
};
$("dailyLimit").onchange = (e) => {
  cfg.dailyLimit = Math.min(Math.max(Number(e.target.value) || 10, 1), 50);
  saveConfig();
  renderAccounts();
};

(async () => {
  await loadConfig();
  if (!cfg.appUrl || !cfg.token) return showConnect();
  try {
    showMain();
    await refreshMe();
  } catch (err) {
    showConnect();
    $("connectError").textContent = `${err.message} — reconnect with a new key.`;
  }
})();
