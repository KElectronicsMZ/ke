//=========This code for "Cache version bump and complete ERP asset list"=========
const CACHE_NAME = 'ke-tech-cache-v4.10'; // Bumped version up!

// The essential files the app needs to load visually
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/system.js',
    './js/warehouse.js',
    './js/monitor.js',
    './js/callcenter.js',
    './js/settings.js',
    './js/accounting.js',
    './js/tracking.js',
    './js/assignation.js',
    './js/myteam.js',
    './js/drivers_fleet.js',
    './js/bonuses.js',
    './js/telephony.js',
    './manifest.json' 
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
    if (event.request.url.includes('/api/v1/telephony/')) {
        return;
    }
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});
