// ==========================================
// --- ACCOUNTING MANAGEMENT MODULE ---
// ==========================================

(function() {
    const btnAccounting = document.getElementById('btnAccounting');
    const accountingPage = document.getElementById('accountingPage');
    const accountingHubBtn = document.getElementById('accountingHubBtn');
    const localMenuPage = document.getElementById('menuPage');

    // 1. Listen for clicks on the HUB menu button
    if (btnAccounting) {
        btnAccounting.addEventListener('click', () => {
            // Turn off any page that is currently visible
            document.querySelectorAll('.page.active').forEach(page => {
                page.classList.remove('active');
            });
            
            // Turn on the Accounting page
            if (accountingPage) {
                accountingPage.classList.add('active');
            }
        });
    }

    // 2. Listen for clicks on the Back Button inside Accounting
    if (accountingHubBtn) {
        accountingHubBtn.addEventListener('click', () => {
            if (accountingPage) accountingPage.classList.remove('active');
            if (localMenuPage) localMenuPage.classList.add('active');
        });
    }

})();