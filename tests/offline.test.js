"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");

function cacheStorage() {
  const stores = new Map();
  return {
    stores,
    has: async name => stores.has(name),
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(requests) {
          if (this.failInstall) throw new Error("Cache unavailable");
          // Like a successful addAll, commit all shell responses as one batch.
          for (const request of requests) store.set(request.url, new Response(`saved:${request.url}`));
        },
        async match(key) { return store.get(typeof key === "string" ? key : key.url)?.clone(); },
        async put(key, value) { store.set(typeof key === "string" ? key : key.url, value.clone()); },
        failInstall: false
      };
    }
  };
}

function worker(scope = "https://example.test/", caches = cacheStorage(), options = {}) {
  const listeners = new Map();
  let fetchImpl = async () => new Response("online");
  let claims = 0;
  const cacheApi = options.failInstall ? {
    ...caches,
    open: async name => {
      const cache = await caches.open(name);
      cache.failInstall = true;
      return cache;
    }
  } : caches;
  vm.runInNewContext(source, {
    URL, Request, Response, AbortController, Set, Promise, Error, setTimeout, clearTimeout,
    caches: cacheApi,
    fetch: (...args) => fetchImpl(...args),
    self: {
      registration: { scope },
      clients: { claim: async () => { claims++; } },
      addEventListener(type, callback) { listeners.set(type, callback); }
    }
  }, { filename: "sw.js" });
  async function dispatch(type, extra = {}) {
    let pending = Promise.resolve();
    const event = { ...extra, waitUntil(promise) { pending = promise; } };
    listeners.get(type)(event);
    await pending;
  }
  return {
    caches,
    get claims() { return claims; },
    install: () => dispatch("install"),
    activate: () => dispatch("activate"),
    network(implementation) { fetchImpl = implementation; },
    async status() {
      let result;
      await dispatch("message", {
        data: { type: "OFFLINE_STATUS" },
        ports: [{ postMessage(value) { result = value; } }]
      });
      return result;
    },
    async request(url, { method = "GET", mode = "navigate" } = {}) {
      let response;
      listeners.get("fetch")({
        request: { url, method, mode },
        respondWith(promise) { response = promise; }
      });
      return response;
    }
  };
}

test("readiness requires the whole English/French shell, including install icons", async () => {
  const app = worker("https://example.test/imhomeless-test/");
  assert.equal((await app.status()).ready, false);
  await app.install();
  const status = await app.status();
  assert.equal(status.ready, true);
  assert.equal(status.scope, "https://example.test/imhomeless-test/");
  const saved = [...app.caches.stores.values()][0];
  for (const file of ["index.html", "fr.html", "personal.js", "resources.json", "manifest-fr.webmanifest", "icon-192.png", "icon-512.png"]) {
    assert.ok(saved.has(`https://example.test/imhomeless-test/${file}`), file);
  }
  saved.delete("https://example.test/imhomeless-test/fr.html");
  assert.equal((await app.status()).ready, false, "an evicted file invalidates the offline promise");
});

test("French installs keep the same app identity and reopen the French document", () => {
  const directory = path.join(__dirname, "..");
  const en = JSON.parse(fs.readFileSync(path.join(directory, "manifest.webmanifest"), "utf8"));
  const fr = JSON.parse(fs.readFileSync(path.join(directory, "manifest-fr.webmanifest"), "utf8"));
  assert.equal(fr.id, en.id);
  assert.equal(fr.scope, en.scope);
  assert.equal(fr.lang, "fr-CA");
  assert.equal(fr.start_url, "fr.html");
  assert.notEqual(fr.name, en.name);
});

test("a failed initial install removes its incomplete cache and preserves other apps", async () => {
  const caches = cacheStorage();
  await caches.open("another-app");
  const app = worker("https://example.test/imhomeless-test/", caches, { failInstall: true });
  await assert.rejects(app.install(), /Cache unavailable/);
  assert.deepEqual(await caches.keys(), ["another-app"]);
  assert.equal((await app.status()).ready, false);
});

test("activation deletes only older caches for the exact same app scope", async () => {
  const caches = cacheStorage();
  const main = worker("https://example.test/", caches);
  const testCopy = worker("https://example.test/imhomeless-test/", caches);
  await main.install();
  await testCopy.install();
  const oldMain = "my-support-plan:https://example.test/:shell:old";
  const oldTest = "my-support-plan:https://example.test/imhomeless-test/:shell:old";
  await caches.open(oldMain);
  await caches.open(oldTest);
  await caches.open("unrelated-cache");
  await testCopy.activate();
  const keys = await caches.keys();
  assert.ok(keys.includes(oldMain));
  assert.ok(!keys.includes(oldTest));
  assert.ok(keys.includes("unrelated-cache"));
  assert.equal((await main.status()).ready, true);
  assert.equal((await testCopy.status()).ready, true);
  assert.equal(testCopy.claims, 1);
});

test("known app documents reopen offline, including French and query-string navigation", async () => {
  const app = worker("https://example.test/imhomeless-test/");
  await app.install();
  app.network(async () => { throw new Error("offline"); });
  const response = await app.request("https://example.test/imhomeless-test/fr.html?source=share");
  assert.equal(await response.text(), "saved:https://example.test/imhomeless-test/fr.html");
  const css = await app.request("https://example.test/imhomeless-test/styles.css", { mode: "cors" });
  assert.equal(await css.text(), "saved:https://example.test/imhomeless-test/styles.css");
});

test("HTTP failures fall back to a good cached page", async () => {
  const app = worker();
  await app.install();
  app.network(async () => new Response("temporary failure", { status: 503 }));
  const response = await app.request("https://example.test/index.html");
  assert.equal(await response.text(), "saved:https://example.test/index.html");
});

test("external resources, arbitrary endpoints, POSTs and sibling routes are never intercepted", async () => {
  const app = worker("https://example.test/imhomeless-test/");
  await app.install();
  let requests = 0;
  app.network(async () => { requests++; return new Response("online"); });
  for (const [url, options] of [
    ["https://external.test/help", {}],
    ["https://example.test/imhomeless-test/private-notes.json", {}],
    ["https://example.test/imhomeless-test/index.html", { method: "POST" }],
    ["https://example.test/fr.html", {}]
  ]) assert.equal(await app.request(url, options), undefined);
  assert.equal(requests, 0);
});

test("query-string responses are displayed online but are not written into the shell cache", async () => {
  const app = worker();
  await app.install();
  app.network(async () => new Response("query response"));
  const response = await app.request("https://example.test/index.html?private=value");
  assert.equal(await response.text(), "query response");
  app.network(async () => { throw new Error("offline"); });
  const saved = await app.request("https://example.test/index.html");
  assert.equal(await saved.text(), "saved:https://example.test/index.html");
  assert.ok([...app.caches.stores.values()].every(store => [...store.keys()].every(key => !key.includes("private=value"))));
});
