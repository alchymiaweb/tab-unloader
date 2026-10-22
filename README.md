# Tab Unloader

> Free browser RAM without closing tabs.

**Tab Unloader** is a lightweight, privacy-friendly Chrome extension (Manifest V3) that discards inactive tabs from memory using the native `chrome.tabs.discard()` API. Your tabs remain open in the tab strip with their titles and favicons preserved—simply click on them to reload whenever you want.

---

## ✨ Features

- **Unload Current Tab:** Unload the active tab via shortcut or popup when a loaded sibling is available.
- **Unload Other Tabs:** Discard eligible inactive, unpinned, loaded tabs across all accessible windows, regardless of popup search.
- **Right-Click Context Menu:** Quick unload actions on pages and the extension icon, plus an optional tab-strip entry on supporting Chrome versions.
- **Keyboard Shortcuts:** Built-in configurable shortcuts (default: `Alt+U`).
- **Tab Popup Search & Filter:** Filter open tabs and unload individually.
- **Live System RAM Overview:** Total, available, and in-use physical RAM from Chrome's system memory API, refreshed every second while the popup is open. Labeled as system-wide rather than Chrome's usage; failed or invalid readings show "Unavailable."
- **Zero Tracking & Minimal Permissions:** `tabs` for listing/unloading, `contextMenus` for menu actions, and `system.memory` for physical RAM readings. No analytics, URL history, content scripts, or background polling.

### Unloading and Memory Limits

Unloading may lose unsaved changes. Tabs reload when revisited. The popup reports unloaded, skipped, and failed counts, rather than treating every requested tab as a success.

Explicit single-tab actions (popup, page/tab-strip menu, or `Alt+U`) may unload pinned tabs. To unload an active tab, the extension first activates an already-loaded sibling in the same window. With no suitable loaded sibling, it skips the action instead of waking an unloaded tab. Bulk unloading never unloads active or pinned tabs and rechecks each candidate before discarding.

System readings use GiB (1,073,741,824 bytes). Total and available RAM come directly from `chrome.system.memory.getInfo()`; in-use RAM is total minus available, never a calculation based on the number of tabs. Readings refresh on popup open, every second while it remains open, on tab lifecycle changes, and after unload actions. Polling stops when the popup closes; no background polling runs.

Chrome Stable's tab API does not expose per-tab RAM, so the extension does not estimate per-tab memory or potential savings. Rows show tab titles and loaded/unloaded state without hover tooltips, and the bulk action shows the eligible-tab count. An empty eligible set shows **"No eligible tabs."** A system RAM change is not evidence of memory saved by an individual tab. See `PLAN.md` for verification history and remaining browser checks.

### Tab-Strip Menu Support

Right-click a browser tab and choose **"Unload tab"** without opening the popup. This targets only the right-clicked tab, even when it is inactive or multiple tabs are highlighted. Already-unloaded or closed targets are skipped; active targets follow the loaded-sibling policy described above.

Chrome introduced extension tab-strip menus in **Chrome 150**. Native tab-strip, page, extension-icon, and `Alt+U` actions are verified with **Chrome for Testing 156.0.8078.47 (Stable channel)** on Ubuntu 24.04.4 LTS / WSL2 using Xvfb. Other versions and platforms are not verified. On browsers without tab-strip menu support, use the popup, page or extension-icon menus, or the shortcut; this optional entry does not raise the extension's minimum Chrome version.

Menu rebuilding is serialized across lifecycle events to avoid duplicate entries. Unsupported tab contexts and unrelated registration failures produce distinct, bounded worker diagnostics without logging tab titles or URLs. Local unpacked installations must keep Developer mode enabled when reloading the extension.

---

## 🚀 Installation & Local Development

Tab Unloader requires no build steps or heavy dependencies—it's pure vanilla HTML, CSS, and modern JavaScript!

1. **Clone the repository:**
   ```bash
   git clone https://github.com/alchymiaweb/tab-unloader.git
   cd tab-unloader
   ```

2. **Load the extension into Chrome:**
   - Open Chrome and navigate to `chrome://extensions`.
   - Enable **Developer mode** (toggle in the top-right corner).
   - Click **Load unpacked**.
   - Select the `tab-unloader` project folder.

3. **Reload changes:**
   - When modifying `background.js`, click the refresh icon on the extension card in `chrome://extensions`.
   - For `popup.html` or `popup.js`, closing and reopening the extension popup is sufficient.

---

## 🤝 Contributing

Contributions are very welcome! Whether you have an idea for an unload strategy, a UI polish, or a bug fix, feel free to open an issue or submit a Pull Request.

### Workflow for Pull Requests

1. **Fork** or create a new branch from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/my-awesome-feature
   ```

2. **Keep PRs atomic & independent:**
   - Focus on one single feature, context menu action, or bug fix per branch/PR.
   - Maintain vanilla JS compatibility and clean coding conventions.

3. **Test locally:**
   - Run `node checks.cjs`, `node --check background.js`, and `node --check popup.js` for framework-free mocked checks and syntax validation.
   - Verify in `chrome://extensions` that the extension loads with no errors.
   - Inspect background service worker console (`chrome://extensions` > "Inspect views: service worker") to ensure no uncaught exceptions.

4. **Submit your Pull Request:**
   - Push your branch: `git push -u origin feat/my-awesome-feature`
   - Open a PR against the `main` branch with a clear summary of what was added or fixed.

---

## 📄 License

MIT © [Felipe Andrada](mailto:felipe.andrada@gmail.com)
