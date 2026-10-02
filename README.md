# Tab Unloader

> Free browser RAM without closing tabs.

**Tab Unloader** is a lightweight, privacy-friendly Chrome extension (Manifest V3) that discards inactive tabs from memory using the native `chrome.tabs.discard()` API. Your tabs remain open in the tab strip with their titles and favicons preserved—simply click on them to reload whenever you want.

---

## ✨ Features

- **Unload Current Tab:** Instantly suspend the active tab via shortcut or popup.
- **Unload Other Tabs:** Discard all other unpinned tabs in one click.
- **Right-Click Context Menu:** Quick unload actions directly on any page or the tab strip.
- **Keyboard Shortcuts:** Built-in configurable shortcuts (default: `Alt+U`).
- **Tab Popup Search & Filter:** Filter open tabs and unload individually.
- **Zero Tracking & Minimal Permissions:** Only requires `tabs` and `contextMenus`.

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
   - Verify in `chrome://extensions` that the extension loads with no errors.
   - Inspect background service worker console (`chrome://extensions` > "Inspect views: service worker") to ensure no uncaught exceptions.

4. **Submit your Pull Request:**
   - Push your branch: `git push -u origin feat/my-awesome-feature`
   - Open a PR against the `main` branch with a clear summary of what was added or fixed.

---

## 📄 License

MIT © [Felipe Andrada](mailto:felipe.andrada@gmail.com)
