const list = document.getElementById("list");
const filter = document.getElementById("filter");
const others = document.getElementById("others");
const bulkInfo = document.getElementById("bulk-info");
const status = document.getElementById("status");
const tooltip = document.getElementById("tab-tooltip");
const numbers = new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 });

let tabs = [];
let invokingTabId;
let tabsReady = false;
let pending = false;
let tabRefresh = 0;
let memoryRefresh = 0;
let tooltipRow;

function validTabId(tabId) {
  return Number.isSafeInteger(tabId) && tabId >= 0;
}

function bulkEligible(tab) {
  return validTabId(tab.id) && tab.id !== invokingTabId && !tab.active && !tab.pinned && !tab.discarded;
}

function systemMemoryText(info) {
  if (!info || !Number.isFinite(info.capacity) || info.capacity <= 0 ||
      !Number.isFinite(info.availableCapacity) || info.availableCapacity < 0 || info.availableCapacity > info.capacity) return null;
  return [info.capacity, info.availableCapacity, info.capacity - info.availableCapacity]
    .map((bytes) => `${numbers.format(bytes / 1024 ** 3)} GiB`);
}

function hideTooltip() {
  tooltip.hidden = true;
  tooltipRow = undefined;
}

function showTooltip(row, tab) {
  tooltipRow = row;
  const details = [
    tab.title || tab.url || "Untitled tab",
    tab.url || "URL unavailable",
    tab.discarded ? "Unloaded" : "Loaded",
  ];
  tooltip.replaceChildren(...details.map((text) => {
    const line = document.createElement("div");
    line.textContent = text;
    return line;
  }));
  tooltip.style.top = "8px";
  tooltip.hidden = false;
  const bounds = row.getBoundingClientRect();
  const height = tooltip.getBoundingClientRect().height;
  tooltip.style.top = `${bounds.bottom + height <= window.innerHeight - 8
    ? bounds.bottom : Math.max(8, bounds.top - height)}px`;
}

function updateActions() {
  const count = tabs.filter(bulkEligible).length;
  others.disabled = pending || !tabsReady || !validTabId(invokingTabId) || count === 0;
  bulkInfo.textContent = "All accessible windows, regardless of search. " + (!tabsReady
    ? "Eligible tabs unavailable."
    : count === 0 ? "No eligible tabs." : `Eligible tabs: ${numbers.format(count)}.`);
  list.setAttribute("aria-busy", String(pending));
  for (const button of list.querySelectorAll("button")) {
    button.disabled = pending || button.dataset.unavailable === "true";
  }
}

function actionResultText(response) {
  if (!response || response.ok !== true || !Array.isArray(response.results) ||
      !response.results.every((result) => result && validTabId(result.tabId) && ["unloaded", "skipped", "failed"].includes(result.status))) {
    return "Unable to unload tabs. Reopen the popup to try again.";
  }
  return ["unloaded", "skipped", "failed"].map((outcome) =>
    `${outcome[0].toUpperCase() + outcome.slice(1)}: ${numbers.format(response.results.filter((result) => result.status === outcome).length)}`
  ).join("; ") + ".";
}

async function submitAction(message) {
  if (pending) return;
  pending = true;
  hideTooltip();
  updateActions();
  status.textContent = "Unloading tabs...";
  try {
    status.textContent = actionResultText(await chrome.runtime.sendMessage(message));
  } catch {
    status.textContent = "Unable to unload tabs. Reopen the popup to try again.";
  } finally {
    await refresh();
    pending = false;
    updateActions();
  }
}

function renderTab(tab) {
  const row = document.createElement("div");
  row.className = "tab" + (tab.discarded ? " discarded" : "");
  row.dataset.tabId = String(tab.id);
  row.tabIndex = 0;
  row.setAttribute("role", "listitem");
  row.setAttribute("aria-describedby", "tab-tooltip");

  const icon = document.createElement("img");
  icon.alt = "";
  if (tab.favIconUrl) icon.src = tab.favIconUrl;
  else icon.style.visibility = "hidden";
  icon.onerror = () => (icon.style.visibility = "hidden");

  const title = document.createElement("span");
  title.className = "title";
  const label = tab.title || tab.url || "Untitled tab";
  title.textContent = (tab.active ? "● " : "") + label;

  const button = document.createElement("button");
  button.textContent = tab.discarded ? "Unloaded" : "Unload";
  button.dataset.unavailable = String(Boolean(tab.discarded) || !validTabId(tab.id));
  button.setAttribute("aria-label", `${button.textContent}: ${label}`);
  button.setAttribute("aria-describedby", "tab-tooltip warning");
  button.addEventListener("click", () => submitAction({ type: "unload-tab", tabId: tab.id }));
  row.addEventListener("mouseenter", () => showTooltip(row, tab));
  row.addEventListener("focusin", () => showTooltip(row, tab));
  row.addEventListener("mouseleave", (event) => {
    if (!row.contains(document.activeElement) && !tooltip.contains(event.relatedTarget)) hideTooltip();
  });
  row.addEventListener("focusout", (event) => {
    if (!row.contains(event.relatedTarget) && !row.matches(":hover") && !tooltip.matches(":hover")) hideTooltip();
  });

  row.append(icon, title, button);
  return row;
}

function render() {
  if (!tabsReady) return;
  const focusedRow = document.activeElement?.closest(".tab");
  const focusedId = focusedRow?.dataset.tabId;
  const focusedButton = document.activeElement?.tagName === "BUTTON";
  const query = filter.value.trim().toLowerCase();
  const visible = tabs.filter((tab) => !query || `${tab.title || ""} ${tab.url || ""}`.toLowerCase().includes(query));
  hideTooltip();
  list.replaceChildren(...visible.map(renderTab));
  if (!visible.length) list.textContent = tabs.length ? "No matching tabs." : "No tabs available.";
  updateActions();
  const replacement = [...list.children].find((row) => row.dataset.tabId === focusedId);
  if (replacement) {
    const button = replacement.querySelector("button");
    (focusedButton && !button.disabled ? button : replacement).focus({ preventScroll: true });
  }
}

async function refreshTabs() {
  const version = ++tabRefresh;
  try {
    const [fresh, current] = await Promise.all([chrome.tabs.query({}), chrome.windows.getCurrent()]);
    if (version !== tabRefresh) return;
    tabs = fresh.sort((first, second) => (second.windowId === current.id) - (first.windowId === current.id));
    invokingTabId = tabs.find((tab) => tab.active && tab.windowId === current.id)?.id;
    tabsReady = true;
    render();
  } catch {
    if (version !== tabRefresh) return;
    tabs = [];
    tabsReady = false;
    hideTooltip();
    list.textContent = "Tabs unavailable. Reopen the popup to try again.";
    updateActions();
  }
}

async function refreshMemory() {
  const version = ++memoryRefresh;
  let values;
  try {
    values = systemMemoryText(await chrome.system.memory.getInfo());
  } catch {
    values = null;
  }
  if (version !== memoryRefresh) return;
  ["memory-total", "memory-available", "memory-used"].forEach((id, index) => {
    document.getElementById(id).textContent = values ? values[index] : "Unavailable";
  });
}

async function refresh() {
  await Promise.all([refreshTabs(), refreshMemory()]);
}

filter.addEventListener("input", render);
others.addEventListener("click", () => submitAction({ type: "unload-others", tabId: invokingTabId }));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideTooltip();
});
tooltip.addEventListener("mouseleave", () => {
  if (!tooltipRow?.contains(document.activeElement)) hideTooltip();
});
list.addEventListener("scroll", hideTooltip);
for (const event of [chrome.tabs.onCreated, chrome.tabs.onUpdated, chrome.tabs.onRemoved,
  chrome.tabs.onActivated, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced, chrome.tabs.onMoved]) {
  event.addListener(refresh);
}
void refresh();
const memoryTimer = setInterval(refreshMemory, 1000);
window.addEventListener("pagehide", () => clearInterval(memoryTimer), { once: true });
