/* Installation and honest offline-readiness feedback; no personal information is read. */
(() => {
  "use strict";
  const VERSION = "2026-11-05.2";
  const scriptUrl = document.currentScript?.src || location.href;
  const appBase = new URL("./", scriptUrl);
  const words = {
    en: {
      preparing: "Preparing an offline copy. Keep this page open while it finishes.",
      ready: "Offline copy ready on this device. Web links and chats need internet; calls and texts need phone service.",
      offline: "You are offline. Saved resources and your tools are available. Web links and chats need internet; calls and texts need phone service.",
      unavailable: "An offline copy is not ready. Connect to the internet and reload to try again.",
      unsupported: "This browser cannot prepare an offline copy. Save or print information you may need.",
      waiting: "An offline update is waiting. Close all tabs for this site, then reopen it while online to finish.",
      install: "Install app",
      ios: "To install in Safari, tap Share, then Add to Home Screen. Installation does not back up your notes."
    },
    fr: {
      preparing: "Préparation d’une copie hors ligne. Gardez cette page ouverte jusqu’à la fin.",
      ready: "Copie hors ligne prête sur cet appareil. Les liens et le clavardage demandent Internet; les appels et textos demandent un service téléphonique.",
      offline: "Vous êtes hors ligne. Les ressources enregistrées et vos outils sont disponibles. Les liens et le clavardage demandent Internet; les appels et textos demandent un service téléphonique.",
      unavailable: "La copie hors ligne n’est pas prête. Connectez-vous à Internet et rechargez la page pour réessayer.",
      unsupported: "Ce navigateur ne peut pas préparer de copie hors ligne. Enregistrez ou imprimez les renseignements utiles.",
      waiting: "Une mise à jour hors ligne est en attente. Fermez tous les onglets de ce site, puis rouvrez-le avec Internet pour terminer.",
      install: "Installer l’application",
      ios: "Pour installer dans Safari, touchez Partager, puis Sur l’écran d’accueil. L’installation ne sauvegarde pas vos notes."
    }
  };
  let registration;
  let deferredInstall;
  let state = "preparing";
  let sequence = 0;

  const language = () => document.documentElement.lang.toLowerCase().startsWith("fr") ? "fr" : "en";
  const installed = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  function paint() {
    const text = words[language()];
    const status = document.getElementById("offlineStatus");
    if (status) {
      status.textContent = text[state === "ready" && navigator.onLine === false ? "offline" : state];
      status.dataset.offlineReady = state === "ready" ? "true" : "false";
    }
    const button = document.getElementById("installApp");
    if (button) {
      button.textContent = text.install;
      button.hidden = !deferredInstall || installed();
    }
    const help = document.getElementById("installHelp");
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (help) {
      help.textContent = text.ios;
      help.hidden = !ios || installed();
    }
  }

  function askStatus(worker) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        channel.port1.close();
        reject(new Error("Offline status timed out"));
      }, 3000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage({ type: "OFFLINE_STATUS" }, [channel.port2]);
    });
  }

  async function check() {
    const checkId = ++sequence;
    if (!registration?.active || registration.active.state !== "activated") {
      if (state !== "unsupported") state = registration?.installing ? "preparing" : "unavailable";
      paint();
      return;
    }
    try {
      const result = await askStatus(registration.active);
      if (checkId !== sequence) return;
      state = result?.type === "OFFLINE_STATUS" && result.ready === true &&
        result.scope === appBase.href && result.version === VERSION ? "ready" :
        registration.waiting ? "waiting" : "unavailable";
    } catch (_) {
      if (checkId !== sequence) return;
      state = "unavailable";
    }
    paint();
  }

  function watch(worker) {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "redundant" && !registration.active) {
        state = "unavailable";
        paint();
      } else {
        void check();
      }
    });
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstall = event;
    paint();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = undefined;
    paint();
  });
  window.addEventListener("online", () => { void check(); });
  window.addEventListener("offline", () => { void check(); });
  window.addEventListener("pageshow", () => { if (registration) void check(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && registration) void check();
  });

  async function start() {
    paint();
    const button = document.getElementById("installApp");
    button?.addEventListener("click", async () => {
      const prompt = deferredInstall;
      if (!prompt) return;
      deferredInstall = undefined;
      paint();
      try { await prompt.prompt(); } catch (_) { /* Browser menu installation remains available. */ }
    });
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      state = "unsupported";
      paint();
      return;
    }
    try {
      registration = await navigator.serviceWorker.register(new URL("sw.js", appBase), {
        scope: appBase.href, updateViaCache: "none"
      });
      registration.addEventListener("updatefound", () => {
        watch(registration.installing);
        void check();
      });
      watch(registration.installing);
      watch(registration.waiting);
      navigator.serviceWorker.addEventListener("controllerchange", () => { void check(); });
      await check();
    } catch (_) {
      state = "unavailable";
      paint();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else void start();
})();
