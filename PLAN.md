# Tab Unloader improvement plan

Status: feature **01** measured-only checkpoint on `feat/01-ram-overview`, retested on 2026-10-22. **R1 and R2 are resolved:** 16 Node checks and 13 real-Chrome scenarios at each of two screen sizes pass. Commit and push are authorized by the current user request. Estimate calibration/numeric savings remain open, so full feature 01 is not complete. Feature **02** is untouched; accept the measured-only checkpoint before starting it.

## Confirmed scope

- Show system RAM, approximate per-tab RAM, and potential savings from unloading eligible tabs. Estimates must be visibly labeled, never presented as measurements.
- Offer unloading from the browser tab's right-click menu, without opening the popup, where supported.
- Add two list modes: alphabetical by title and grouped by website hostname.
- Replace each row's text unload button with an accessible icon; add checkboxes and an “Unload selected tabs” bulk action.
- Put language and appearance controls inside Settings, not separate controls on the main screen.
- Languages: English, Brazilian Portuguese, Spanish, and Simplified Chinese. Russian, Ukrainian, and German are outside this iteration.
- Use the requested design skills as guidance, not as a CSS/component dependency. Keep vanilla HTML/CSS/JS, no build step, and no React migration. This interprets the clarification “skill, not the CSS library.”

## Existing behavior and constraints

The extension currently has a compact 360px popup, search, individual unloading, an all-other-tabs action, page context menus, a shortcut, and a donation link. Preserve these capabilities and the lightweight identity. This is a task-focused utility, not a dashboard redesign.

- `popup.html` and `popup.js` own the popup; `background.js` owns unloading and menus; `manifest.json` declares permissions.
- The list currently includes accessible tabs across windows, with the current window first. Preserve that scope and priority unless explicitly changed.
- Bulk unloading currently excludes pinned tabs and the active tab in every window. Preserve that protection for both all-other and selected actions. Explicit single-tab unloading may continue to handle pinned or active tabs, switching away first when necessary.
- Tabs stay open, but revisiting them reloads their content. Do not promise preservation of unsaved page state. Keep a short warning visible beside popup actions: “Unloading may lose unsaved changes. Tabs reload when revisited.” Explain shortcut/menu behavior in the README; do not add a confirmation dialog to every action.
- Retain search, shortcut behavior, and the existing donation destination. Do not add analytics, URL history, a backend, content scripts, or broad website permissions.
- Treat tab titles and URLs as untrusted text: use `textContent` and native attributes, never interpolate them into HTML. No new remote assets or dependencies.

## Fixed decisions and build order

- Target desktop Chrome Stable, Manifest V3. Other Chromium browsers are best-effort; a Firefox/mobile port is out of scope. Record the exact browser version and OS during browser checks, rather than claiming untested compatibility.
- Execute **01 → 02 → 03 → 04 → 05 → 06**. Feature 01 starts with the action-result contract below, then the measured RAM overview, then calibrated estimates if evidence permits. Do not implement later features as prerequisites.
- Default preferences are Title A–Z, System appearance, and Browser default language. Keep the existing compact popup and scrollable list; no dashboard, onboarding, options page, or build system.
- “Unload all other tabs” covers all accessible windows regardless of search. Show that scope beside the action. “Unload selected tabs” targets only selected IDs. Search never silently changes the all-other action's scope.
- Keep the current files. Add only one framework-free `checks.cjs` for runnable checks, bundled locale catalogs/shared translation resolver in 06, and a stylesheet if extracting the inline CSS becomes simpler. No new architecture layer.

## Shared action contract — implement first inside 01

- Keep `{ type: "unload-tab", tabId }` and `{ type: "unload-others", tabId }`; add `{ type: "unload-selected", tabIds }` only in 04. Reject unknown types, missing/invalid IDs, and malformed selections without side effects. IDs must be nonnegative safe integers; deduplicate selection IDs.
- Return `{ ok: true, results: [{ tabId, status, reason? }] }` for handled requests. Each status is `unloaded`, `skipped`, or `failed`; `ok` means the request was handled, not that every tab unloaded. Return `{ ok: false, error }` for invalid requests or a request-level API failure. Use stable reason/error codes that the UI can translate later.
- Bulk eligibility is a fresh, valid tab ID with `!active && !pinned && !discarded`; all-other also excludes its invoking `tabId`. Use the same policy for checkbox state, counts, potential estimates, and execution. Freeze the worker's candidate IDs once per request, re-read each immediately before discarding, and never expand a selected request beyond its supplied IDs.
- A single-tab action may unload pinned tabs. For an active target, choose an already-loaded sibling in the same window before discarding; if none exists, return `skipped` with `no-suitable-sibling`. Do not wake an unloaded sibling merely to unload the current tab. Revalidate the target after switching.
- Collect per-tab outcomes independently; one closed tab or rejected discard must not abort the others. Already-unloaded/closed/protected tabs are skips, not successes. Confirm the discard result reports `discarded`; an undefined result is not automatically success. Derive displayed counts only from the results, not from the requested count.
- Catch API rejections in message, menu, and shortcut entry points. Keep the existing asynchronous `sendResponse`/`return true` pattern and respond once on every handled path. Register worker listeners synchronously; future preference loading happens inside handlers. Do not add automatic retries or a persistent job queue.
- Disable popup unload controls while its request is pending; expose progress/results through a polite live region and restore controls after failure. A closed popup must not change the worker's target set; reopening queries fresh data. Menu/shortcut failures use bounded worker diagnostics without recording titles or URLs; no notification permission is added.

### Verified Chrome API boundaries

Checked against the official documentation on 2026-10-21; actual browser behavior still needs testing during implementation.

1. [`chrome.system.memory.getInfo()`](https://developer.chrome.com/docs/extensions/reference/api/system/memory) exposes total and available physical RAM with the `system.memory` permission. Total minus available is a **system-wide** usage indicator, not Chrome's RAM usage.
2. [`chrome.tabs.Tab`](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab) does not expose per-tab RAM. [`chrome.processes`](https://developer.chrome.com/docs/extensions/reference/api/processes) is documented as Dev-channel-only; do not depend on it for a Stable release. JavaScript heap size alone would not represent full tab RAM either.
3. The current [`contextMenus.ContextType`](https://developer.chrome.com/docs/extensions/reference/api/contextMenus#type-ContextType) documents `"tab"`; `"all"` explicitly excludes it. The Chrome Extensions team's [May 15, 2026 announcement](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/RReE8dtY4Ok) identifies **Chrome 150** as its introduction and confirms that the event targets the right-clicked tab, not every highlighted tab. The existing worker already attempts a separate tab-strip menu; harden it rather than duplicating it. Keep fallbacks on older versions; do not raise the whole extension's minimum version solely for this optional menu.
4. Our RAM tooltip can appear on popup rows. There is no documented extension API for replacing Chrome's native tab-hover card or reading its RAM value.
5. RAM released cannot be reliably attributed to a tab from a system before/after difference: other applications, shared renderer processes, and retained caches affect the result. Do not claim exact or cumulative “RAM saved,” or infer time saved from MB.
6. [`chrome.i18n.getMessage()`](https://developer.chrome.com/docs/extensions/reference/api/i18n#method-getMessage) takes a message name, substitutions, and options, not a chosen locale. Feature 06 therefore needs a shared bundled-catalog resolver for its explicit language override; browser-owned metadata remains browser-localized.

## 01 — RAM overview, row tooltips, and potential savings

**Goal:** understand memory pressure and the approximate benefit before unloading.

- [x] Implement the shared action contract before adding RAM-dependent result displays. Cover malformed messages, mixed outcomes, and active/pinned protection in `node checks.cjs`.
- [x] Add `system.memory` permission and read total/available RAM when the popup opens and after an unload action. Keep this read independent of unloading success. No background polling or waking unloaded tabs to inspect them. Update the README's permission list when the permission is added.
- [x] Show a compact system-memory summary above the search/list: total, available, and total-minus-available, explicitly labeled as system RAM. Accept only finite numbers with `capacity > 0` and `0 <= availableCapacity <= capacity`; invalid data is unavailable, not clamped into a plausible reading. Use GiB for system RAM and MiB for tab estimates, binary divisors, and locale-aware formatting with at most one decimal place. System fixtures verified; numeric tab estimates remain gated.
- [ ] Establish a documented, coarse estimate model before shipping any per-tab figures. Record Chrome Task Manager observations of repeatable representative page states, including date, browser/OS, memory column, sample count, range, and shared-process limitations. Do not count one shared renderer as several independent tab samples; if attribution cannot support a per-tab baseline, keep the gate closed. Do not invent site-specific values from URLs or add measurement permissions.
- [ ] Use one documented per-loaded-tab range consistently, labeled “Estimated,” with a caveat that it is modeled rather than read from Chrome. Potential savings are eligible-count times that range, not a ranking of individual tabs, a confidence interval, or a guarantee. Keep model values unset until calibration exists.
- [x] On row hover **and keyboard focus**, expose full title, URL, loaded/unloaded state, and RAM limitations. Keep the tooltip noninteractive, dismissible with Escape, and within the popup bounds. Real Chrome verifies keyboard focus, Escape, safe text, bounds, and pointer persistence after the R1 fix. Numeric RAM remains gated; loaded rows explicitly show "Estimate unavailable".
- [ ] Under “Unload all other tabs,” show eligible-tab count and estimated potential savings from exactly that eligible set. Exclude pinned, active, already-unloaded, and invoking tabs. Disable the bulk action when the eligible count is zero; display “No eligible tabs,” not an unavailable estimate or a measured zero saving.
- [x] Show unloaded tabs as “Unloaded,” not a measured “0 MB.” Failed or unsupported memory reads show “Unavailable,” never a fabricated zero.
- [x] After unloading, report unloaded/skipped/failed counts. Any potential figure based on successful unloads remains modeled, not proof of reclaimed physical RAM. Refresh the list, eligibility, and system reading; while the popup is open, also refresh on tab lifecycle changes and ignore stale asynchronous render results.

**Measured-only checkpoint:** eligible counts, all-window/search-independent scope, zero-eligible disabling, real system RAM, unload results, pointer/keyboard tooltips, and constrained-height layout are verified in unpacked Chrome for Testing 156.0.8078.47 on Ubuntu 26.04.1 LTS x86_64 (headless). The 2026-10-22 retest passed 13/13 scenarios on both 800x600 and 1280x900 virtual screens, plus 16 Node checks. R1 and R2 are resolved. Loaded rows and potential savings show "Estimate unavailable"; `tabMemoryRangeBytes` stays `null`. Calibration, numeric estimates, and the numeric-savings checkbox remain open. Evidence is logged below; this is not full feature-completion or release approval.

**Estimate gate:** if there is no defensible calibration, finish the measured system overview and show “Estimate unavailable” for loaded tabs/potential savings; leave those implementation checkboxes pending. Record a measured-only checkpoint for review, not “01 complete.” Later features can proceed after that checkpoint is accepted, but the requested estimate scope remains open. Shared processes mean even calibrated totals remain rough potential, not guaranteed savings.

**Files:** `manifest.json`, `popup.html`, `popup.js`, `background.js`, `README.md`, `checks.cjs`. Record calibration beside the model rather than creating a separate reporting system.

**Done when:** a fixed RAM fixture formats correctly; unavailable/invalid data is handled; eligibility and estimates agree with the actual bulk action; unloading failures do not appear as successes. Verify tooltips by mouse and keyboard in real Chrome.

## 02 — Unload from the tab-strip right-click menu

**Goal:** right-click a browser tab and choose “Unload tab” without opening the extension.

- [ ] Test the existing `unload-tab-strip` registration on a Stable Chrome version supporting the Chrome 150 addition and record its exact version/platform. Mock unsupported-context behavior as well; do not install an obsolete browser just to test the fallback.
- [ ] Retain explicit `contexts: ["tab"]` registration and the existing shared unload function. Keep page and extension-icon menu fallbacks and `Alt+U` working.
- [ ] Gracefully handle an unsupported context, but distinguish it from unrelated registration failures instead of silently swallowing every error.
- [ ] Always act on the right-clicked tab, even when it is inactive or other tabs are highlighted. Use the shared single-tab policy; never interpret browser highlighting as popup bulk selection.
- [ ] Keep fixed menu IDs and serialize menu rebuilding across install, update, restart, extension reload, and future language changes. Report creation errors from callbacks as well as synchronous throws. Update README claims to distinguish Chrome 150 introduction from the versions actually tested.

**Files:** `background.js`, `README.md`.

**Done when:** inactive-tab, active-tab, only-tab, already-unloaded, closed-tab, and unsupported-browser cases behave correctly; no uncaught worker errors or duplicate entries occur.

## 03 — Alphabetical sorting and website grouping

**Goal:** make long lists easier to scan using exactly two modes.

- [ ] Add one labeled selector: “Title A–Z” and “Group by website.” Default to Title A–Z. Keep current-window tabs first, with visible “Current window” and “Other windows” sections when both exist; combine the other windows into the latter section and apply the chosen mode within each section.
- [ ] Sort titles with `Intl.Collator` using the effective UI locale and case-insensitive/numeric comparison, falling back to URL when a title is absent, then an “Untitled tab” label. Break ties by numeric tab ID so refreshes are deterministic.
- [ ] For website grouping, use `new URL(...).hostname` for HTTP(S), with hostname headings sorted by the same collator and titles sorted inside each group. Keep subdomains distinct. Put other schemes, missing URLs, and invalid URLs in a final “Other pages” group without exposing file paths in headings.
- [ ] Apply the existing title/URL search before rendering either mode. Do not move real browser tabs or create Chrome tab groups.
- [ ] Keep selection stable through sorting once feature 04 exists. Persist the mode when feature 05 introduces settings storage; no separate persistence layer now.

**Files:** `popup.html`, `popup.js`.

**Done when:** accented titles, duplicate titles, subdomains, non-web URLs, multiple windows, and no search results render deterministically. Browser tab order remains unchanged.

## 04 — Icon actions and selected-tab unloading

**Goal:** unload specific tabs in one operation without filling every row with text buttons.

- [ ] Replace the row's “Unload” text button with a local SVG icon button. Give it a translated-ready accessible name including the tab title, a visible focus state, and a tooltip; distinguish unloaded/pending/failed states without relying only on color.
- [ ] Add a labeled native checkbox for each bulk-eligible tab. Disable selection for active, pinned, or already-unloaded tabs and explain why. Keep explicit single-tab actions separate from bulk eligibility.
- [ ] With no selections, retain “Unload all other tabs.” With selections, change it to “Unload selected tabs (N)” and calculate potential savings from that selection only.
- [ ] Offer “Clear selection.” Changing the search clears selection with an accessible status message, so hidden tabs cannot be unloaded accidentally. Sorting retains selected IDs. Selection does not persist after closing the popup.
- [ ] Revalidate IDs and eligibility in the worker immediately before unloading; tabs may have closed, become active/pinned, or already unloaded. Process results independently so one failure does not hide other successes.
- [ ] Prevent duplicate submissions, clear successful selections, retain actionable failures, and refresh counts and estimates from fresh tab data. Remove closed/newly protected/already-unloaded tabs from selection and announce that change. Disable changing search, sort, or selection during submission; do not auto-retry failed tabs.

**Files:** `popup.html`, `popup.js`, `background.js`.

**Done when:** keyboard-only selection works, filtering cannot trigger hidden selections, sorting preserves selection, protected tabs are skipped, and mixed-success operations report accurate outcomes.

## 05 — Settings and appearance

**Goal:** keep preferences discoverable without cluttering the tab list.

- [ ] Add a labeled gear button in the popup header opening a simple Settings view in the same popup, with a Back button. Move focus into the view and restore it on return; Escape returns to the list.
- [ ] Add appearance choices: System, Light, Dark. Default to System; use CSS variables and `prefers-color-scheme`, with a saved manual override.
- [ ] Introduce `chrome.storage.local` and the `storage` permission for preferences only. Store only `appearance` (`system`/`light`/`dark`) and `listMode` (`title`/`website`); add `language` in 06, not a nonfunctional control now. Validate each value against its allowed choices and default independently. On save failure, keep the current popup usable and announce that the choice was not saved. Update the README's permission list.
- [ ] Theme every control, tooltip, status, checkbox, and the donation link coherently. Keep readable contrast and avoid flashing the wrong saved theme while controls appear.
- [ ] Follow shadcn-style restraint and accessibility using native controls; no UI library, theme package, animation framework, or build tooling.

**Files:** `manifest.json`, `popup.html`, `popup.js`; a CSS file only if moving the existing inline styles makes the theme change simpler.

**Done when:** all three appearance choices behave correctly, System reacts to OS changes, preferences survive reopening/restarting, invalid settings recover safely, and both themes remain keyboard accessible.

## 06 — Four languages, selected inside Settings

**Goal:** localize the complete extension with browser defaults and an explicit override.

- [ ] Add Chrome locale catalogs for `en`, `pt_BR`, `es`, and `zh_CN`, with English fallback and `default_locale` in the manifest.
- [ ] Inside Settings only, offer Browser default, English, Português (Brasil), Español, and 简体中文. Save the override in the existing preference storage.
- [ ] Use native `chrome.i18n` for browser-selected manifest strings. Use one small `i18n.js` resolver over the same bundled catalogs for popup/menu strings, including browser-default mode; load it before `popup.js` and through `importScripts` in the classic worker. Store `language` as `browser`/`en`/`pt_BR`/`es`/`zh_CN`. For browser default, normalize hyphens/underscores, try the exact UI locale, then its base-language catalog, then English. Missing keys fall back to English; missing English keys fail the check. No i18n dependency or duplicated catalogs.
- [ ] Translate search labels, both sorting modes, RAM caveats, tooltips, accessible names, actions, results/errors, warnings, settings, context menus, shortcut description, and donation text. Rebuild menu labels after a language change and restore the preference when the worker restarts.
- [ ] Set the document's BCP 47 language, format numbers/units with `Intl`, re-sort with the effective locale, and use catalog placeholders for complete count/status messages rather than English-only concatenation. Prefer neutral count labels over introducing a pluralization engine. Manifest metadata and Chrome's own UI continue to follow the browser locale, not our manual override.
- [ ] Preserve literal tab titles and URLs; test long Portuguese/Spanish strings and Chinese text without clipping action controls.

**Files:** `manifest.json`, `popup.html`, `popup.js`, `background.js`, four `_locales/*/messages.json` catalogs, and one shared resolver if needed.

**Done when:** changing language updates popup and extension menu strings; browser-default and English-fallback cases work; every catalog has matching keys/placeholders; all four languages work in both themes.

## Completion rule for each future task

1. Implement only the selected numbered feature and its necessary error handling. Validate message types/IDs at the worker boundary; every request must receive a truthful result, including partial failures and skips.
2. Create `checks.cjs` in 01 using Node's built-in assertions and fixed Chrome API mocks; extend that single file in later tasks. Run it with `node checks.cjs`, plus `node --check` on changed JavaScript. Check arithmetic, ordering, eligibility, results, settings, and locale completeness as applicable; no package manager or test framework.
3. Test the unpacked extension in Chrome, inspect worker errors, and capture the changed popup states for UI features. Record version/OS, steps, and observed outcome in the verification log below. Browser-only claims remain unverified until that browser check is performed; mocks do not substitute for it.
4. Update this file's checkboxes and record passed/failed/not-run checks honestly. Keep permission/support documentation current; stop for review before starting the next feature. Do not commit, push, or publish unless requested.

## Release acceptance

- [ ] All six feature sections meet their done-when criteria. A measured-only 01 checkpoint does not close the estimate requirements; either calibrate them or explicitly agree a reduced release scope before calling the iteration complete.
- [ ] The runnable check covers invalid memory readings, unavailable estimates, malicious/missing titles/URLs, deterministic grouping, duplicate/invalid IDs, mixed discard results, and tabs changing active/pinned/closed state during an action.
- [ ] Real Chrome checks cover multiple windows, active/pinned/only-tab cases, search/selection transitions, tab-strip/page/action menus, `Alt+U`, popup closure mid-action, and menu/preferences behavior after a worker restart.
- [ ] Keyboard-only navigation, tooltip dismissal, checkbox explanations, focus restoration, accessible result announcements, empty/error/pending states, and scrolling work at the compact popup size. Test all four languages in both light and dark themes, System theme changes, browser-default fallback, and corrupt/missing preferences.
- [ ] README and final store screenshots describe only verified behavior and the final permissions (`tabs`, `contextMenus`, `system.memory`, `storage`); all memory figures/caveats remain truthful. No new analytics, website permissions, remote code, or dependency/build tooling appears.

## Verification log

Feature 01 review performed on 2026-10-21; the final browser run ended at 23:53:06 UTC. Only this plan is changed by the review; existing implementation changes are preserved. No feature 02 implementation, commit, push, or publication is performed.

Browser setup: downloaded the Stable-channel Linux64 **Google Chrome for Testing 156.0.8078.47** from the Chrome for Testing distribution into `/tmp/tab-unloader-review-3UFSes`, using a fresh, isolated profile on **Ubuntu 26.04.1 LTS, x86_64**. Enabled Developer mode in `chrome://extensions`; the unpacked project is extension `gmjniplpobjggpfopecnabnmnjeohfka`. Used unified headless Chrome, a 1280x900 virtual screen, `--load-extension` pointing at this checkout, and the actual action popup opened with `chrome.action.openPopup()`, not just a popup page in a normal tab. The host rejected Chrome's sandbox, so this test process used `--no-sandbox`; fixtures were loopback pages. This is automated real-Chrome evidence, not a human desktop/assistive-technology check or proof for other browser/OS versions.

| Feature/check | Command or browser version/OS | Steps or fixture | Outcome |
| --- | --- | --- | --- |
| Planning API review, 2026-10-21 | Official sources linked above | Memory, tab/menu boundaries, explicit-locale constraint | Documentation checked; runtime not tested |
| 01 automated checks, rerun 2026-10-21 | `node checks.cjs`, Node v26.7.0 | Malformed messages; per-tab outcomes; protected/closed/racing tabs; loaded siblings; bounded diagnostics; popup closure; strict GiB fixtures; search scope; safe text; mocked tooltips; pending/error states; stale refreshes | Passed: 15 checks. The existing mock tooltip check does not cover crossing a real adjacent row |
| 01 syntax, rerun 2026-10-21 | `node --check background.js`; `node --check popup.js`; `node --check checks.cjs` | Existing feature 01 JavaScript | Passed: all three commands |
| 01 unpacked load and real RAM | Chrome for Testing 156.0.8078.47 / Ubuntu 26.04.1 LTS x86_64 | Inspect manifest, granted permissions, and actual `chrome.system.memory.getInfo()` | Passed: only `tabs`, `contextMenus`, `system.memory`; sample capacity 16,763,596,800 bytes and available 5,034,577,920 bytes. UI shows binary GiB, including total 15.6 GiB; available readings vary |
| 01 popup layout, search, and estimates | Same browser/OS; 1280x900 virtual screen | Open action popup with 16 fixture tabs across two windows, including pinned, active, already-unloaded, and long/untrusted titles; search for no matches | Passed: popup 360x600 CSS pixels; list client/scroll heights 266/464; current-window rows first; no-match state renders; eligible count remains 12 regardless of search. Model is `null`; potential savings remain "Estimate unavailable" |
| 01 mouse/keyboard tooltip | Same browser/OS; CDP mouse movement and Tab/Escape input | Focus row/button, hover row, inspect full literal title/URL and bounds, dismiss with Escape, refresh a tab while its button is focused | Passed: focus/hover show details; Escape hides tooltip without closing popup; focus is retained after refresh; long title remains text, not injected HTML. Pointer transfer fails separately in R1 |
| 01 tooltip pointer persistence | Same browser/OS | With search focused, hover "Inactive candidate", then move through the 4px gap toward its tooltip | **Failed:** tooltip changes to the adjacent long-title row rather than retaining the original details. Final browser suite: **11 passed, 1 failed**; see R1 |
| 01 all-other and individual actions | Same browser/OS; real tabs and native discard API | Search down to one visible candidate and click bulk action; then test an individual popup button, explicit pinned/active actions, only-tab/no-loaded-sibling, already-unloaded, and closed IDs | Passed: bulk reports `Unloaded: 12; Skipped: 0; Failed: 0.` across both windows, protects pinned/active tabs, and leaves already-unloaded tabs alone. Zero eligible disables the button. Individual action reports one unload; active target switches to a loaded sibling; expected skip reason codes are returned without waking unloaded siblings |
| 01 lifecycle and popup closure | Same browser/OS; temporary first-discard timing gate | Create/remove tabs while popup is open. Pause the first native discard, start the popup action, verify pending controls, close popup before any discard, then release the gate with native API restored | Passed: live list refreshes; pending status is "Unloading tabs...", `aria-busy=true`, and unload buttons are disabled. All three frozen candidates unload after popup closure. Reopening queries fresh data and shows 17 unloaded tabs, no eligible tabs, and a fresh system reading |
| 01 unavailable/error rendering | Same browser/OS; explicitly injected faults | Temporarily reject popup memory reads and message transport; restore original methods | Passed: all three RAM fields show "Unavailable" rather than zero; request failure is announced; `aria-busy=false` and eligible row controls recover. These are browser-rendered fault injections, not naturally observed API failures |
| 01 worker and extension errors | Same browser/OS | Capture worker/popup `Runtime.exceptionThrown`, worker diagnostics, and `chrome://extensions` error inventory after scenarios | Passed: extension enabled; zero observed uncaught exceptions, worker diagnostics, manifest errors, or runtime errors. Not a guarantee about unexercised paths |
| 01 constrained-screen layout | Same browser/OS; initial 800x600 virtual screen | Open the same tall action popup with enough rows to fill the list | **Failed compact/visible-warning check:** actual viewport is 375x510 while body remains 360x600; an outer scrollbar appears and clips the warning/footer until scrolled. Standard 1280x900 run passes; see R2 |
| 01 estimate calibration | No Chrome Task Manager samples collected | Representative states, memory column, independent sample counts/ranges, version/OS and shared-process limitations | Not run; model remains unset and numeric estimates remain unavailable. System RAM observations are not per-tab calibration |

### Review findings

- **R1 / P2 / VERIFIED — retain the original tooltip during pointer transfer.** `popup.js:63` positions it 4px away from the row, and `popup.js:133` hides it immediately on departure unless focus is inside the row or the pointer lands directly inside the tooltip. The gap is occupied by the next row, whose mouseenter replaces the details. Reproduced both before and after unloading. Existing `checks.cjs:320` coverage jumps directly from row to tooltip and misses this path. Preserve a hover bridge/grace period without switching the anchor while entering the existing tooltip, and check that the original title/URL persist across the gap.
- **R2 / P2 / VERIFIED — size the flex body to the available popup height.** `popup.html:7` caps the body at a fixed 600px rather than the smaller actual viewport. On an 800x600 virtual desktop, Chrome provides a 510px popup height; the 600px body adds outer scrolling, widens the popup to 375px, and puts part of the unsaved-changes warning below the visible actions. Keep the warning/actions visible and let the tab list shrink in short viewports; recheck both screen sizes.

**Review verdict: CHANGES REQUIRED.** No production fixes are applied during this review. No ADR references or game-engine configuration exist; game-engine/specialist validation is not applicable to this vanilla Chrome extension. Human screen-reader output, OS-delivered `Alt+U`, native context-menu interaction, real-world tab races, and other browser/OS versions are not assessed by this browser run; mocks cover the corresponding action branches, not those native UI surfaces. Feature 02's menu checks remain pending.

**Temporary local evidence (not store screenshots or committed assets):** `/tmp/tab-unloader-review-3UFSes/results.json` and `review.log` contain the final 12 browser scenario results; `node-checks.log` contains the 15 Node results. `review.mjs` plus `cdp.mjs` are the dependency-free browser harness; `tooltip-repro.mjs` and `tooltip-repro.json` record the separate pointer reproduction. Eleven PNG captures include `01-popup-loaded.png`, `01-popup-empty-search.png`, `01-popup-unloaded.png`, `01-popup-pending.png`, `01-popup-error.png`, `01-popup-reopened.png`, `01-tooltip-hover.png`, `01-tooltip-long-title.png`, `01-tooltip-before-gap.png`, `01-tooltip-after-gap.png`, and `01-popup-small-screen.png`. `chrome-channel.json` records the downloaded Stable-channel version. Store assets and README are not rewritten by this review; their earlier environment/validation wording is superseded by this dated log.

**Historical next checkpoint (2026-10-21):** stop for review of feature **01** without commit/push. The 2026-10-22 user request authorizes committing and pushing the changes; the retest below supersedes the open R1/R2 verdict, not the estimate gate.

### Feature 01 fixes and handoff — 2026-10-22

- Recovered the latest Codex review from `rollout-2026-10-21T23-35-36-01a160d1-f974-7252-aab6-53a99307d09f.jsonl`; continued this implementation rather than restarting it.
- **R1 resolved:** place the tooltip flush against the row above or below, removing the 4px region where the adjacent row intercepted the pointer. Added a Node regression for both placement directions; it failed with `79 !== 75` before the fix and now passes. The real pointer-transfer check also retains the original title/URL.
- **R2 resolved:** keep an explicitly sized, fixed root for Chrome's popup autosizing; cap the flex body to the available viewport, suppress outer scrolling/scrollbar width, and let only the list shrink. A body-only viewport cap collapsed the list during cold popup startup; it was rejected. The final checks use fresh isolated profiles, actual action popups, and wheel input outside the list to verify no outer scrolling.

| Retest | Outcome |
| --- | --- |
| `node checks.cjs` | **16 passed**, including both tooltip placement directions |
| `node --check background.js`, `node --check popup.js`, `node --check checks.cjs`; `git diff --check` | All passed |
| Chrome for Testing 156.0.8078.47 / Ubuntu 26.04.1 LTS x86_64; 800x600 virtual screen | **13/13 passed**; popup/body 360x510, list 176px, warning bottom 428.8px, footer bottom 502px; no outer wheel scrolling |
| Same browser/OS; 1280x900 virtual screen | **13/13 passed**; popup/body 360x600, list 266px, warning bottom 518.8px, footer bottom 592px |
| Both Chrome runs | Real RAM and exact permissions; safe titles/URLs; search-independent bulk scope; pointer/keyboard tooltip and focus restoration; active/pinned/closed/no-sibling cases; lifecycle refresh; genuine individual/bulk clicks; pending/error rendering; worker continuation after popup closes; fresh reopen; no observed uncaught exceptions or extension errors |
| Per-tab Task Manager calibration, human screen reader, OS-delivered `Alt+U`, native context menus, other platforms | Not run; estimates remain unavailable. Native tab-strip menu validation is the first task in **02** |

Temporary reproducible evidence (not store assets): `/home/xspynks/.hermes/cache/scratch/tab-unloader-finish-pr8wh32s/`; `run-browser.py`, `review.mjs`, and `cdp.mjs` run the dependency-free browser harness; `final-small/results.json`, `final-normal/results.json`, logs, and PNGs hold both passing runs. Chrome used `--no-sandbox` due to this host's restriction and loopback fixtures, not normal browsing. This automated check does not establish human accessibility or native-menu/OS-shortcut behavior.

**Next decision:** accept the measured-only checkpoint to proceed to **02**, or finish Task Manager calibration first. Do not silently mark full 01 complete or enable numeric estimates. The current task commits/pushes feature 01 only; no feature 02 implementation or merge into `main` is included.
