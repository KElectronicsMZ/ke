const CACHE_NAME = 'ke-tech-cache-v1.9'; // We bumped the version up!

// The essential files the app needs to load visually
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json' // Added this so the app installs correctly on phones
];

// 1. Install the Service Worker and save the files to the phone's cache
self.addEventListener('install', (event) => {
    // Skip the waiting lifecycle to force the new service worker to activate immediately
    self.skipWaiting();
    
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. Activate Event: Wipes out old, stale caches when you update the CACHE_NAME
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('Clearing old cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

// 3. Intercept network requests (Network-First Strategy)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});