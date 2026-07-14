const CACHE_NAME = 'ke-tech-cache-v1';

// The essential files the app needs to load visually
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js'
];

// 1. Install the Service Worker and save the files to the phone's cache
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. Intercept network requests
self.addEventListener('fetch', (event) => {
    event.respondWith(
        // Network-First Strategy: Always try to get the newest version from the internet.
        // If the internet is down (.catch), pull the saved version from the cache!
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});