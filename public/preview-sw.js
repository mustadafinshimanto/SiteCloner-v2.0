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
  const isNextPath = url.pathname.includes('/_next/') || url.pathname.includes('/static/') || url.pathname.includes('/assets/');
  
  // Handle requests to the same origin OR requests to known framework paths
  if (url.origin !== self.location.origin && !isNextPath) return;
  
  // If the request is not already within the preview path, we re-route it.
  if (!url.pathname.startsWith(PREVIEW_ROOT)) {
    // Try to map the request into the preview directory
    // We strip the leading slash from the pathname if it exists
    let cleanPath = url.pathname;
    if (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);
    
    const newPath = PREVIEW_ROOT + cleanPath;
    const newUrl = new URL(newPath, self.location.origin);
    
    event.respondWith(
      fetch(newUrl).then(response => {
        if (response.status === 404) {
          // If mapping failed, just let it go through as-is if it's cross-origin
          // but if it's same-origin we already tried the best we could.
          return fetch(event.request);
        }
        return response;
      }).catch(() => fetch(event.request))
    );
  }
});
