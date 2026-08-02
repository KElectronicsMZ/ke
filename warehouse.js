// ==========================================
// --- WAREHOUSE MANAGEMENT SYSTEM ---
// ==========================================
// This file is fully isolated from app.js using an anonymous function wrapper. 
// This prevents variable naming conflicts (like 'menuPage') with the main system.

(function() {
    const navWarehouseLink = document.getElementById('navWarehouseLink');
    const warehousePage = document.getElementById('warehousePage');
    const warehouseHubBtn = document.getElementById('warehouseHubBtn');
    const localMenuPage = document.getElementById('menuPage');

    // 1. Listen for clicks on the Top Left Link
    if (navWarehouseLink) {
        navWarehouseLink.addEventListener('click', (e) => {
            e.preventDefault(); // Stops the page from jumping to the top
            
            // Turn off any page that is currently visible
            document.querySelectorAll('.page.active').forEach(page => {
                page.classList.remove('active');
            });
            
            // Turn on the Warehouse page
            if (warehousePage) {
                warehousePage.classList.add('active');
            }
        });
    }

    // 2. Listen for clicks on the Back Button inside the Warehouse
    if (warehouseHubBtn) {
        warehouseHubBtn.addEventListener('click', () => {
            if (warehousePage) warehousePage.classList.remove('active');
            if (localMenuPage) localMenuPage.classList.add('active');
        });
    }






    //all codes and functions regarding the warehouse.js must be before the closing of the modular pattern )(); to prevent this file from making functions with the same name as the app.js which is the main .js 
})();