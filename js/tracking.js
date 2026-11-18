// ==========================================
// --- TRACKING MANAGEMENT MODULE ---
// ==========================================

(function() {
    const btnTracking = document.getElementById('btnTracking');
    const trackingPage = document.getElementById('trackingPage');
    const trackingHubBtn = document.getElementById('trackingHubBtn');
    const localMenuPage = document.getElementById('menuPage');

    // 1. Listen for clicks on the HUB menu button
    if (btnTracking) {
        btnTracking.addEventListener('click', () => {
            // Turn off any page that is currently visible
            document.querySelectorAll('.page.active').forEach(page => {
                page.classList.remove('active');
            });
            
            // Turn on the Tracking page
            if (trackingPage) {
                trackingPage.classList.add('active');
            }
        });
    }

    // 2. Listen for clicks on the Back Button inside Tracking
    if (trackingHubBtn) {
        trackingHubBtn.addEventListener('click', () => {
            if (trackingPage) trackingPage.classList.remove('active');
            if (localMenuPage) localMenuPage.classList.add('active');
        });
    }

})();