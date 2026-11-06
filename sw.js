/* Public app files only. Personal notes, goals and reminders never enter this cache. */
"use strict";

const OFFLINE_VERSION = "2026-11-05.3";
const APP_SCOPE = new URL(self.registration.scope);
// Include the complete scope so copies on one origin cannot delete each other's cache.
const CACHE_PREFIX = `my-support-plan:${APP_SCOPE.href}:shell:`;
const CACHE_NAME = `${CACHE_PREFIX}${OFFLINE_VERSION}`;
const SHELL_PATHS = [
  "./", "index.html", "fr.html", "styles.css", "app.js", "personal.js",
  "resources.json", "manifest.webmanifest", "manifest-fr.webmanifest", "offline.js", "icon.svg",
  "icon-192.png", "icon-512.png"
];
const SHELL_URLS = SHELL_PATHS.map(path => new URL(path, APP_SCOPE).href);
const SHELL_SET = new Set(SHELL_URLS);
const DOCUMENT_URLS = new Set(["./", "index.html", "fr.html"].map(path => new URL(path, APP_SCOPE).href));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const alreadyExisted = await caches.has(CACHE_NAME);
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(SHELL_URLS.map(url => new Request(url, {
        cache: "reload", credentials: "same-origin"
      })));
      // Do not skip waiting: replacing an active version must not interrupt an open form.
    } catch (error) {
      if (!alreadyExisted) await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function offlineStatus() {
  if (!(await caches.has(CACHE_NAME))) {
    return { type: "OFFLINE_STATUS", ready: false, version: OFFLINE_VERSION, scope: APP_SCOPE.href };
  }
  const cache = await caches.open(CACHE_NAME);
  const found = await Promise.all(SHELL_URLS.map(url => cache.match(url)));
  return {
    type: "OFFLINE_STATUS", ready: found.every(Boolean), version: OFFLINE_VERSION,
    scope: APP_SCOPE.href
  };
}

self.addEventListener("message", event => {
  if (event.data?.type !== "OFFLINE_STATUS" || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    try {
      event.ports[0].postMessage(await offlineStatus());
    } catch (_) {
      event.ports[0].postMessage({ type: "OFFLINE_STATUS", ready: false,
        version: OFFLINE_VERSION, scope: APP_SCOPE.href });
    }
  })());
});

async function networkFirst(request, canonicalUrl, mayRefreshCache) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(request, { signal: controller.signal });
    // A failed HTTP response must not replace a good offline copy.
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const responseUrl = response.url ? new URL(response.url) : new URL(canonicalUrl);
    if (mayRefreshCache && responseUrl.origin === APP_SCOPE.origin &&
        SHELL_SET.has(responseUrl.href) && response.type !== "opaque") {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(canonicalUrl, response.clone());
      } catch (_) {
        // A full/disabled cache must not prevent online access.
      }
    }
    return response;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(canonicalUrl);
    if (saved) return saved;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== APP_SCOPE.origin) return;
  url.hash = "";
  const canonical = new URL(url.href);
  canonical.search = "";
  const isAppDocument = request.mode === "navigate" && DOCUMENT_URLS.has(canonical.href);
  // No arbitrary same-origin endpoints, external resources or personal data are cached.
  if (!isAppDocument && !SHELL_SET.has(url.href)) return;
  event.respondWith(networkFirst(request, canonical.href, url.search === ""));
});
