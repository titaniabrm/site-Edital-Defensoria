// v2: muda o nome do cache para forcar a limpeza do cache antigo (dge-v1)
// que ficava servindo app.js/index.html desatualizados para sempre.
const CACHE = "dge-v2";
const STATIC = ["/", "/index.html", "/styles.css", "/app.js", "/manifest.json", "/assets/defensoria-logo.webp"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Network-first para HTML/JS/CSS: sempre tenta buscar a versao nova do
// servidor primeiro. So usa o cache se a rede falhar (modo offline).
// Isso evita ficar travado numa versao antiga apos um deploy.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match(event.request))
  );
});
