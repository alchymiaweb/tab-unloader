function validTabId(tabId) {
  return Number.isSafeInteger(tabId) && tabId >= 0;
}

function bulkSkipReason(tab, invokingTabId) {
  if (tab.id === invokingTabId) return "invoking-tab";
  if (tab.active) return "active-tab";
  if (tab.pinned) return "pinned-tab";
  if (tab.discarded) return "already-unloaded";
}

async function unloadTab(tabId, bulk = false, invokingTabId) {
  let failureReason = "tab-read-failed";
  try {
    let tab = await chrome.tabs.get(tabId);
    if (tab.discarded) return { tabId, status: "skipped", reason: "already-unloaded" };
    if (bulk) {
      const reason = bulkSkipReason(tab, invokingTabId);
      if (reason) return { tabId, status: "skipped", reason };
    } else if (tab.active) {
      failureReason = "tab-query-failed";
      const siblings = await chrome.tabs.query({ windowId: tab.windowId });
      const other = siblings.find((sibling) => validTabId(sibling.id) && sibling.id !== tabId && !sibling.discarded);
      if (!other) return { tabId, status: "skipped", reason: "no-suitable-sibling" };
      failureReason = "sibling-read-failed";
      const sibling = await chrome.tabs.get(other.id);
      if (sibling.discarded || sibling.windowId !== tab.windowId) {
        return { tabId, status: "skipped", reason: "no-suitable-sibling" };
      }
      failureReason = "activation-failed";
      await chrome.tabs.update(sibling.id, { active: true });
      failureReason = "tab-read-failed";
      tab = await chrome.tabs.get(tabId);
      if (tab.discarded) return { tabId, status: "skipped", reason: "already-unloaded" };
      if (tab.active) return { tabId, status: "skipped", reason: "active-tab" };
    }
    failureReason = "discard-failed";
    const discarded = await chrome.tabs.discard(tabId);
    return discarded?.id === tabId && discarded.discarded === true
      ? { tabId, status: "unloaded" }
      : { tabId, status: "failed", reason: "discard-unconfirmed" };
  } catch (error) {
    const closed = /No tab with id|Invalid tab ID/i.test(error?.message || "");
    const reason = failureReason === "sibling-read-failed" || failureReason === "activation-failed"
      ? "no-suitable-sibling" : "tab-closed";
    return { tabId, status: closed ? "skipped" : "failed", reason: closed ? reason : failureReason };
  }
}

async function handleUnloadRequest(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { ok: false, error: "invalid-request" };
  }
  if (message.type !== "unload-tab" && message.type !== "unload-others") {
    return { ok: false, error: "unknown-type" };
  }
  if (!validTabId(message.tabId)) return { ok: false, error: "invalid-tab-id" };
  try {
    if (message.type === "unload-tab") {
      return { ok: true, results: [await unloadTab(message.tabId)] };
    }
    const tabs = await chrome.tabs.query({});
    const candidates = [...new Set(tabs
      .filter((tab) => validTabId(tab.id) && !bulkSkipReason(tab, message.tabId))
      .map((tab) => tab.id))];
    const results = [];
    for (const tabId of candidates) results.push(await unloadTab(tabId, true, message.tabId));
    return { ok: true, results };
  } catch {
    return { ok: false, error: "request-failed" };
  }
}

let diagnosticCount = 0;

function reportActionProblems(response) {
  const problems = response.ok ? response.results.filter((result) => result.status !== "unloaded").slice(0, 5) : response.error;
  if (problems.length && diagnosticCount < 10) {
    diagnosticCount += 1;
    console.warn("Tab Unloader action:", problems);
  }
}

// removeAll first so a reload never hits a duplicate-id error that silently skips creation.
function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "unload-tab",
      title: "Unload this tab (keep open)",
      contexts: ["all"],
    });
    chrome.contextMenus.create({
      id: "unload-others",
      title: "Unload all other tabs",
      contexts: ["all"],
    });
    // Experimental: the "tab" context targets the tab-strip right-click menu. Chrome versions
    // that don't support it reject the enum value, so create it separately and ignore failure.
    // Unsupported Chrome versions throw synchronously on the enum value, hence the try/catch.
    try {
      chrome.contextMenus.create(
        { id: "unload-tab-strip", title: "Unload tab", contexts: ["tab"] },
        () => void chrome.runtime.lastError
      );
    } catch {
      console.info("Tab-strip context menu not supported in this Chrome version.");
    }
  });
}

chrome.runtime.onInstalled.addListener(setupMenus);
chrome.runtime.onStartup.addListener(setupMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const type = info.menuItemId === "unload-tab-strip" ? "unload-tab" : info.menuItemId;
  if (type === "unload-tab" || type === "unload-others") {
    void handleUnloadRequest({ type, tabId: tab?.id }).then(reportActionProblems);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "unload-current-tab") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    reportActionProblems(await handleUnloadRequest({ type: "unload-tab", tabId: tab?.id }));
  } catch {
    reportActionProblems({ ok: false, error: "tab-query-failed" });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleUnloadRequest(message).then(sendResponse).catch(() => {
    reportActionProblems({ ok: false, error: "response-failed" });
  });
  return true;
});
