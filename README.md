# Tab Unloader

> Free browser RAM without closing tabs.

**Tab Unloader** is a lightweight, privacy-friendly Chrome extension (Manifest V3) that discards inactive tabs from memory using the native `chrome.tabs.discard()` API. Your tabs remain open in the tab strip with their titles and favicons preserved—simply click on them to reload whenever you want.

---

## ✨ Features

- **Unload Current Tab:** Unload the active tab via shortcut or popup when a loaded sibling is available.
- **Unload Other Tabs:** Discard eligible inactive, unpinned, loaded tabs across all accessible windows, regardless of popup search.
- **Right-Click Context Menu:** Quick unload actions on pages, with an optional tab-strip entry on supporting Chrome versions.
- **Keyboard Shortcuts:** Built-in configurable shortcuts (default: `Alt+U`).
- **Tab Popup Search & Filter:** Filter open tabs and unload individually.
- **System RAM Overview:** Total, available, and in-use physical RAM, labeled as system-wide rather than Chrome's usage. Failed or invalid readings show "Unavailable."
- **Tab Details:** Hover or keyboard-focus a row for its full title, URL, and loaded/unloaded state; Escape dismisses the tooltip.
- **Zero Tracking & Minimal Permissions:** `tabs` for listing/unloading, `contextMenus` for menu actions, and `system.memory` for physical RAM readings. No analytics, URL history, content scripts, or background polling.

### Unloading and Memory Limits

Unloading may lose unsaved changes. Tabs reload when revisited. The popup reports unloaded, skipped, and failed counts, rather than treating every requested tab as a success.

Explicit single-tab actions (popup, page/tab-strip menu, or `Alt+U`) may unload pinned tabs. To unload an active tab, the extension first activates an already-loaded sibling in the same window. With no suitable loaded sibling, it skips the action instead of waking an unloaded tab. Bulk unloading never unloads active or pinned tabs and rechecks each candidate before discarding.

System readings use GiB (1,073,741,824 bytes). Chrome Stable's tab API does not expose per-tab RAM, so loaded rows and potential savings currently show **"Estimate unavailable"**; unloaded rows show **"Unloaded,"** not measured zero RAM. An empty eligible set shows **"No eligible tabs."** A system RAM change is not evidence of memory saved by an individual tab.

The estimate model in `popup.js` remains unset. As of October 22, 2026, no Chrome Task Manager calibration is recorded. The unpacked extension has been tested with isolated Chrome for Testing 156.0.8078.47 on Ubuntu 26.04.1 LTS x86_64 (headless). Before enabling any MiB range (1,048,576 bytes per MiB), record the date, exact Chrome version/OS, memory column, repeatable page states, independent sample count/range, and shared-renderer limitations beside that model. Never count shared renderers as independent tab samples. Even a calibrated eligible-count-times-range would be modeled potential, not measured or guaranteed savings.

This is feature 01's measured-only implementation checkpoint, not completion of the estimate scope. All 16 Node checks and 13 real-Chrome scenarios at each of two virtual screen sizes (800x600 and 1280x900) pass, including popup actions, keyboard tooltips, pointer transfer, and constrained-height layout. Native OS shortcut/menu interaction, human assistive-technology checks, and estimate calibration remain unverified; the existing store screenshots have not been refreshed. See `PLAN.md` for evidence and the feature 02 handoff.

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
