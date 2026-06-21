// v3: novo nome de cache forca a limpeza de versoes antigas (dge-v1/v2) que
// podiam servir app.js/index.html desatualizados - isso fazia o site so
// funcionar direito em aba anonima (sem cache). Combinado com network-first
// abaixo, todo carregamento busca a versao nova do servidor primeiro.
const CACHE = "dge-v3";
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
