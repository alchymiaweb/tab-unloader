const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(setImmediate);
const backgroundSource = fs.readFileSync(`${__dirname}/background.js`, "utf8");
const popupSource = fs.readFileSync(`${__dirname}/popup.js`, "utf8");
const popupIds = new Set([...fs.readFileSync(`${__dirname}/popup.html`, "utf8").matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const event = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); } });
const tab = (id, properties = {}) => ({ id, windowId: 1, title: `Tab ${id}`, url: `https://example.com/${id}`, active: false, pinned: false, discarded: false, ...properties });

function workerFixture(initialTabs, hooks = {}) {
  const state = new Map(initialTabs.map((value) => [value.id, { ...value }]));
  const calls = { query: [], get: [], update: [], discard: [] };
  const diagnostics = [];
  const chrome = {
    tabs: {
      async query(query) {
        calls.query.push(query);
        if (hooks.query) return hooks.query(query, state);
        return plain([...state.values()].filter((value) => Object.entries(query).every(([key, expected]) =>
          key === "currentWindow" ? value.windowId === 1 : value[key] === expected)));
      },
      async get(tabId) {
        calls.get.push(tabId);
        await hooks.beforeGet?.(tabId, state);
        if (!state.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
        return { ...state.get(tabId) };
      },
      async update(tabId, properties) {
        calls.update.push(tabId);
        if (hooks.update) return hooks.update(tabId, state);
        const target = state.get(tabId);
        assert.ok(target && !target.discarded, "Never wake a discarded sibling");
        for (const value of state.values()) {
          if (value.windowId === target.windowId) value.active = value.id === tabId;
        }
        Object.assign(target, properties);
        return { ...target };
      },
      async discard(tabId) {
        calls.discard.push(tabId);
        if (hooks.discard) return hooks.discard(tabId, state);
        const target = state.get(tabId);
        assert.ok(target && !target.active);
        target.discarded = true;
        return { ...target };
      },
    },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
    contextMenus: { onClicked: event() },
    commands: { onCommand: event() },
  };
  for (const name of ["onCreated", "onUpdated", "onRemoved", "onActivated", "onAttached", "onDetached", "onReplaced", "onMoved"]) {
    chrome.tabs[name] = event();
  }
  const context = vm.createContext({ chrome, console: { warn: (...args) => diagnostics.push(plain(args)), info() {} } });
  vm.runInContext(backgroundSource, context, { filename: "background.js" });
  async function request(message) {
    let responses = 0;
    const response = await new Promise((resolve) => {
      const keepOpen = chrome.runtime.onMessage.listeners[0](message, {}, (result) => {
        responses += 1;
        resolve(plain(result));
      });
      assert.equal(keepOpen, true);
    });
    await settle();
    assert.equal(responses, 1, "Respond exactly once");
    return response;
  }
  return { chrome, state, hooks, calls, diagnostics, request };
}

class Element {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.document = document;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.value = "";
    this.text = "";
  }
  set innerHTML(_value) { throw new Error("Untrusted content must not use innerHTML"); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.text = ""; this.append(...children); }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  emit(name, details = {}) { return Promise.all((this.listeners[name] || []).map((listener) => listener(details))); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  matches(selector) { return this.className.split(" ").includes(selector.slice(1)); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  querySelectorAll(selector) {
    assert.equal(selector, "button");
    return this.children.flatMap((child) => [...(child.tagName === "BUTTON" ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  focus() { this.document.activeElement = this; }
}

function popupFixture(worker = workerFixture([tab(1, { active: true }), tab(2)]), options = {}) {
  const elements = {};
  const document = { activeElement: null };
  document.createElement = (tagName) => new Element(tagName, document);
  document.getElementById = (id) => {
    assert.ok(popupIds.has(id), `Missing popup element: ${id}`);
    return elements[id] ||= document.createElement(id === "others" ? "button" : "div");
  };
  document.activeElement = document.createElement("body");
  const calls = { memory: 0, messages: 0 };
  const intervals = new Map();
  const window = { innerHeight: 600, listeners: {}, addEventListener: Element.prototype.addEventListener };
  worker.chrome.windows = { async getCurrent() { return { id: 1 }; } };
  worker.chrome.system = { memory: { async getInfo() {
    calls.memory += 1;
    return options.getInfo ? options.getInfo() : { capacity: 16 * 1024 ** 3, availableCapacity: 6 * 1024 ** 3 };
  } } };
  worker.chrome.runtime.sendMessage = async (message) => {
    calls.messages += 1;
    return options.sendMessage ? options.sendMessage(message) : worker.request(message);
  };
  const context = vm.createContext({
    chrome: worker.chrome, document, navigator: { language: options.locale || "en-US" }, window,
    setInterval(callback, delay) {
      const timerId = intervals.size + 1;
      intervals.set(timerId, { callback, delay });
      return timerId;
    },
    clearInterval(timerId) { intervals.delete(timerId); },
  });
  vm.runInContext(popupSource, context, { filename: "popup.js" });
  return { context, elements, document, calls, worker, intervals, window };
}

let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

async function main() {
  await check("malformed messages have no API side effects", async () => {
    const worker = workerFixture([tab(0)]);
    for (const message of [null, undefined, [], "unload-tab", {}, { type: "unload-selected", tabIds: [0] },
      ...[undefined, null, -1, 1.5, "0", Infinity, NaN, Number.MAX_SAFE_INTEGER + 1].flatMap((tabId) =>
        ["unload-tab", "unload-others"].map((type) => ({ type, tabId })))]) {
      assert.equal((await worker.request(message)).ok, false);
    }
    assert.deepEqual(worker.calls, { query: [], get: [], update: [], discard: [] });
    assert.deepEqual(await worker.request({ type: "unload-tab", tabId: 0 }), { ok: true, results: [{ tabId: 0, status: "unloaded" }] });
  });

  await check("explicit single unloading permits pinned tabs but skips unloaded/closed tabs", async () => {
    const worker = workerFixture([tab(1, { pinned: true }), tab(2, { discarded: true })]);
    assert.equal((await worker.request({ type: "unload-tab", tabId: 1 })).results[0].status, "unloaded");
    assert.equal((await worker.request({ type: "unload-tab", tabId: 2 })).results[0].reason, "already-unloaded");
    assert.equal((await worker.request({ type: "unload-tab", tabId: 3 })).results[0].reason, "tab-closed");
    assert.deepEqual(worker.calls.discard, [1]);
  });

  await check("active targets switch only to an already-loaded sibling in their window", async () => {
    const worker = workerFixture([tab(1, { active: true, pinned: true }), tab(2, { discarded: true }), tab(3), tab(4, { windowId: 2 })]);
    assert.equal((await worker.request({ type: "unload-tab", tabId: 1 })).results[0].status, "unloaded");
    assert.deepEqual(worker.calls.update, [3]);
    assert.deepEqual(worker.calls.get, [1, 3, 1]);
    for (const siblings of [[], [tab(2, { discarded: true })], [tab(2, { windowId: 2 })]]) {
      const only = workerFixture([tab(1, { active: true }), ...siblings]);
      assert.equal((await only.request({ type: "unload-tab", tabId: 1 })).results[0].reason, "no-suitable-sibling");
      assert.deepEqual(only.calls.update, []);
      assert.deepEqual(only.calls.discard, []);
    }
  });

  await check("sibling races never wake discarded/moved/closed siblings", async () => {
    for (const change of [
      (state) => { state.get(2).discarded = true; },
      (state) => { state.get(2).windowId = 2; },
      (state) => { state.delete(2); },
    ]) {
      const worker = workerFixture([tab(1, { active: true }), tab(2)], { beforeGet(tabId, state) { if (tabId === 2) change(state); } });
      assert.equal((await worker.request({ type: "unload-tab", tabId: 1 })).results[0].reason, "no-suitable-sibling");
      assert.deepEqual(worker.calls.update, []);
      assert.deepEqual(worker.calls.discard, []);
    }
    const worker = workerFixture([tab(1, { active: true }), tab(2)], { update() {} });
    assert.equal((await worker.request({ type: "unload-tab", tabId: 1 })).results[0].reason, "active-tab");
    assert.deepEqual(worker.calls.discard, []);
  });

  await check("bulk freezes eligible IDs, rechecks protection, and collects mixed outcomes", async () => {
    const worker = workerFixture([
      tab(1, { active: true }), tab(2), tab(3), tab(4), tab(5), tab(6), tab(7),
      tab(8, { pinned: true }), tab(9, { discarded: true }), tab(10, { active: true, windowId: 2 }), tab(11), tab(12),
    ], {
      beforeGet(tabId, state) {
        if (tabId === 3) state.get(tabId).pinned = true;
        if (tabId === 4) state.get(tabId).active = true;
        if (tabId === 5) state.get(tabId).discarded = true;
        if (tabId === 6) state.delete(tabId);
      },
      discard(tabId, state) {
        if (tabId === 7) throw new Error("Cannot discard");
        state.set(13, tab(13));
        state.get(tabId).discarded = true;
        return { ...state.get(tabId) };
      },
    });
    const response = await worker.request({ type: "unload-others", tabId: 11 });
    assert.deepEqual(response, { ok: true, results: [
      { tabId: 2, status: "unloaded" },
      { tabId: 3, status: "skipped", reason: "pinned-tab" },
      { tabId: 4, status: "skipped", reason: "active-tab" },
      { tabId: 5, status: "skipped", reason: "already-unloaded" },
      { tabId: 6, status: "skipped", reason: "tab-closed" },
      { tabId: 7, status: "failed", reason: "discard-failed" },
      { tabId: 12, status: "unloaded" },
    ] });
    assert.deepEqual(worker.calls.discard, [2, 7, 12]);
    assert.equal(worker.calls.query.length, 1);
  });

  await check("bulk ignores invalid/duplicate snapshot IDs and reports query failures", async () => {
    const worker = workerFixture([tab(1), tab(2)], { query: async () => [tab(1), tab(2), tab(2), tab(-1), tab(undefined)] });
    assert.deepEqual((await worker.request({ type: "unload-others", tabId: 1 })).results, [{ tabId: 2, status: "unloaded" }]);
    worker.hooks.query = async () => { throw new Error("Query failed"); };
    assert.deepEqual(await worker.request({ type: "unload-others", tabId: 1 }), { ok: false, error: "request-failed" });
    assert.deepEqual(worker.calls.discard, [2]);
  });

  await check("undefined, mismatched, and non-discarded responses are not successes", async () => {
    for (const response of [undefined, { id: 1, discarded: false }, { id: 9, discarded: true }]) {
      const worker = workerFixture([tab(1)], { discard: async () => response });
      assert.deepEqual((await worker.request({ type: "unload-tab", tabId: 1 })).results[0], { tabId: 1, status: "failed", reason: "discard-unconfirmed" });
    }
    const worker = workerFixture([tab(1)], { beforeGet() { throw new Error("Read unavailable"); } });
    assert.equal((await worker.request({ type: "unload-tab", tabId: 1 })).results[0].reason, "tab-read-failed");
  });

  await check("menu/shortcut failures are caught and diagnostics are bounded and private", async () => {
    const worker = workerFixture([tab(1, { title: "PRIVATE TITLE", url: "https://private.invalid/" })], { query() { throw new Error("PRIVATE API ERROR"); } });
    worker.chrome.contextMenus.onClicked.listeners[0]({ menuItemId: "unload-others" }, tab(1));
    await settle();
    for (let index = 0; index < 15; index += 1) await worker.chrome.commands.onCommand.listeners[0]("unload-current-tab");
    assert.equal(worker.diagnostics.length, 10);
    assert.ok(!JSON.stringify(worker.diagnostics).includes("PRIVATE"));
    assert.equal(worker.chrome.runtime.onInstalled.listeners.length, 1);
    assert.equal(worker.chrome.runtime.onStartup.listeners.length, 1);
  });

  await check("closing the popup cannot cancel the frozen worker action", async () => {
    const worker = workerFixture([tab(1, { active: true }), tab(2), tab(3)]);
    assert.equal(worker.chrome.runtime.onMessage.listeners[0]({ type: "unload-others", tabId: 1 }, {}, () => { throw new Error("Popup closed"); }), true);
    await settle();
    assert.deepEqual(worker.calls.discard, [2, 3]);
    assert.equal(worker.diagnostics[0][1], "response-failed");
  });

  await check("system fixtures use binary GiB, validate strictly, and format by locale", async () => {
    const manifest = JSON.parse(fs.readFileSync(`${__dirname}/manifest.json`, "utf8"));
    assert.deepEqual(manifest.permissions, ["tabs", "contextMenus", "system.memory"]);
    for (const resource of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)]) {
      assert.ok(fs.existsSync(`${__dirname}/${resource}`), `Missing extension resource: ${resource}`);
    }
    const popup = popupFixture();
    await settle();
    assert.deepEqual(plain(popup.context.systemMemoryText({ capacity: 16 * 1024 ** 3, availableCapacity: 6 * 1024 ** 3 })), ["16 GiB", "6 GiB", "10 GiB"]);
    assert.deepEqual(plain(popup.context.systemMemoryText({ capacity: 1.25 * 1024 ** 3, availableCapacity: 0 })), ["1.3 GiB", "0 GiB", "1.3 GiB"]);
    for (const reading of [null, {}, { capacity: 0, availableCapacity: 0 }, { capacity: -1, availableCapacity: 0 },
      { capacity: Infinity, availableCapacity: 0 }, { capacity: NaN, availableCapacity: 0 }, { capacity: 1, availableCapacity: NaN },
      { capacity: 1, availableCapacity: Infinity }, { capacity: 1, availableCapacity: -1 }, { capacity: 1, availableCapacity: 2 }, { capacity: "16", availableCapacity: 0 }]) {
      assert.equal(popup.context.systemMemoryText(reading), null);
    }
    const localized = popupFixture(undefined, { locale: "pt-BR" });
    await settle();
    assert.equal(localized.context.systemMemoryText({ capacity: 1.5 * 1024 ** 3, availableCapacity: 0 })[0], "1,5 GiB");
  });

  await check("system RAM polls every second without tab events or list rerenders", async () => {
    let reading = { capacity: 16 * 1024 ** 3, availableCapacity: 6 * 1024 ** 3 };
    const popup = popupFixture(undefined, { getInfo: () => reading });
    await settle();
    assert.equal(popup.calls.memory, 1);
    assert.equal(popup.intervals.size, 1);
    const timer = [...popup.intervals.values()][0];
    assert.equal(timer.delay, 1000);
    const row = popup.elements.list.children[1];
    const button = row.querySelector("button");
    button.focus();
    const queries = popup.worker.calls.query.length;
    const bulkText = popup.elements["bulk-info"].textContent;
    reading = { capacity: 16 * 1024 ** 3, availableCapacity: 3 * 1024 ** 3 };
    await timer.callback();
    assert.equal(popup.calls.memory, 2);
    assert.equal(popup.elements["memory-total"].textContent, "16 GiB");
    assert.equal(popup.elements["memory-available"].textContent, "3 GiB");
    assert.equal(popup.elements["memory-used"].textContent, "13 GiB");
    assert.equal(popup.worker.calls.query.length, queries);
    assert.equal(popup.elements.list.children[1], row);
    assert.equal(popup.document.activeElement, button);
    assert.equal(popup.elements["bulk-info"].textContent, bulkText);
    popup.worker.state.set(3, tab(3));
    await popup.worker.chrome.tabs.onCreated.listeners[0]();
    assert.ok(popup.elements["bulk-info"].textContent.endsWith("Eligible tabs: 2."));
    assert.equal(popup.elements["memory-available"].textContent, "3 GiB");
    assert.equal(popup.elements["memory-used"].textContent, "13 GiB");
    popup.window.listeners.pagehide[0]();
    assert.equal(popup.intervals.size, 0);
  });

  await check("periodic RAM reads recover after API failures and invalid readings", async () => {
    let reading = { capacity: 8 * 1024 ** 3, availableCapacity: 2 * 1024 ** 3 };
    const popup = popupFixture(undefined, { getInfo() {
      if (reading instanceof Error) throw reading;
      return reading;
    } });
    await settle();
    const timer = [...popup.intervals.values()][0];
    for (const invalid of [new Error("Memory unavailable"), { capacity: 1, availableCapacity: 2 }]) {
      reading = invalid;
      await timer.callback();
      for (const id of ["memory-total", "memory-available", "memory-used"]) {
        assert.equal(popup.elements[id].textContent, "Unavailable");
      }
      assert.equal(popup.elements.others.disabled, false);
    }
    reading = { capacity: 8 * 1024 ** 3, availableCapacity: 5 * 1024 ** 3 };
    await timer.callback();
    assert.equal(popup.elements["memory-total"].textContent, "8 GiB");
    assert.equal(popup.elements["memory-available"].textContent, "5 GiB");
    assert.equal(popup.elements["memory-used"].textContent, "3 GiB");
  });

  await check("safe rows retain current-window priority and bulk scope ignores search", async () => {
    const title = '<img src=x onerror="alert(1)">';
    const worker = workerFixture([tab(6, { windowId: 2 }), tab(1, { active: true }), tab(2, { title }), tab(3, { pinned: true }), tab(4, { discarded: true }), tab(5, { active: true, windowId: 2 }), tab(7, { title: "", url: "", pinned: true })]);
    const popup = popupFixture(worker);
    await settle();
    assert.deepEqual(popup.elements.list.children.map((row) => row.dataset.tabId), ["1", "2", "3", "4", "7", "6", "5"]);
    assert.equal(popup.elements.list.children[1].children[1].textContent, title);
    assert.equal(popup.elements.list.children[4].children[1].textContent, "Untitled tab");
    assert.equal(popup.elements["bulk-info"].textContent, "All accessible windows, regardless of search. Eligible tabs: 2.");
    assert.equal(popup.elements.list.children[3].querySelector("button").textContent, "Unloaded");
    assert.equal(popup.elements.list.children[3].querySelector("button").disabled, true);
    popup.elements.filter.value = title;
    await popup.elements.filter.emit("input");
    assert.equal(popup.elements.list.children.length, 1);
    assert.ok(popup.elements["bulk-info"].textContent.includes("Eligible tabs: 2."));
    await popup.context.submitAction({ type: "unload-others", tabId: 1 });
    assert.deepEqual([...worker.calls.discard].sort((first, second) => first - second), [2, 6]);
    assert.equal(popup.elements.status.textContent, "Unloaded: 2; Skipped: 0; Failed: 0.");
  });

  await check("rows have no tooltips or extra tab stops and keep accessible unload controls", async () => {
    const popup = popupFixture();
    await settle();
    const row = popup.elements.list.children[1];
    const button = row.querySelector("button");
    assert.equal(popupIds.has("tab-tooltip"), false);
    assert.equal(row.tabIndex, undefined);
    assert.equal(row.attributes["aria-describedby"], undefined);
    assert.deepEqual(Object.keys(row.listeners), []);
    assert.equal(button.attributes["aria-label"], "Unload: Tab 2");
    assert.equal(button.attributes["aria-describedby"], "warning");
    button.focus();
    await row.emit("mouseenter");
    assert.equal(popup.document.activeElement, button);
  });

  await check("tab refresh restores button focus or returns it to search when unavailable", async () => {
    const popup = popupFixture();
    await settle();
    const button = popup.elements.list.children[1].querySelector("button");
    button.focus();
    popup.worker.state.get(2).title = "Updated tab";
    await popup.worker.chrome.tabs.onUpdated.listeners[0]();
    const replacement = popup.elements.list.children[1].querySelector("button");
    assert.notEqual(replacement, button);
    assert.equal(popup.document.activeElement, replacement);
    assert.equal(replacement.attributes["aria-label"], "Unload: Updated tab");
    popup.worker.state.get(2).discarded = true;
    await popup.worker.chrome.tabs.onUpdated.listeners[0]();
    assert.equal(popup.elements.list.children[1].querySelector("button").disabled, true);
    assert.equal(popup.document.activeElement, popup.elements.filter);
  });

  await check("pending requests disable controls, reject duplicates, and restore after failure", async () => {
    let rejectMessage;
    const popup = popupFixture(undefined, { sendMessage: () => new Promise((_resolve, reject) => { rejectMessage = reject; }) });
    await settle();
    const action = popup.context.submitAction({ type: "unload-others", tabId: 1 });
    assert.equal(popup.elements.others.disabled, true);
    assert.ok(popup.elements.list.querySelectorAll("button").every((button) => button.disabled));
    await popup.context.submitAction({ type: "unload-others", tabId: 1 });
    assert.equal(popup.calls.messages, 1);
    rejectMessage(new Error("Connection failed"));
    await action;
    assert.equal(popup.elements.others.disabled, false);
    assert.ok(popup.elements.status.textContent.startsWith("Unable to unload"));
    assert.equal(popup.calls.memory, 2);
    assert.equal(popup.context.actionResultText({ ok: true, results: [{ tabId: 2, status: "failed" }, { tabId: 3, status: "skipped" }] }), "Unloaded: 0; Skipped: 1; Failed: 1.");
    assert.ok(popup.context.actionResultText({ ok: true, results: [{ tabId: 2, status: "invalid" }] }).startsWith("Unable"));
  });

  await check("unavailable memory is independent from successful unloading and tab reads", async () => {
    const popup = popupFixture(undefined, { getInfo() { throw new Error("Memory unavailable"); } });
    await settle();
    assert.equal(popup.elements["memory-total"].textContent, "Unavailable");
    popup.worker.chrome.system = {};
    await popup.context.refreshMemory();
    assert.equal(popup.elements["memory-total"].textContent, "Unavailable");
    assert.equal(popup.elements.others.disabled, false);
    await popup.context.submitAction({ type: "unload-others", tabId: 1 });
    assert.equal(popup.elements.status.textContent, "Unloaded: 1; Skipped: 0; Failed: 0.");
    assert.ok(popup.elements["bulk-info"].textContent.includes("No eligible tabs."));
    assert.equal(popup.elements["bulk-info"].textContent, "All accessible windows, regardless of search. No eligible tabs.");
    const unavailable = popupFixture(workerFixture([], { query() { throw new Error("Tabs unavailable"); } }));
    await settle();
    assert.equal(unavailable.elements["memory-total"].textContent, "16 GiB");
    assert.equal(unavailable.elements.others.disabled, true);
    assert.ok(unavailable.elements.list.textContent.startsWith("Tabs unavailable"));
    await unavailable.elements.filter.emit("input");
    assert.ok(unavailable.elements.list.textContent.startsWith("Tabs unavailable"));
    unavailable.worker.hooks.query = undefined;
    unavailable.worker.state.set(1, tab(1, { active: true }));
    unavailable.worker.state.set(2, tab(2));
    await unavailable.worker.chrome.tabs.onCreated.listeners[0]();
    assert.equal(unavailable.elements.others.disabled, false);
  });

  await check("stale tab/memory responses cannot overwrite newer lifecycle refreshes", async () => {
    let resolveTabs;
    let resolveMemory;
    let queries = 0;
    let readings = 0;
    const worker = workerFixture([], { query: () => ++queries === 1
      ? new Promise((resolve) => { resolveTabs = resolve; }) : [tab(1, { active: true }), tab(2, { title: "Fresh title" })] });
    const popup = popupFixture(worker, { getInfo: () => ++readings === 1
      ? new Promise((resolve) => { resolveMemory = resolve; }) : { capacity: 8 * 1024 ** 3, availableCapacity: 2 * 1024 ** 3 } });
    await worker.chrome.tabs.onUpdated.listeners[0]();
    assert.ok(popup.elements.list.textContent.includes("Fresh title"));
    assert.equal(popup.elements["memory-total"].textContent, "8 GiB");
    resolveTabs([tab(1, { active: true, title: "Stale title" })]);
    await [...popup.intervals.values()][0].callback();
    resolveMemory({ capacity: 32 * 1024 ** 3, availableCapacity: 8 * 1024 ** 3 });
    await settle();
    assert.ok(!popup.elements.list.textContent.includes("Stale title"));
    assert.equal(popup.elements["memory-total"].textContent, "8 GiB");
  });

  console.log(`\n${passed} checks passed. Browser verification is tracked separately in PLAN.md.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
