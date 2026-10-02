const list = document.getElementById("list");
const filter = document.getElementById("filter");

function renderTab(tab) {
  const row = document.createElement("div");
  row.className = "tab" + (tab.discarded ? " discarded" : "");

  const icon = document.createElement("img");
  icon.src = tab.favIconUrl || "";
  icon.onerror = () => (icon.style.visibility = "hidden");

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = (tab.active ? "● " : "") + (tab.title || tab.url);
  title.title = tab.url;

  const button = document.createElement("button");
  button.textContent = tab.discarded ? "Unloaded" : "Unload";
  button.disabled = tab.discarded;
  button.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "unload-tab", tabId: tab.id });
    render();
  });

  row.append(icon, title, button);
  return row;
}

async function render() {
  const query = filter.value.trim().toLowerCase();
  const tabs = await chrome.tabs.query({});
  const current = await chrome.windows.getCurrent();
  const visible = tabs
    .filter((t) => !query || `${t.title} ${t.url}`.toLowerCase().includes(query))
    .sort((a, b) => (b.windowId === current.id) - (a.windowId === current.id));
  list.replaceChildren(...visible.map(renderTab));
}

filter.addEventListener("input", render);
document.getElementById("others").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: "unload-others", tabId: tab.id });
  render();
});

render();
