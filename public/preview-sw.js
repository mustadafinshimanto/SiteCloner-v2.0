/**
 * SiteCloner V9: Infinite Fidelity Preview Shield
 * Service Worker to intercept and resolve all requests within the preview.
 */

const PREVIEW_ROOT = self.location.pathname.substring(0, self.location.pathname.lastIndexOf('/') + 1);

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only handle requests to the same origin
  if (url.origin !== self.location.origin) return;

  // We only want to handle requests that might be relative to the previewJobID/
  // But browsers often make requests relative to origin (e.g. /_next/static/...)
  // If the request is not already within the preview path, we re-route it.
  
  if (!url.pathname.startsWith(PREVIEW_ROOT)) {
    // Try to map the request into the preview directory
    const newPath = PREVIEW_ROOT + (url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname);
    const newUrl = new URL(newPath, self.location.origin);
    
    event.respondWith(
      fetch(newUrl).then(response => {
        if (response.status === 404) {
          // If mapping failed, just let it go through as-is
          return fetch(event.request);
        }
        return response;
      }).catch(() => fetch(event.request))
    );
  }
});
