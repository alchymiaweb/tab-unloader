// A tab that is currently displayed can't be discarded, so switch away first.
async function unloadTab(tab) {
  if (!tab || tab.discarded) return;
  if (tab.active) {
    const siblings = await chrome.tabs.query({ windowId: tab.windowId });
    const other = siblings.find((t) => t.id !== tab.id);
    if (!other) return; // only tab in the window, nothing to switch to
    await chrome.tabs.update(other.id, { active: true });
  }
  await chrome.tabs.discard(tab.id);
}

async function unloadOtherTabs(currentTabId) {
  const tabs = await chrome.tabs.query({ active: false, discarded: false });
  await Promise.all(
    tabs.filter((t) => t.id !== currentTabId && !t.pinned).map((t) => chrome.tabs.discard(t.id))
  );
}

const INACTIVE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

async function unloadInactiveTabs(thresholdMs = INACTIVE_THRESHOLD_MS) {
  const now = Date.now();
  const tabs = await chrome.tabs.query({ active: false, discarded: false });
  const inactiveTabs = tabs.filter((t) => {
    if (t.pinned) return false;
    const lastAccess = t.lastAccessed || 0;
    return lastAccess > 0 && now - lastAccess >= thresholdMs;
  });

  await Promise.all(inactiveTabs.map((t) => chrome.tabs.discard(t.id)));
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
    chrome.contextMenus.create({
      id: "unload-inactive",
      title: "Unload inactive tabs (> 1 hour)",
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
      chrome.contextMenus.create(
        { id: "unload-inactive-tab-strip", title: "Unload inactive tabs (> 1 hour)", contexts: ["tab"] },
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
  if (info.menuItemId === "unload-tab" || info.menuItemId === "unload-tab-strip") unloadTab(tab);
  if (info.menuItemId === "unload-others") unloadOtherTabs(tab?.id);
  if (info.menuItemId === "unload-inactive" || info.menuItemId === "unload-inactive-tab-strip") {
    unloadInactiveTabs();
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "unload-current-tab") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  unloadTab(tab);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "unload-tab") {
      const tab = await chrome.tabs.get(msg.tabId);
      await unloadTab(tab);
    } else if (msg.type === "unload-others") {
      await unloadOtherTabs(msg.tabId);
    } else if (msg.type === "unload-inactive") {
      await unloadInactiveTabs(msg.thresholdMs);
    }
    sendResponse({ ok: true });
  })();
  return true;
});
