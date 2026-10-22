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

let menuSetup = Promise.resolve();

function setupMenus() {
  menuSetup = menuSetup.then(async () => {
    await new Promise((resolve, reject) => {
      chrome.contextMenus.removeAll(() => {
        const error = chrome.runtime.lastError;
        if (error) reject(error);
        else resolve();
      });
    });
    for (const properties of [
      { id: "unload-tab", title: "Unload this tab (keep open)", contexts: ["all"] },
      { id: "unload-others", title: "Unload all other tabs", contexts: ["all"] },
      { id: "unload-tab-strip", title: "Unload tab", contexts: ["tab"] },
    ]) {
      await new Promise((resolve, reject) => {
        chrome.contextMenus.create(properties, () => {
          const error = chrome.runtime.lastError;
          if (error) reject(error);
          else resolve();
        });
      }).catch((error) => {
        const message = error?.message || "";
        const unsupported = properties.id === "unload-tab-strip"
          && /\bcontexts\b/i.test(message) && /must be one of|invalid value|unsupported|not supported/i.test(message);
        reportActionProblems({ ok: false, error: unsupported ? "unsupported-tab-context" : `menu-create-failed:${properties.id}` });
      });
    }
  }).catch(() => {
    reportActionProblems({ ok: false, error: "menu-remove-failed" });
  });
  return menuSetup;
}

chrome.runtime.onInstalled.addListener(setupMenus);
chrome.runtime.onStartup.addListener(setupMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const type = info.menuItemId === "unload-tab-strip" ? "unload-tab" : info.menuItemId;
  if (type === "unload-tab" || type === "unload-others") {
    void handleUnloadRequest({ type, tabId: tab?.id }).then(reportActionProblems).catch(() => {
      reportActionProblems({ ok: false, error: "request-failed" });
    });
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
