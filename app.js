// --- 1. SUPABASE CONNECTION CONFIGURATION ---
const SUPABASE_URL = "https://nltzapfwhuidmjlnjwgy.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_9uEZtAWURjryzdCaVwH2Eg_OaW1MmpC"; 

// --- DYNAMIC UPLOAD SESSION TRACKERS ---
let currentSessionUploads = []; // Tracks { url, type, rowId } for the currently open ticket
let activeUploadsCount = 0;     // Locks the Confirm button while > 0

window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- OFFLINE DATABASE (INDEXEDDB) SETUP ---
let localDB;
// We request the browser to open a local database named "KETechDB" (Version 1)
const dbRequest = indexedDB.open("KETechDB", 1);

// This only runs the very first time the app loads, or if we change the version number
dbRequest.onupgradeneeded = function(event) {
    localDB = event.target.result;
    
    // Create an 'inbox' table to hold the tickets we download while online
    if (!localDB.objectStoreNames.contains('inbox')) {
        localDB.createObjectStore('inbox', { keyPath: 'id' }); // 'id' will just be a generic tag like "activeTickets"
    }
    
    // Create an 'outbox' table to hold the files and data we want to upload later
    if (!localDB.objectStoreNames.contains('outbox')) {
        localDB.createObjectStore('outbox', { keyPath: 'so' }); // We use the Service Order (SO) as the unique ID
    }
};

// --- LOADER CONTROLS ---
function showGlobalLoader(text = "Loading Data...") {
    const loader = document.getElementById('globalLoader');
    const loaderText = document.getElementById('loaderText');
    if (loaderText) loaderText.textContent = text;
    if (loader) loader.style.display = 'flex';
}

function hideGlobalLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) loader.style.display = 'none';
}

// This runs every time the app opens successfully
dbRequest.onsuccess = function(event) {
    localDB = event.target.result;
    console.log("IndexedDB Local Vault initialized perfectly!");

    // Check the vault the second the database wakes up
    if (typeof checkOfflineVault === 'function') checkOfflineVault();
};

// If the browser blocks it (like in some strict incognito modes)
dbRequest.onerror = function(event) {
    console.error("IndexedDB Error:", event.target.error);
};

// --- UNIVERSAL PAGINATION ENGINE (UPGRADED) ---
// Safely downloads tables in chunks and protects against URL-length crashes for large filters
async function fetchAllRecords(tableName, filterColumn = null, filterValues = null) {
    let allData = [];
    
    // SCENARIO 1: We are looking for a specific, massive list of items (e.g., 500+ SOs)
    if (filterColumn && filterValues && filterValues.length > 0) {
        const URL_SAFE_CHUNK_SIZE = 150; // Max items Supabase can comfortably handle in one URL string
        
        for (let i = 0; i < filterValues.length; i += URL_SAFE_CHUNK_SIZE) {
            const chunk = filterValues.slice(i, i + URL_SAFE_CHUNK_SIZE);
            let from = 0;
            const step = 999;
            let keepFetching = true;
            
            while (keepFetching) {
                const { data, error } = await supabaseClient
                    .from(tableName)
                    .select('*')
                    .in(filterColumn, chunk)
                    .range(from, from + step);
                    
                if (error) { 
                    console.error(`Error fetching ${tableName}: ${error.message}`); 
                    break; 
                }
                
                allData = allData.concat(data);
                if (data.length <= step) keepFetching = false;
                else from += step + 1;
            }
        }
    } 
    // SCENARIO 2: We are just downloading a whole table normally
    else {
        let from = 0;
        const step = 999; 
        let keepFetching = true;

        while (keepFetching) {
            const { data, error } = await supabaseClient
                .from(tableName)
                .select('*')
                .range(from, from + step);
                
            if (error) { 
                console.error(`Error fetching ${tableName}: ${error.message}`); 
                break; 
            }
            
            allData = allData.concat(data);
            if (data.length <= step) keepFetching = false;
            else from += step + 1; 
        }
    }
    
    return allData;
}

// --- LOAD TICKETS FROM LOCAL VAULT (OFFLINE) ---
function loadTicketsFromVault() {
    console.log("Loading tickets from IndexedDB Vault...");
    
    // SAFETY CHECK: Is the database actually open?
    if (!localDB) {
        alert("The offline database is still waking up. Please wait one second and click 'My Orders' again!");
        return;
    }

    try {
        const transaction = localDB.transaction('inbox', 'readonly');
        const store = transaction.objectStore('inbox');
        const request = store.get('latest_tickets');

        request.onsuccess = function() {
            if (request.result && request.result.tickets && request.result.tickets.length > 0) {
                console.log("Successfully retrieved " + request.result.tickets.length + " tickets. Rendering now...");
                renderTickets(request.result.tickets);
            } else {
                document.getElementById('ticketContainer').innerHTML = 
                    "<h3 style='text-align:center;'>No offline data saved. Please connect to internet to sync.</h3>";
            }
        };
        
        request.onerror = function() {
            console.error("Failed to read from local vault.");
            alert("Database Error: Could not read from the offline vault.");
        };
    } catch (err) {
        console.error("Critical Vault Error:", err);
        alert("CRASH PREVENTED: Could not access the local database: " + err.message);
    }
}

// --- 2. APPLICATION STATE CONFIGURATION ---

// --- PHASE 5: AUTO-VERSION ENGINE (UPGRADED) ---
// Directly queries the browser's Cache Storage to prove exactly which version is running
async function displaySystemVersion() {
    const versionDisplay = document.getElementById('appVersionDisplay');
    if (!versionDisplay) return;
    
    try {
        // --- NEW: Wait for Service Worker to complete installation ---
        if ('serviceWorker' in navigator) {
            await navigator.serviceWorker.ready;
            // 500ms stabilization buffer for disk I/O on Cache Storage API
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Ask the browser directly what caches are actively installed
        const cacheNames = await caches.keys();
        // Find the one that belongs to our system
        const systemCache = cacheNames.find(name => name.startsWith('ke-tech-cache-'));
        
        if (systemCache) {
            // Extract just the "vX.X" part (e.g., "ke-tech-cache-v4.5" becomes "v4.5")
            const version = systemCache.replace('ke-tech-cache-', '');
            versionDisplay.textContent = version;
        } else {
            versionDisplay.textContent = 'vUnknown';
        }
    } catch (e) {
        versionDisplay.textContent = 'vOffline';
    }

    // --- CACHE PURGE OVERRIDE ENGINE ---
    versionDisplay.style.cursor = 'pointer';
    versionDisplay.title = "Click to force system update (Clear Cache)";
    
    // We use .onclick instead of addEventListener to prevent duplicate bindings upon auto-login loops
    versionDisplay.onclick = async () => {
        if (!confirm("Force system update? This will clear cached files and reload the application from the server.")) return;
        
        try {
            versionDisplay.textContent = 'Updating...'; // Visual feedback during purge
            
            // 1. Wipe all Cache Storage allocations
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map(key => caches.delete(key)));
            
            // 2. Unregister Active Service Workers
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (let reg of regs) {
                    await reg.unregister();
                }
            }
            
            // 3. Force Hard Reload (Bypassing browser memory)
            window.location.reload(true);
        } catch (err) {
            alert("Cache purge failed. Please refresh manually. Error: " + err.message);
        }
    };
    // ----------------------------------------
}





window.currentUser = null;
window.databaseOrders = []; 
window.editedOrders = {};    
window.hiddenColumns = [];
window.selectedSystemOrders = new Set();

 


// 1. MASTER DATABASE SCHEMA (Matches your exact Supabase SQL list)
window.ALL_COLUMNS = [
    "so", "created_by", "branch", "date", "days", "status", "reason", "name", 
    "phone", "phone_2", "phone_3", "address", "rout", "model", "serial", "io", 
    "remark", "status_comment", "change_log", "return", 
    "part_1", "qty_1", "part_2", "qty_2", "part_3", "qty_3", "part_4", "qty_4", "part_5", "qty_5",
    "call_details", "img1", "calls", "location_link", "vid1", "arrived_at", "left_at", "history", 
    "assigned_tech", "service_type", "agree_coord", "complete_coord", "complete_tech", "visit_sequence"
];

// 2. THE TRANSLATOR (Strictly for External Samsung/IPAAS Export Files)
window.IMPORT_COLUMNS = [
    "so", "created_by", "branch", "date", "days", "status", "reason", "service_type", "name", 
    "phone", "phone_2", "phone_3", "address", "rout", "model", "serial", "io", 
    "remark", "status_comment", "change_log", "return", 
    "part_1", "qty_1", "part_2", "qty_2", "part_3", "qty_3", "part_4", "qty_4", "part_5", "qty_5",
    "call_details", "img1", "calls", "location_link", "vid1", "arrived_at", "left_at", "history", 
    "assigned_tech", "agree_coord", "complete_coord", "complete_tech"
];

window.activeColumns = [...ALL_COLUMNS];



// --- 3. DOM ELEMENTS ELEMENT SELECTORS ---
window.loginPage = document.getElementById('loginPage');
window.menuPage = document.getElementById('menuPage');
window.systemPage = document.getElementById('systemPage');

// --- 4. THEME SELECTION ENGINE ---
const themeSelect = document.getElementById('themeSelect');

// 1. Listen for changes and save to memory
themeSelect.addEventListener('change', (e) => {
    const selectedTheme = e.target.value;
    document.body.setAttribute('data-theme', selectedTheme);
    localStorage.setItem('ke_saved_theme', selectedTheme); // <-- Saves the theme
});

// 2. Read from memory when the app loads
const savedTheme = localStorage.getItem('ke_saved_theme');
if (savedTheme) {
    document.body.setAttribute('data-theme', savedTheme); // Apply the theme visually
    themeSelect.value = savedTheme; // Update the dropdown box to match
}


// --- 4.4 REALTIME BACK OFFICE ALARM ENGINE ---
let backOfficeChannel = null;
let unreadAlarmCount = 0; // Tracks new tickets during this session

function showAlarmToast(soNumber, techName = 'Unknown') {
    let container = document.getElementById('alarmToastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'alarmToastContainer';
        container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = 'background: #d32f2f; color: white; padding: 15px 20px; border-radius: 5px; box-shadow: 0 4px 8px rgba(0,0,0,0.4); font-weight: bold; cursor: pointer; display: flex; justify-content: space-between; align-items: center; min-width: 260px; border-left: 5px solid #ffeb3b;';
    toast.innerHTML = `<span>🚨 New Back Office Ticket: <br>SO <strong>${soNumber}</strong> <span style="font-size: 13px; font-weight: normal; opacity: 0.9;">(By: ${techName})</span></span><span style="font-size: 20px; margin-left: 15px;">&times;</span>`;

    // --- PHASE 3.5: CLICK TO OPEN TICKET ---
    toast.addEventListener('click', async () => {
        toast.remove();
        
        // 1. Navigate to My Orders page visually
        document.querySelectorAll('.page.active').forEach(p => p.classList.remove('active'));
        const techPage = document.getElementById('techPage');
        if (techPage) techPage.classList.add('active');
        
        // 2. Fetch the specific ticket from the database
        if (typeof showGlobalLoader === 'function') showGlobalLoader("Opening Ticket...");
        const { data, error } = await supabaseClient.from('orders').select('*').eq('so', soNumber).single();
        if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
        
        // 3. Open the Coordinator Modal
        if (data && !error) {
            if (typeof openDetailsModal === 'function') openDetailsModal(data, 'coordinator');
        } else {
            alert("Could not load ticket details. It may have been reassigned.");
        }
    });

    // Auto-remove after 15 seconds to prevent screen clutter
    setTimeout(() => { if(toast.parentElement) toast.remove(); }, 15000);

    container.appendChild(toast);
}

function initializeBackOfficeAlarm(userRole) {
    if (!userRole) return;
    const roleStr = userRole.toLowerCase();
    
    // Strict Gate: Only initialize WebSockets for authorized roles
    if (!roleStr.includes('coordinator') && !roleStr.includes('manager') && !roleStr.includes('admin')) {
        return;
    }

    // --- PHASE 3.5: INJECT NOTIFICATION BELL ---
    let bellContainer = document.getElementById('alarmBellContainer');
    if (!bellContainer) {
        const leftSideBar = document.getElementById('bannerLeftSide');
        if (leftSideBar) {
            bellContainer = document.createElement('div');
            bellContainer.id = 'alarmBellContainer';
            bellContainer.style.cssText = 'position: relative; cursor: pointer; display: flex; align-items: center;';
            bellContainer.innerHTML = `
                <span style="font-size: 18px;" title="New Back Office Tickets">🔔</span>
                <span id="alarmBellBadge" style="display: none; position: absolute; top: -5px; right: -8px; background: #d32f2f; color: white; border-radius: 50%; padding: 2px 6px; font-size: 10px; font-weight: bold;">0</span>
            `;
            
            // Click Bell to clear count and view queue
            bellContainer.addEventListener('click', () => {
                unreadAlarmCount = 0;
                document.getElementById('alarmBellBadge').style.display = 'none';
                
                document.querySelectorAll('.page.active').forEach(p => p.classList.remove('active'));
                const techPage = document.getElementById('techPage');
                if (techPage) techPage.classList.add('active');
                
                if (typeof loadActiveTickets === 'function') loadActiveTickets();
            });
            
            // Insert it directly into the left sidebar next to the version
            leftSideBar.appendChild(bellContainer);
        }
    }

    // Prevent duplicate zombie subscriptions
    if (backOfficeChannel) {
        supabaseClient.removeChannel(backOfficeChannel);
    }

    backOfficeChannel = supabaseClient
        .channel('back-office-alerts')
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'orders',
                filter: 'status=eq.back_office' // Cost-Optimization restored since RLS was the blocker
            },
            (payload) => {
                // Defensive Check: Ensure it wasn't ALREADY in the back office pool
                if (payload.old && payload.old.status === 'back_office') return;
                
                // --- PHASE 3.5: INCREMENT BELL BADGE ---
                unreadAlarmCount++;
                const badge = document.getElementById('alarmBellBadge');
                if (badge) {
                    badge.textContent = unreadAlarmCount;
                    badge.style.display = 'block';
                }
                
                // --- PHASE 6: PASS TECHNICIAN NAME TO TOAST ---
                showAlarmToast(payload.new.so, payload.new.assigned_tech);
            }
        )
        .subscribe();
}

// --- 4.5 SESSION MANAGEMENT (AUTO-LOGIN) ---
const SESSION_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

function checkExistingSession() {
    const savedSession = localStorage.getItem('ke_user_session');
    
    if (savedSession) {
        const sessionData = JSON.parse(savedSession);
        const now = Date.now();

        // Check if the session is younger than 6 hours
        if (now - sessionData.timestamp < SESSION_DURATION_MS) {
            currentUser = sessionData.user; // Restore the user instantly
            // Show top banner
            document.getElementById('bannerUsername').textContent = currentUser.username;
            document.getElementById('bannerRole').textContent = currentUser.role;
            displaySystemVersion(); // Auto-fetches from sw.js
            document.getElementById('globalUserBanner').style.display = 'block';
            
            // --- RESTORE COLUMN PREFERENCES ON AUTO-LOGIN ---
            const savedOrder = localStorage.getItem('sys_order_' + currentUser.username);
            if (savedOrder) {
                activeColumns = JSON.parse(savedOrder);
            } else {
                activeColumns = [...ALL_COLUMNS]; 
            }

            const savedHidden = localStorage.getItem('hiddenColumns_' + currentUser.username);
            if (savedHidden) {
                hiddenColumns = JSON.parse(savedHidden);
                activeColumns = activeColumns.filter(col => !hiddenColumns.includes(col));
            } else {
                hiddenColumns = [];
            }
            // ------------------------------------------------
            applyRoleBasedMenuVisibility(); //This lines make the buttons invisible for the user if they aren't allowed to see them when they refresh the page
            
            // --- PHASE 3: START ALARM ON AUTO-LOGIN ---
            initializeBackOfficeAlarm(currentUser.role);
            if (typeof window.initTelephonyRealtime === 'function') {
                window.initTelephonyRealtime(currentUser.username, currentUser.role);
            }
            
            // Hide the login screen and show the HUB menu
            loginPage.classList.remove('active');
            menuPage.classList.add('active');
            console.log("Session restored automatically.");
        } else {
            // The 6 hours are up! Wipe the old session.
            localStorage.removeItem('ke_user_session');
            console.log("Session expired. Login required.");
        }
    }
}

// Run this check the exact second the app finishes loading
window.addEventListener('DOMContentLoaded', checkExistingSession);

// --- 5. AUTHENTICATION & NAVIGATION FLOW ---
let tempUserSetup = null; // Remembers who is setting their password

document.getElementById('loginOkBtn').addEventListener('click', async () => {
    const rawUserIn = document.getElementById('usernameInput').value.trim();
    const passIn = document.getElementById('passwordInput').value.trim();

    if (!rawUserIn) {
        alert("Please enter a username.");
        return;
    }
    if (!passIn) {
        alert("Please enter your password.");
        return;
    }

    // 1. SECURE VAULT FORMATTING (Solves the Case-Insensitive requirement)
    // Turns "Shady" or "shady" into "shady@kesystem.com"
    const dummyEmail = `${rawUserIn.toLowerCase()}@kesystem.com`;

    // 2. SECURE AUTHENTICATION: Check the Supabase Vault directly
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
        email: dummyEmail,
        password: passIn
    });

    if (authError || !authData.user) {
        alert("Incorrect username or password.");
        return;
    }

    // 3. FETCH PROFILE: Grab their role from the table using case-insensitive search (.ilike)
    const { data: profileData, error: profileError } = await supabaseClient
        .from('profiles')
        .select('*')
        .ilike('username', rawUserIn)
        .single();

    if (profileError || !profileData) {
        alert("Authentication successful, but profile data is missing from the database.");
        return;
    }

    // 4. NEW PASSWORD ROUTING (Checks if the user needs to set a permanent password)
    if (!profileData.password || profileData.password.trim() === '') {
        tempUserSetup = profileData;
        document.getElementById('loginPage').classList.remove('active');
        document.getElementById('newPasswordPage').classList.add('active');
        return;
    }

    // 5. SUCCESS: Run the normal login sequence
    executeLoginSequence(profileData);
});

// We bundle the login success actions into a reusable function
function executeLoginSequence(userData) {
    currentUser = userData;

    document.getElementById('bannerUsername').textContent = currentUser.username;
    document.getElementById('bannerRole').textContent = currentUser.role;
    displaySystemVersion(); // Auto-fetches from sw.js
    document.getElementById('globalUserBanner').style.display = 'block';
    
    const sessionPayload = { user: currentUser, timestamp: Date.now() };
    localStorage.setItem('ke_user_session', JSON.stringify(sessionPayload));

    const savedOrder = localStorage.getItem('sys_order_' + currentUser.username);
    if (savedOrder) activeColumns = JSON.parse(savedOrder);
    else activeColumns = [...ALL_COLUMNS];

    const savedHidden = localStorage.getItem('hiddenColumns_' + currentUser.username);
    if (savedHidden) {
        hiddenColumns = JSON.parse(savedHidden);
        activeColumns = activeColumns.filter(col => !hiddenColumns.includes(col));
    } else hiddenColumns = [];

    applyRoleBasedMenuVisibility();
    
    // --- PHASE 3: START ALARM ON STANDARD LOGIN ---
    initializeBackOfficeAlarm(currentUser.role);
    if (typeof window.initTelephonyRealtime === 'function') {
        window.initTelephonyRealtime(currentUser.username, currentUser.role);
    }
    
    document.getElementById('loginPage').classList.remove('active');
    document.getElementById('newPasswordPage').classList.remove('active');
    document.getElementById('menuPage').classList.add('active');
}

// --- NEW PASSWORD SUBMISSION LOGIC ---
document.getElementById('saveNewPassBtn').addEventListener('click', async () => {
    const pass1 = document.getElementById('newPassInput').value.trim();
    const pass2 = document.getElementById('confirmPassInput').value.trim();

    if (!pass1 || !pass2) {
        alert("Please fill out both fields.");
        return;
    }
    if (pass1 !== pass2) {
        alert("Passwords do not match!");
        return;
    }

    // 1. Push the new password to the Secure Auth Vault
    const { error: vaultError } = await supabaseClient.auth.updateUser({
        password: pass1
    });

    if (vaultError) {
        alert("Failed to secure password in Vault: " + vaultError.message);
        return;
    }

    // 2. Keep the profiles table in sync
    const { error } = await supabaseClient
        .from('profiles')
        .update({ password: pass1 })
        .eq('username', tempUserSetup.username);

    if (error) {
        alert("Failed to save password to profile: " + error.message);
        return;
    }

    alert("Password set successfully! Logging you in...");
    
    // Update the temporary memory and push them to the HUB
    tempUserSetup.password = pass1;
    document.getElementById('newPassInput').value = '';
    document.getElementById('confirmPassInput').value = '';
    
    executeLoginSequence(tempUserSetup);
});

document.getElementById('cancelNewPassBtn').addEventListener('click', () => {
    document.getElementById('newPassInput').value = '';
    document.getElementById('confirmPassInput').value = '';
    document.getElementById('newPasswordPage').classList.remove('active');
    document.getElementById('loginPage').classList.add('active');
});

document.getElementById('loginCancelBtn').addEventListener('click', () => {
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
});

// ---ALLOW 'ENTER' KEY TO LOGIN ---

// Listen to the username input box for any key presses
document.getElementById('usernameInput').addEventListener('keydown', (e) => {
    // If the key pressed was exactly 'Enter'
    if (e.key === 'Enter') {
        // Prevent default browser behaviors just to be safe
        e.preventDefault();
        // Force the code to "click" the Login OK button automatically
        document.getElementById('loginOkBtn').click();
    }
});

// Do the exact same thing for the password input box
document.getElementById('passwordInput').addEventListener('keydown', (e) => {
    // If the key pressed was exactly 'Enter'
    if (e.key === 'Enter') {
        e.preventDefault();
        // Force the code to "click" the Login OK button automatically
        document.getElementById('loginOkBtn').click();
    }
});
// -------------------------------------- ---


document.getElementById('menuCancelBtn').addEventListener('click', () => {
    document.getElementById('globalUserBanner').style.display = 'none'; //hide the banner on logout
    // --- DESTROY SESSION TICKET ---
    localStorage.removeItem('ke_user_session');

    // --- PHASE 3: DESTROY WEBSOCKET CONNECTION ---
    if (backOfficeChannel) {
        supabaseClient.removeChannel(backOfficeChannel);
        backOfficeChannel = null;
    }

    hiddenColumns = [];
    activeColumns = [...ALL_COLUMNS];
    currentUser = null;
    menuPage.classList.remove('active');
    loginPage.classList.add('active');
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
});


// --- ROLE-BASED MENU VISIBILITY ENGINE ---
async function applyRoleBasedMenuVisibility() {
    if (!currentUser) return;

    const userRole = currentUser.role ? currentUser.role.toLowerCase().trim() : '';

    // 1. Grab all menu buttons by their IDs
    const btnMyOrders = document.getElementById('btnMyOrders');
    const btnMonitor = document.getElementById('btnMonitor');
    const btnBonuses = document.getElementById('btnBonuses');
    const btnAssignation = document.getElementById('btnAssignation');
    const btnSystem = document.getElementById('btnSystem');
    const btnCallCenter = document.getElementById('btnCallCenter');
    const btnSettings = document.getElementById('btnSettings');
    const btnWarehouse = document.getElementById('btnWarehouse');
    const btnAccounting = document.getElementById('btnAccounting');
    const btnTracking = document.getElementById('btnTracking');
    const btnMyTeam = document.getElementById('btnMyTeam');

    // 2. Hide EVERYTHING by default to be safe
    if (btnMyOrders) btnMyOrders.style.display = 'none';
    if (btnMonitor) btnMonitor.style.display = 'none';
    if (btnBonuses) btnBonuses.style.display = 'none';
    if (btnAssignation) btnAssignation.style.display = 'none';
    if (btnSystem) btnSystem.style.display = 'none';
    if (btnCallCenter) btnCallCenter.style.display = 'none';
    if (btnSettings) btnSettings.style.display = 'none';
    if (btnWarehouse) btnWarehouse.style.display = 'none';
    if (btnAccounting) btnAccounting.style.display = 'none';
    if (btnTracking) btnTracking.style.display = 'none';
    if (btnMyTeam) btnMyTeam.style.display = 'none';
    if (btnFleetManager) btnFleetManager.style.display = 'none';

    // 3. Fetch this specific role's permissions from the database
    const { data: perms, error } = await supabaseClient
        .from('role_permissions')
        .select('*')
        .eq('role', userRole)
        .single();

    if (error || !perms) {
        console.error("Could not load permissions for role:", userRole);
        return; // If they have no permissions mapped, they stay safely hidden
    }

    // 4. Show buttons based EXACTLY on what the database says
    if (btnMyOrders && perms.can_view_my_orders) btnMyOrders.style.display = 'block';
    if (btnMonitor && perms.can_view_monitor) btnMonitor.style.display = 'block';
    if (btnBonuses && perms.can_view_bonuses) btnBonuses.style.display = 'block';
    if (btnAssignation && perms.can_view_assignation) btnAssignation.style.display = 'block';
    if (btnSystem && perms.can_view_system) btnSystem.style.display = 'block';
    if (btnCallCenter && perms.can_view_call_center) btnCallCenter.style.display = 'block';
    if (btnSettings && perms.can_view_settings) btnSettings.style.display = 'block';
    if (btnWarehouse && perms.can_view_warehouse) btnWarehouse.style.display = 'block';
    if (btnAccounting && perms.can_view_accounting) btnAccounting.style.display = 'block';
    if (btnTracking && perms.can_view_tracking) btnTracking.style.display = 'block';
    
    // --- PHASE 3: DATABASE-DRIVEN VISIBILITY ---
    if (btnMyTeam && perms.can_view_my_team) btnMyTeam.style.display = 'block';
    if (btnFleetManager && perms.can_view_fleet) btnFleetManager.style.display = 'block';
    
}
// ---------------------------------------------------


// --- SETTINGS PAGE NAVIGATION ---
const settingsPage = document.getElementById('settingsPage');

document.getElementById('btnSettings').addEventListener('click', () => {
    // 1. Turn off ANY page that is currently visible
    document.querySelectorAll('.page.active').forEach(page => {
        page.classList.remove('active');
    });
    
    // 2. Turn on the Settings page
    settingsPage.classList.add('active');
});

document.getElementById('settingsHubBtn').addEventListener('click', () => {
    settingsPage.classList.remove('active');
    menuPage.classList.add('active');
});


// --- TECH PAGE (MY ORDERS) NAVIGATION ---
const techPage = document.getElementById('techPage');

document.getElementById('btnMyOrders').addEventListener('click', () => {
    // 1. Hide the main menu and show the technician page
    menuPage.classList.remove('active');
    techPage.classList.add('active');

    // ---Reset Manager Dropdown State ---
    const managerSelect = document.getElementById('managerUserSelect');
    if (managerSelect) {
        managerSelect.value = '';
    }
    // -----------------------------------------
    
    // 2. Trigger the fetch logic to load their active tickets
    loadActiveTickets();
});

// Wire up the Logout/Back button inside the Tech Page
document.getElementById('techHubBtn').addEventListener('click', () => {

    // ---Garbage (unwanted records or tables saved to the browser) Collection ---
    originalMyOrders = [];
    currentMyOrders = [];
    const ticketContainer = document.getElementById('ticketContainer');
    if (ticketContainer) ticketContainer.innerHTML = '';
    const countBadge = document.getElementById('myOrdersCountBadge');
    if (countBadge) countBadge.style.display = 'none';
    // -------------------------------


    // Go back to the HUB menu
    techPage.classList.remove('active');
    menuPage.classList.add('active');
});




// ---HUB SEARCH ORDER LOGIC ---
document.getElementById('btnHubSearchOrder').addEventListener('click', async () => {
    const searchInput = document.getElementById('hubSearchSoInput').value.trim();
    if (!searchInput) {
        alert("Please enter an SO number to search.");
        return;
    }

    showGlobalLoader("Locating Order...");

    // 1. Try to find the order in the live edits or main memory first
    let foundOrder = null;
    if (typeof editedOrders !== 'undefined' && editedOrders[searchInput]) {
        foundOrder = editedOrders[searchInput];
    } else if (typeof databaseOrders !== 'undefined' && databaseOrders.length > 0) {
        foundOrder = databaseOrders.find(o => String(o.so) === searchInput);
    }

    // 2. If it's not in memory, ask the database directly
    if (!foundOrder) {
        const { data, error } = await supabaseClient
            .from('orders')
            .select('*')
            .eq('so', searchInput)
            .single();
        
        if (data && !error) {
            foundOrder = data;
        }
    }

    hideGlobalLoader();

    // 3. Display the result
    if (foundOrder) {
        openViewOnlyModal(foundOrder);
        // Clear the input box so it's ready for the next search
        document.getElementById('hubSearchSoInput').value = ''; 
    } else {
        alert(`Order with SO: ${searchInput} does not exist in the system.`);
    }
});

// ALLOW 'ENTER' KEY TO SEARCH FROM THE HUB
document.getElementById('hubSearchSoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault(); 
        document.getElementById('btnHubSearchOrder').click();
    }
});



//=========This code for "Remove dead renderBonusesData function"=========
// --- My orders - TECHNICIAN PAGE LOGIC ---

let activeTechTicket = null; // Keeps track of the currently opened order
// --- MY ORDERS FILTER & SORT ENGINE ---
let originalMyOrders = [];
let currentMyOrders = [];
let myOrdersSortDir = {};
let currentMyOrdersViewMode = 'technician'; // Tracks if the active screen is a Tech or Coord view
const MY_ORDERS_COLS = [
    { key: 'so', label: 'SO' },
    { key: 'date', label: 'Date' },
    { key: 'days', label: 'Days' },
    { key: 'rout', label: 'Rout' },
    { key: 'phone', label: 'Phone' }
];

function buildMyOrdersFilterTable() {
    const filterContainer = document.getElementById('myOrdersFilterContainer');
    const headerRow = document.getElementById('myOrdersFilterHeaders');
    const filterRow = document.getElementById('myOrdersFilterInputs');

    if (originalMyOrders.length === 0) {
        filterContainer.style.display = 'none';
        return;
    }
    
    filterContainer.style.display = 'block';
    
    // Wipe them clean first so we can rebuild the fresh lists if new tickets arrive
    headerRow.innerHTML = '';
    filterRow.innerHTML = '';

    MY_ORDERS_COLS.forEach(col => {
        const th = document.createElement('th');
        th.style.padding = "5px";
        th.style.borderBottom = "1px solid var(--border-color)";
        th.style.borderRight = "1px solid var(--border-color)";
        th.innerHTML = `<span class="sort-header" style="cursor:pointer; font-weight:bold; font-size: 13px;">${col.label}</span>`;
        
        th.querySelector('.sort-header').addEventListener('click', () => sortMyOrders(col.key));
        headerRow.appendChild(th);

        const td = document.createElement('th');
        td.style.padding = "2px";
        td.style.borderRight = "1px solid var(--border-color)";
        
        // 1. Generate unique values for this specific column from the active tickets
        const uniqueValues = new Set();
        originalMyOrders.forEach(row => {
            const val = row[col.key];
            if (val !== null && val !== undefined && String(val).trim() !== '') {
                uniqueValues.add(String(val).trim());
            }
        });

        // 2. Build the invisible Datalist container
        const datalistId = `myOrders_list_${col.key}`;
        const datalist = document.createElement('datalist');
        datalist.id = datalistId;
        
        // Sort alphabetically and add them to the list
        Array.from(uniqueValues).sort().forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            datalist.appendChild(opt);
        });
        td.appendChild(datalist);

        // 3. Build the Input and connect it to the Datalist
        const input = document.createElement('input');
        input.type = 'text';
        input.dataset.column = col.key;
        input.setAttribute('list', datalistId); // Hook to our new datalist
        input.setAttribute('autocomplete', 'off'); // Stops Google Chrome's autofill from getting in the way
        
        input.style.width = '100%';
        input.style.boxSizing = 'border-box';
        input.style.padding = '4px 2px';
        input.style.fontSize = '12px';
        input.style.background = 'var(--bg-color)';
        input.style.color = 'var(--text-color)';
        input.style.border = '1px solid var(--border-color)';
        input.style.borderRadius = '2px';
        
        input.addEventListener('input', runMyOrdersFilters);
        td.appendChild(input);
        filterRow.appendChild(td);
    });
}

function runMyOrdersFilters() {
    const filterInputs = document.querySelectorAll('#myOrdersFilterInputs input');
    let filteredData = [...originalMyOrders];

    filterInputs.forEach(input => {
        const val = input.value.toLowerCase().trim();
        const colKey = input.dataset.column;

        if (val) {
            filteredData = filteredData.filter(row => {
                const cellValue = String(row[colKey] || '').toLowerCase();
                return cellValue.includes(val);
            });
        }
    });

    currentMyOrders = filteredData;
    renderTickets(currentMyOrders, currentMyOrdersViewMode);
}

function sortMyOrders(colKey) {
    const currentDir = myOrdersSortDir[colKey] === 'asc' ? 'desc' : 'asc';
    myOrdersSortDir = { [colKey]: currentDir }; 

    currentMyOrders.sort((a, b) => {
        let valA = a[colKey] || '';
        let valB = b[colKey] || '';

        if (colKey === 'days') return currentDir === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);

        //=========This code for "Robust Multi-Format Date Sorting Engine (My Orders)"=========
        if (colKey === 'date') {
            const parseDateValue = (str) => {
                if (!str) return 0;
                if (typeof str !== 'string') return 0;
                const parts = str.trim().split(/[\.\/\-]/);
                if (parts.length !== 3) return 0;
                const m = parseInt(parts[0], 10) - 1;
                const d = parseInt(parts[1], 10);
                let y = parseInt(parts[2], 10);
                if (isNaN(m) || isNaN(d) || isNaN(y)) return 0;
                if (y < 100) y += 2000;
                const ts = new Date(y, m, d).getTime();
                return isNaN(ts) ? 0 : ts;
            };
            const timeA = parseDateValue(valA);
            const timeB = parseDateValue(valB);
            if (!timeA && !timeB) return 0;
            if (!timeA) return 1;
            if (!timeB) return -1;
            return currentDir === 'asc' ? timeA - timeB : timeB - timeA;
        }
        return currentDir === 'asc' ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
    });

    renderTickets(currentMyOrders, currentMyOrdersViewMode);
}
// ------------------------------------------

// --- EVENT LISTENER FOR MANAGER DROPDOWN ---
document.getElementById('managerUserSelect').addEventListener('change', (e) => {
    loadActiveTickets(e.target.value);
});

// ---Universal Sequence Sorting Engine ---
function applySequenceSort(dataArray) {
    dataArray.sort((a, b) => {
        const hasSeqA = a.visit_sequence !== null && a.visit_sequence !== '' && a.visit_sequence !== undefined;
        const hasSeqB = b.visit_sequence !== null && b.visit_sequence !== '' && b.visit_sequence !== undefined;

        if (hasSeqA && hasSeqB) {
            return Number(a.visit_sequence) - Number(b.visit_sequence); // 1, 2, 3...
        } else if (hasSeqA && !hasSeqB) {
            return -1; // Sequenced items float to the top
        } else if (!hasSeqA && hasSeqB) {
            return 1;  // Non-sequenced items sink
        } else {
            // If neither has a sequence, fallback to the original default (highest days first)
            return Number(b.days || 0) - Number(a.days || 0);
        }
    });
}
// ----------------------------------------------

// --- NEW: Today's Work Summary Engine ---
async function updateTechTodaySummary(targetTechName) {
    const btnSummary = document.getElementById('btnTechTodaySummary');
    if (!btnSummary) return;

    if (!navigator.onLine) {
        btnSummary.style.display = 'none';
        return;
    }

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const todayStr = `${dd}-${mm}-${yyyy}`;

    try {
        const { data, error } = await supabaseClient
            .from('repair_log')
            .select('so, collected_reason')
            .eq('assign_date', todayStr)
            .ilike('assigned_by', targetTechName);

        if (error) throw error;

        const todayLogs = data || [];

        //=========This code for "Split Today's Work Count (Actual vs Phone)"=========
        const actualReasons = new Set([
            "Visit زيارة - Installation تركيب",
            "Visit زيارة - Check up كشف",
            "Repair صيانة - In warranty ضمان",
            "Repair صيانة - Out of warranty خارج الضمان"
        ]);

        let actualCount = 0;
        let phoneCount = 0;

        todayLogs.forEach(log => {
            const r = (log.collected_reason || '').trim();
            if (actualReasons.has(r)) {
                actualCount++;
            } else {
                phoneCount++;
            }
        });

        //=========This code for "High-Contrast Pill Badges for Today's Work"=========
        btnSummary.style.backgroundColor = '#1e293b';
        btnSummary.style.borderColor = '#334155';
        btnSummary.style.color = '#f8fafc';
        btnSummary.innerHTML = `📊 Today's Work (<span style="background: rgba(0, 0, 0, 0.45); color: #00e676; padding: 2px 8px; border-radius: 12px; font-weight: bold; border: 1px solid rgba(0, 230, 118, 0.35); display: inline-block;">فعلى : ${actualCount}</span> | <span style="background: rgba(0, 0, 0, 0.45); color: #ffffff; padding: 2px 8px; border-radius: 12px; font-weight: bold; border: 1px solid rgba(255, 255, 255, 0.25); display: inline-block;">بالهاتف : ${phoneCount}</span>)`;
        btnSummary.style.display = 'inline-block';
        //=============================================================================

        // Override existing click listeners to prevent stacking
        btnSummary.onclick = () => {
            const breakdown = {};
            todayLogs.forEach(log => {
                const reason = log.collected_reason || 'Unknown Action';
                if (!breakdown[reason]) breakdown[reason] = [];
                breakdown[reason].push(log.so);
            });

            const metricList = document.getElementById('metricModalList');
            metricList.innerHTML = '';
            
            document.getElementById('metricModalTitle').textContent = `Today's Completed Work: ${targetTechName}`;
            document.getElementById('metricModalSubtitle').textContent = `Total Actions: ${todayLogs.length}`;

            for (const [reason, sos] of Object.entries(breakdown)) {
                const groupDiv = document.createElement('div');
                groupDiv.style.cssText = "background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 4px; padding: 10px;";
                
                const soLinks = sos.map(so => `<a href="#" onclick="document.getElementById('metricDetailsModal').style.display='none'; document.getElementById('hubSearchSoInput').value='${so}'; document.getElementById('btnHubSearchOrder').click(); return false;" style="color: #1976d2; font-weight: bold;">${so}</a>`).join(', ');

                groupDiv.innerHTML = `
                    <strong style="color: #fbc02d; font-size: 14px; display: block; border-bottom: 1px dashed var(--border-color); padding-bottom: 5px; margin-bottom: 5px;">${reason} (${sos.length})</strong>
                    <div style="font-size: 13px;">${soLinks}</div>
                `;
                metricList.appendChild(groupDiv);
            }

            if (todayLogs.length === 0) {
                metricList.innerHTML = '<div style="text-align:center; padding: 15px; opacity: 0.8;">No actions completed today.</div>';
            }

            document.getElementById('metricDetailsModal').style.display = 'flex';
        };
    } catch (err) {
        console.error("Failed to fetch today's summary:", err);
        btnSummary.style.display = 'none';
    }
}
// ----------------------------------------

async function loadActiveTickets(managerOverrideUser = null) {
    if (!currentUser) return;

    const role = currentUser.role.toLowerCase();
    const isManager = role.includes('manager') || role.includes('admin');
    const isSupervisor = role.includes('supervisor');
    const canSelectUser = isManager || isSupervisor;
    let targetRole = role; // Default to your own role

    // FORCE HIDE THE DROPDOWN FIRST (Fixes the bug for non-managers)
    const managerContainer = document.getElementById('managerUserSelectContainer');
    if (managerContainer) managerContainer.style.display = 'none';


    // --- MANAGER/SUPERVISOR INTERCEPTOR ---
    if (canSelectUser) {
        document.getElementById('managerUserSelectContainer').style.display = 'flex';
        // Adjust Label Dynamically
        document.querySelector('#managerUserSelectContainer label').textContent = isSupervisor && !isManager 
            ? "View Your Team's Orders:" 
            : "View User's Orders (Manager Only):";
        
        const userSelect = document.getElementById('managerUserSelect');
        
        if (userSelect.children.length <= 1) {
            let query = supabaseClient.from('profiles').select('username, role');
            
            // If they are ONLY a supervisor, strictly limit to their assigned team
            if (isSupervisor && !isManager) {
                // --- PHASE 3: MATRIX JSON ARRAY DROPDOWN OVERRIDE ---
                // 1. Fetch the supervisor's team matrix from the database
                const { data: supData } = await supabaseClient
                    .from('profiles')
                    .select('team_members')
                    .eq('username', currentUser.username)
                    .single();
                
                let teamArray = [];
                try {
                    teamArray = typeof supData?.team_members === 'string' 
                        ? JSON.parse(supData.team_members) 
                        : (supData?.team_members || []);
                } catch(e) {}
                
                // 2. Ensure the supervisor is always in their own dropdown to view personal tickets
                if (!teamArray.includes(currentUser.username)) {
                    teamArray.push(currentUser.username);
                }
                
                // 3. Command Supabase to strictly return only these specific users
                query = query.in('username', teamArray);
                // ----------------------------------------------------
            }

            const { data } = await query; 
            if (data) {
                data.sort((a,b) => a.username.localeCompare(b.username)).forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.username;
                    opt.textContent = p.username;
                    opt.dataset.role = p.role.toLowerCase(); // Save the role secretly in the dropdown
                    userSelect.appendChild(opt);
                });
            }
        }
        
        if (!managerOverrideUser) {
            document.getElementById('ticketContainer').innerHTML = "<h3 style='text-align:center;'>Please select a user from the dropdown above to view their active tickets.</h3>";
            originalMyOrders = [];
            buildMyOrdersFilterTable();
            if(document.getElementById('myOrdersCountBadge')) document.getElementById('myOrdersCountBadge').style.display = 'none';
            return;
        }

        // Figure out the exact role of the person the manager just selected
        const selectedOption = Array.from(userSelect.options).find(opt => opt.value === managerOverrideUser);
        if (selectedOption && selectedOption.dataset.role) {
            targetRole = selectedOption.dataset.role;
        }
    }

    let targetName = managerOverrideUser || currentUser.username;
    let driverTechArray = []; // Array to hold multiple technicians if target is a driver
    
    // --- PHASE 1: PRECISE VIEW MODE ROUTING (TARGET-BASED) ---
    // The view mode is now dictated by the role of the person being viewed, NOT the manager.
    if (targetRole.includes('tracking')) {
        currentMyOrdersViewMode = 'tracking';
    } else if (targetRole.includes('coordinator') || targetRole.includes('admin') || targetRole.includes('manager')) {
        currentMyOrdersViewMode = 'coordinator';
    } else if (targetRole.includes('driver') || (currentUser.is_driver && !managerOverrideUser)) {
        currentMyOrdersViewMode = 'driver';
    } else {
        currentMyOrdersViewMode = 'technician';
    }
    // ---------------------------------------------------------

    // --- ARCHITECT MOD: TOGGLE SHIFT & LOCATION UI ---
    const isDriverView = currentMyOrdersViewMode === 'driver' && !managerOverrideUser;
    
    const shiftContainer = document.getElementById('driverShiftContainer');
    const fixedLocationUI = document.getElementById('driverFixedLocationUI');
    const routePlannerBtn = document.getElementById('btnOpenRoutePlanner');
    const techPartsBtn = document.getElementById('btnOpenTechParts');
    
    if (shiftContainer) {
        shiftContainer.style.display = isDriverView ? 'flex' : 'none';
        if (isDriverView && typeof checkDriverShiftState === 'function') checkDriverShiftState();
    }
    if (fixedLocationUI) fixedLocationUI.style.display = isDriverView ? 'flex' : 'none';
    
    // Hide Technical Modules for Drivers
    if (routePlannerBtn) routePlannerBtn.style.display = isDriverView ? 'none' : 'inline-block';
    if (techPartsBtn) techPartsBtn.style.display = isDriverView ? 'none' : 'inline-block';

    if (currentMyOrdersViewMode === 'technician') {
        updateTechTodaySummary(targetName);
    } else {
        const btnSummary = document.getElementById('btnTechTodaySummary');
        if (btnSummary) btnSummary.style.display = 'none';
    }

    // --- PHASE 1: MULTI-TARGET FLEET PAIRING INTERCEPTOR ---
    if (currentMyOrdersViewMode === 'driver') {
        document.getElementById('ticketContainer').innerHTML = "<h3 style='text-align:center;'>Checking Fleet Pairing...</h3>";
        
        if (typeof getFleetPairedTechsForDriver === 'function') {
            driverTechArray = await getFleetPairedTechsForDriver(targetName);
        }
        
        if (!driverTechArray || driverTechArray.length === 0) {
            document.getElementById('ticketContainer').innerHTML = `<h3 style='text-align:center;'>No paired Technician found for ${targetName} today. Contact Coordination.</h3>`;
            if(document.getElementById('myOrdersCountBadge')) document.getElementById('myOrdersCountBadge').style.display = 'none';
            return;
        }
    }
    // -------------------------------------------------------

    // --- TRACKING ROUTE ---
    if (!navigator.onLine) {
        if (isManager) return alert("Managers must have an active internet connection to view other users' tickets.");
        loadTicketsFromVault();
        return; 
    }

    try {
        // --- PHASE 1: DYNAMIC MULTI-BRANCH QUERY ---
        let fetchQuery = supabaseClient.from('orders').select('*');
        
        if (currentMyOrdersViewMode === 'tracking') {
            // Tracking View: Fetch the strictly tracked queue
            document.getElementById('ticketContainer').innerHTML = `<h3 style='text-align:center;'>Loading Tracking Queue...</h3>`;
            fetchQuery = fetchQuery.eq('status', 'Tracking');
            
        } else if (currentMyOrdersViewMode === 'coordinator') {
            // Coordinator View: Fetch the shared global back_office queue
            document.getElementById('ticketContainer').innerHTML = `<h3 style='text-align:center;'>Loading Back Office Queue...</h3>`;
            fetchQuery = fetchQuery.eq('status', 'back_office');
            
       } else if (currentMyOrdersViewMode === 'driver') {
            // Driver View: Fetch active tickets for ALL paired technicians simultaneously
            document.getElementById('ticketContainer').innerHTML = `<h3 style='text-align:center;'>Loading fleet tickets for ${driverTechArray.join(' & ')}...</h3>`;
            
            /// Build a dynamic OR string to match exact names safely without dangerous wildcards
            const orString = driverTechArray.map(tech => `assigned_tech.ilike.${tech.trim()}`).join(',');
            
            // ARCHITECT MOD HOTFIX: Remove the 'left_at' filter entirely. 
            // Filtering on 'left_at' permanently hides multi-day tickets. The UI handles daily button resets natively.
            fetchQuery = fetchQuery.in('status', ['Technician', 'back_office'])
                                   .or(orString);
            
        } else {
            // Technician View: Fetch their strictly assigned tickets
            document.getElementById('ticketContainer').innerHTML = `<h3 style='text-align:center;'>Loading tickets for ${targetName}...</h3>`;
            fetchQuery = fetchQuery.eq('status', 'Technician').ilike('assigned_tech', targetName);
        }

        const { data: ordersData, error: orderErr } = await fetchQuery;
        // -----------------------------------------
        
        if (orderErr) throw orderErr;

        if (!ordersData || ordersData.length === 0) {
            document.getElementById('ticketContainer').innerHTML = `<h3 style='text-align:center;'>${targetName} has no active orders! 🎉</h3>`;
            if (localDB && !managerOverrideUser) {
                const transaction = localDB.transaction('inbox', 'readwrite');
                const store = transaction.objectStore('inbox');
                store.put({ id: 'latest_tickets', tickets: [] });
            }
            originalMyOrders = [];
            buildMyOrdersFilterTable();
            if(document.getElementById('myOrdersCountBadge')) document.getElementById('myOrdersCountBadge').style.display = 'none';
            return;
        }

        //  data.sort((a, b) => Number(b.days || 0) - Number(a.days || 0));
        applySequenceSort(ordersData);
        originalMyOrders = [...ordersData];
        currentMyOrders = [...ordersData];
        buildMyOrdersFilterTable();

        if (localDB && !managerOverrideUser) {
            const transaction = localDB.transaction('inbox', 'readwrite');
            const store = transaction.objectStore('inbox');
            store.put({ id: 'latest_tickets', tickets: ordersData });
        }

        renderTickets(currentMyOrders, currentMyOrdersViewMode); // Passed the view mode!
    } catch (err) {
        console.error('Network request failed:', err);
        if (!isManager) loadTicketsFromVault();
    }
}


function renderTickets(tickets, viewMode = 'technician') {
    const container = document.getElementById('ticketContainer');
    container.innerHTML = '';

    // NEW: Update active count badge
    const countBadge = document.getElementById('myOrdersCountBadge');
    if (countBadge) {
        countBadge.textContent = tickets.length;
        countBadge.style.display = tickets.length > 0 ? 'inline-block' : 'none';
    }

    try {
        tickets.forEach(ticket => {
            const card = document.createElement('div');
            card.className = 'ticket-card';
            
            // --- PHASE 2: RETURN & REDO ORDER CARD STYLING ---
            let returnBadgeHtml = '';
            const returnValStr = ticket.return ? String(ticket.return).toLowerCase() : '';

            if (returnValStr.startsWith('return')) {
                card.style.border = '2px solid #d32f2f'; // Prominent red border
                card.style.backgroundColor = 'rgba(211, 47, 47, 0.05)'; // Faint red background
                returnBadgeHtml = `<div style="background-color: #d32f2f; color: white; text-align: center; font-weight: bold; padding: 4px; border-radius: 4px 4px 0 0; margin: -15px -15px 10px -15px; font-size: 14px;">⚠️ RETURN ORDER / ${ticket.return} ⚠️</div>`;
            } else if (returnValStr.startsWith('redo')) {
                card.style.border = '2px solid #f57c00'; // Yellowish/Orange border
                card.style.backgroundColor = 'rgba(245, 124, 0, 0.05)'; // Faint yellowish background
                returnBadgeHtml = `<div style="background-color: #f57c00; color: white; text-align: center; font-weight: bold; padding: 4px; border-radius: 4px 4px 0 0; margin: -15px -15px 10px -15px; font-size: 14px;">⚠️ REDO ORDER / ${ticket.return} ⚠️</div>`;
            }
            // ------------------------------------------

            // ARMORED: We use String() to force numbers into text so .replace() never crashes!
            const safePhone1 = ticket.phone ? String(ticket.phone).replace(/\s+/g, '') : '';
            const safePhone2 = ticket.phone_2 ? String(ticket.phone_2).replace(/\s+/g, '') : '';

            const p1 = ticket.phone ? `<a class="phone-link" href="tel:${safePhone1}">📞 ${ticket.phone}</a>` : 'N/A';
            // --- MODIFIED: Remove 'N/A' fallback for secondary phone ---
            const p2 = ticket.phone_2 ? `<a class="phone-link" href="tel:${safePhone2}">📞 ${ticket.phone_2}</a>` : '';
            // -----------------------------------------------------------

            // --- NEW: EXTRACT AND FORMAT PARTS FOR THE OUTSIDE CARD ---
            let partsArray = [];
            for (let i = 1; i <= 5; i++) {
                let part = (ticket[`part_${i}`] || '').trim();
                let qty = (ticket[`qty_${i}`] || '').trim();
                if (part && part.toUpperCase() !== 'EMPTY') {
                    partsArray.push(`${part} (x${qty && qty.toUpperCase() !== 'EMPTY' ? qty : '1'})`);
                }
            }
            let partsHtml = partsArray.length > 0 ? `<div style="color: #8e24aa; font-size: 13px; font-weight: bold; margin-top: 8px; padding-top: 5px; border-top: 1px dashed var(--border-color);">🛠️ Parts: ${partsArray.join(', ')}</div>` : '';
            // ----------------------------------------------------------

            // --- PHASE 2: UI RENDERING (DRIVER VS STANDARD) ---
            if (viewMode === 'driver' && typeof getDriverTicketHtml === 'function') {
                card.innerHTML = returnBadgeHtml + getDriverTicketHtml(ticket);
                if (typeof bindDriverTicketEvents === 'function') bindDriverTicketEvents(card, ticket);
            } else {
                let actionButtonsHtml = `<button class="details-btn">Details & Action</button>`;
                
                // --- NEW: Scheduled Date Display ---
                let scheduledDateHtml = '';
                if (ticket.scheduled_date && ticket.scheduled_date.trim() !== '') {
                    scheduledDateHtml = `<div class="ticket-row" style="margin-top: 5px; background: rgba(255, 179, 0, 0.1); padding: 5px; border-left: 3px solid #ffb300; color: #e65100; font-weight: bold;">📅 Scheduled Date تأجيل: ${ticket.scheduled_date}</div>`;
                }
                // -----------------------------------

                let ticketBodyHtml = `
                    <div class="ticket-header">
                        <span>SO: ${ticket.so}</span>
                        <span style="color:#ffb300;">Days: ${ticket.days || 0}</span>
                    </div>
                    <div class="ticket-row"><span>Name: ${ticket.name || 'N/A'}</span> <span>${p1}</span></div>
                    <div class="ticket-row"><span>Date: ${ticket.date || 'N/A'}</span> <span>${p2}</span></div>
                    <div class="ticket-row" style="margin-top: 5px;"><strong>Address:</strong> ${ticket.address || 'N/A'}</div>

                    <!-- --- Model, SN, and I/O on the same flex-wrapped line --- -->
                    <div class="ticket-row" style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 5px;">
                        <span><strong>Model:</strong> ${ticket.model || 'N/A'}</span> 
                        <span><strong>SN:</strong> ${ticket.serial || 'N/A'}</span>
                        <span><strong>I/O:</strong> <span style="color: #e65100; font-weight: bold;">${ticket.io || 'N/A'}</span></span>
                    </div>
                    <!-- ------------------------------------------------------------------- -->

                    ${scheduledDateHtml}
                    <div class="ticket-row" style="margin-top: 5px;"><strong>Status Comment:</strong> ${ticket.status_comment || 'N/A'}</div>
                    <div class="ticket-row" style="margin-top: 5px;"><strong>Assigned Tech:</strong> <span style="color: #1976d2; font-weight: bold;">${ticket.assigned_tech || 'N/A'}</span></div>
                    ${partsHtml}
                    ${actionButtonsHtml}
                `;
                
                card.innerHTML = returnBadgeHtml + ticketBodyHtml;
                card.querySelector('.details-btn').addEventListener('click', () => openDetailsModal(ticket, viewMode));
            }
            
            container.appendChild(card);
        });
    } catch (err) {
        console.error("Error building ticket cards:", err);
        alert("CRASH PREVENTED: An error occurred while drawing the tickets: " + err.message);
    }
}
// --- MODAL & VALIDATION ENGINE ---

const detailsModal = document.getElementById('detailsModal');
const collectedInput = document.getElementById('collectedInput');
const reasonGroup = document.getElementById('reasonGroup');
const mainReasonSelect = document.getElementById('mainReasonSelect');
const subReasonSelect = document.getElementById('subReasonSelect');
const subReasonContainer = document.getElementById('subReasonContainer');
const scheduledDateContainer = document.getElementById('scheduledDateContainer'); // NEW
const scheduledDateInput = document.getElementById('scheduledDateInput'); // NEW
const commentInput = document.getElementById('commentInput');
const confirmTechBtn = document.getElementById('confirmTechBtn');

const subReasonMap = {
    "Visit زيارة": ["Installation تركيب", "In warranty ضمان", "Check up كشف"],
    "Repair صيانة": ["In warranty ضمان", "Out of warranty خارج الضمان"],
    "Cancel إلغاء": ["No answer لا يرد", "Postpone تأجيل", "Refused Repair رفض الصيانة"]
};

// Helper to parse JSON media payloads and render dynamic links
function renderDynamicMediaLinks(imgPayload, vidPayload, callPayload) {
    const container = document.getElementById('dynamicMediaViewer');
    if (!container) return;
    container.innerHTML = ''; // Clear previous ticket's media

    const processPayload = (payload, baseLabel) => {
        if (!payload || payload.trim() === '') return;
        try {
            // Backward compatibility: If it's a raw URL from the old system, wrap it in our new format
            const isJson = payload.trim().startsWith('[');
            const mediaArray = isJson ? JSON.parse(payload) : [{ url: payload, label: `Legacy ${baseLabel}`, uploader: 'System' }];

                mediaArray.forEach((media) => {
                    const el = document.createElement('span');
                    el.style.cssText = "display: inline-flex; align-items: center; background: var(--bg-color); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color);";
                    
                    if (media.type === 'pbx_call') {
                        if (media.recording_available) {
                            el.innerHTML = `
                                <a href="#" onclick="viewTelephonyRecordingInline('${media.call_id}', '${media.label}'); return false;" style="color: #1976d2; font-weight: bold; text-decoration: underline; margin-right: 8px;">🔊 ${media.label} <span style="font-size: 10px; color: gray;">(${media.uploader})</span></a>
                            `;
                        } else {
                            el.innerHTML = `
                                <span style="color: gray; margin-right: 8px;">📞 ${media.label} <span style="font-size: 10px;">(${media.recording_status || 'No Rec'})</span></span>
                            `;
                        }
                    } else {
                        el.innerHTML = `
                            <a href="#" onclick="viewMediaInline('${media.url}', '${media.label}'); return false;" style="color: #1976d2; font-weight: bold; text-decoration: underline; margin-right: 8px;">👁️ ${media.label} <span style="font-size: 10px; color: gray;">(${media.uploader})</span></a>
                            <a href="${media.url}" target="_blank" style="text-decoration: none;" title="Open natively / Download">🔗</a>
                        `;
                    }
                    container.appendChild(el);
                });
        } catch (e) {
            console.error(`Failed to parse ${baseLabel} JSON payload:`, e);
        }
    };

    processPayload(imgPayload, 'Image');
    processPayload(vidPayload, 'Video');
    processPayload(callPayload, 'Call Record');


    // If no files were generated, show a clean fallback
    if (container.children.length === 0) {
        container.innerHTML = '<span style="color: #9e9e9e; font-style: italic;">No media attached to this ticket.</span>';
    }
}

// --- INLINE TELEPHONY RECORDING PLAYER ---
window.viewTelephonyRecordingInline = function(callId, label) {
    const viewer = document.getElementById('inlineMediaViewer');
    const content = document.getElementById('mediaViewerContent');
    if (!viewer || !content) return;
    
    viewer.style.display = 'block';
    content.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; padding: 10px;">
            <span style="color: white; font-weight: bold;">🎧 ${label}</span>
            <audio id="telephonyInlineAudio" controls style="width: 100%; max-width: 400px;"></audio>
        </div>
    `;
    const audioEl = document.getElementById('telephonyInlineAudio');
    if (typeof window.playTelephonyRecording === 'function') {
        window.playTelephonyRecording(callId, audioEl);
    }
};

// --- INLINE MEDIA PLAYER LOGIC ---
window.viewMediaInline = function(url, label) {
    const viewer = document.getElementById('inlineMediaViewer');
    const content = document.getElementById('mediaViewerContent');
    
    viewer.style.display = 'block';
    content.innerHTML = '<span style="color: white; font-weight: bold;">Loading Media...</span>';
    
    const isVideo = url.toLowerCase().includes('.mp4') || url.toLowerCase().includes('.mov') || url.toLowerCase().includes('.webm') || label.toLowerCase().includes('vid');

    if (isVideo) {
        content.innerHTML = `
            <video controls autoplay style="max-width: 100%; max-height: 350px; border-radius: 4px; box-shadow: 0 4px 8px rgba(0,0,0,0.5);">
                <source src="${url}">
                <p style="color: white;">Your browser blocks this Apple video format. Click the 🔗 icon above to download it instead.</p>
            </video>`;
    } else {
        content.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 350px; border-radius: 4px; box-shadow: 0 4px 8px rgba(0,0,0,0.5); object-fit: contain;">`;
    }
};

// --- UNIVERSAL TICKET HISTORY FETCHER ---
function fetchAndRenderTicketHistory(soNumber) {
    // 1. Un-hide the history section and show loading text
    document.getElementById('coordHistorySection').style.display = 'block';
    document.getElementById('lastPushedByValue').textContent = 'Loading...';
    document.getElementById('coordCommentsList').innerHTML = '<span style="color: gray;">Loading comments...</span>';

    // 2. Fetch the data from the repair_log
    supabaseClient.from('repair_log')
        .select('*')
        .eq('so', soNumber)
        .then(({ data: logs, error }) => {
            if (error) {
                document.getElementById('coordCommentsList').innerHTML = '<span style="color: #d32f2f;">Failed to load history.</span>';
                document.getElementById('lastPushedByValue').textContent = 'Error loading data';
                return;
            }
            
            if (!logs || logs.length === 0) {
                 document.getElementById('coordCommentsList').innerHTML = '<span style="color: gray;">No comments found.</span>';
                 document.getElementById('lastPushedByValue').textContent = 'Unknown';
                 return;
            }

            // 3. Sort logs newest-first
            logs.sort((a, b) => {
                const parseDate = (d) => d ? d.split('-').reverse().join('-') : '1970-01-01';
                const timeA = new Date(`${parseDate(a.assign_date)}T${a.assign_time || '00:00'}`);
                const timeB = new Date(`${parseDate(b.assign_date)}T${b.assign_time || '00:00'}`);
                return timeB - timeA; 
            });

            // 4. Find who last pushed this to back_office
            const backOfficeLogs = logs.filter(l => l.status === 'back_office');
            if (backOfficeLogs.length > 0) {
                const latestPush = backOfficeLogs[0];
                document.getElementById('lastPushedByValue').textContent = `${latestPush.assigned_by || 'Unknown'} (on ${latestPush.assign_date} at ${latestPush.assign_time})`;
            } else {
                document.getElementById('lastPushedByValue').textContent = 'N/A';
            }

            // 5. Extract and format relevant logs (Comments AND Assignments)
            const displayLogs = logs.filter(l => (l.comment && l.comment.trim() !== '') || l.status === 'Technician');
            const commentsContainer = document.getElementById('coordCommentsList');
            commentsContainer.innerHTML = '';

            if (displayLogs.length > 0) {
                displayLogs.forEach(log => {
                    const div = document.createElement('div');
                    div.style.padding = '8px';
                    div.style.background = 'var(--bg-color)';
                    div.style.border = '1px solid var(--border-color)';
                    div.style.borderRadius = '4px';
                    
                    let contentHtml = '';
                    
                    // Inject Assignment Badge if applicable
                    if (log.status === 'Technician' && log.assigned_tech) {
                        contentHtml += `<div style="margin-top: 4px; margin-bottom: 4px; display: inline-block; background: #e3f2fd; color: #1976d2; padding: 3px 6px; border-radius: 4px; font-size: 12px; font-weight: bold; border: 1px solid #90caf9;">🔄 Assigned to: ${log.assigned_tech}</div><br>`;
                    }
                    
                    // Inject Comment Payload if applicable
                    if (log.comment && log.comment.trim() !== '') {
                        contentHtml += `<span style="margin-top: 4px; display: inline-block; color: var(--text-color);">${log.comment}</span>`;
                    }

                    div.innerHTML = `
                        <strong style="color: #4caf50;">${log.assigned_by || 'System'}</strong> 
                        <span style="font-size: 11px; opacity: 0.7;">(${log.assign_date} at ${log.assign_time}):</span><br>
                        ${contentHtml}
                    `;
                    commentsContainer.appendChild(div);
                });
            } else {
                commentsContainer.innerHTML = '<span style="color: gray;">No activity recorded yet.</span>';
            }
        });
}

// --- PHASE 4: PESSIMISTIC LOCKING ENGINE ---
const LOCK_TIMEOUT_MINUTES = 5;
const LOCK_TIMEOUT_MS = LOCK_TIMEOUT_MINUTES * 60 * 1000;

async function checkAndAcquireLock(soNumber) {
    if (!navigator.onLine || !currentUser) return { isLocked: false, message: "" };

    if (typeof showGlobalLoader === 'function') showGlobalLoader("Acquiring Ticket Lock...");
    
    const { data: lockData } = await supabaseClient
        .from('orders')
        .select('locked_by, locked_at')
        .eq('so', soNumber)
        .single();
        
    if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

    let isLockedByOther = false;
    let lockMessage = "";

    if (lockData && lockData.locked_by && lockData.locked_at) {
        const lockTime = new Date(lockData.locked_at).getTime();
        const nowTime = new Date().getTime();
        const timeDiff = nowTime - lockTime;

        if (lockData.locked_by !== currentUser.username && timeDiff < LOCK_TIMEOUT_MS) {
            isLockedByOther = true;
            const lockDateObj = new Date(lockData.locked_at);
            const unlockDateObj = new Date(lockTime + LOCK_TIMEOUT_MS);
            const formatTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            lockMessage = `
                <div style="background: #d32f2f; color: white; padding: 10px; border-radius: 4px; margin-bottom: 10px; font-weight: bold; border-left: 5px solid #ffb300;">
                    🔒 This ticket is currently locked and being edited by: <span style="color:#ffeb3b;">${lockData.locked_by}</span><br>
                    <span style="font-size: 13px; font-weight: normal;">
                        Locked at: ${formatTime(lockDateObj)}<br>
                        Automatically unlocks at: ${formatTime(unlockDateObj)}
                    </span>
                </div>
            `;
        }
    }

    if (!isLockedByOther) {
        // Acquire or extend the lock
        await supabaseClient.from('orders')
            .update({ locked_by: currentUser.username, locked_at: new Date().toISOString() })
            .eq('so', soNumber);
    }

    return { isLocked: isLockedByOther, message: lockMessage };
}

async function releaseTicketLock(soNumber) {
    if (!soNumber || !currentUser || !navigator.onLine) return;
    await supabaseClient.from('orders')
        .update({ locked_by: null, locked_at: null })
        .eq('so', soNumber)
        .eq('locked_by', currentUser.username); // Strict safety: only unlock if WE hold the lock
}
// -------------------------------------------

async function openDetailsModal(ticket, viewMode = 'technician') {
    currentlyViewedTicket = ticket;
    activeTechTicket = ticket;
    
    // --- PHASE 4: CHECK LOCK ---
    const lockStatus = await checkAndAcquireLock(ticket.so);

    // --- UPDATE THE MODAL HEADER WITH THE SO NUMBER ---
    const modalHeaders = document.querySelectorAll('#modalSoHeader');
    modalHeaders.forEach(header => {
        header.textContent = 'Order Details - SO: ' + ticket.so;
    });
    // -------------------------------------------------------
    // --- WIPE PREVIOUS UPLOAD TEXT ---
    const progressBox = document.getElementById('uploadProgressContainer');
    if (progressBox) {
        progressBox.style.display = 'none';
        progressBox.innerHTML = '';
    }
    // ---------------------------------
    
    // 1. Render Dynamic Media Links (Shared for both roles)
    renderDynamicMediaLinks(ticket.img1, ticket.vid1, ticket.calls);

    // --- Generate Clickable Phone Links for Modal ---
    const safePhone1 = ticket.phone ? String(ticket.phone).replace(/\s+/g, '') : '';
    const safePhone2 = ticket.phone_2 ? String(ticket.phone_2).replace(/\s+/g, '') : '';
    const pbxBtn1 = ticket.phone ? `<button type="button" onclick="window.triggerSecureCall('${ticket.so}', 'PRIMARY')" style="background: #1976d2; color: white; border: none; padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; margin-left: 6px; font-weight: bold;">PBX 📞</button>` : '';
    const pbxBtn2 = ticket.phone_2 ? `<button type="button" onclick="window.triggerSecureCall('${ticket.so}', 'SECONDARY')" style="background: #1976d2; color: white; border: none; padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; margin-left: 6px; font-weight: bold;">PBX 📞</button>` : '';
    const p1 = ticket.phone ? `<a class="phone-link" href="tel:${safePhone1}">📞 ${ticket.phone}</a> ${pbxBtn1}` : 'N/A';
    const p2 = ticket.phone_2 ? `<a class="phone-link" href="tel:${safePhone2}">📞 ${ticket.phone_2}</a> ${pbxBtn2}` : 'N/A';
    // -------------------------------------------------

    // 2. Populate Read-Only Details

    // ---DYNAMIC PURPLE PARTS FOR INSIDE THE TICKET ---
    // We build the parts list exactly like the outside ticket, ignoring empty slots
    let modalPartsArray = [];
    for (let i = 1; i <= 5; i++) {
        let part = (ticket[`part_${i}`] || '').trim();
        let qty = (ticket[`qty_${i}`] || '').trim();
        if (part && part.toUpperCase() !== 'EMPTY') {
            modalPartsArray.push(`${part} (x${qty && qty.toUpperCase() !== 'EMPTY' ? qty : '1'})`);
        }
    }
    
    // If we have parts, format the text in purple (#8e24aa) with a wrench icon. Otherwise, print N/A.
    let modalPartsHtml = modalPartsArray.length > 0 
        ? `<div style="color: #8e24aa; font-size: 14px; font-weight: bold; margin-bottom: 5px;">🛠️ Parts: ${modalPartsArray.join(', ')}</div>` 
        : `<strong>Parts:</strong> N/A<br>`;
    // -------------------------------------------------------

    // --- PHASE 2: RETURN & REDO MODAL BANNER ---
    let returnModalBanner = '';
    const returnValStr = ticket.return ? String(ticket.return).toLowerCase() : '';

    if (returnValStr.startsWith('return')) {
        returnModalBanner = `
            <div style="background-color: #d32f2f; color: white; padding: 10px; border-radius: 4px; margin-bottom: 15px; text-align: center; font-weight: bold; font-size: 16px; border: 2px solid #b71c1c;">
                ⚠️ WARNING: RETURN ORDER ⚠️<br>
                <span style="font-size: 14px; font-weight: normal;">${ticket.return}</span>
            </div>
        `;
    } else if (returnValStr.startsWith('redo')) {
        returnModalBanner = `
            <div style="background-color: #f57c00; color: white; padding: 10px; border-radius: 4px; margin-bottom: 15px; text-align: center; font-weight: bold; font-size: 16px; border: 2px solid #e65100;">
                ⚠️ WARNING: REDO ORDER ⚠️<br>
                <span style="font-size: 14px; font-weight: normal;">${ticket.return}</span>
            </div>
        `;
    }
    // ------------------------------------------

    document.getElementById('modalReadOnlyDetails').innerHTML = lockStatus.message + returnModalBanner + `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 8px;">
            <span style="color:#ffb300; font-weight: bold; font-size: 15px;">Days: ${ticket.days || 0}</span>
        </div>
        <div class="ticket-row"><span><strong>Name:</strong> ${ticket.name || 'N/A'}</span> <span>${p1}</span></div>
        <div class="ticket-row"><span><strong>Date:</strong> ${ticket.date || 'N/A'}</span> <span>${p2}</span></div>
        <div class="ticket-row" style="margin-top: 5px;"><strong>Address:</strong> ${ticket.address || 'N/A'}</div>
        <div class="ticket-row"><span><strong>Model:</strong> ${ticket.model || 'N/A'}</span> <span><strong>SN:</strong> ${ticket.serial || 'N/A'}</span></div>
        <hr style="border-color: var(--border-color); margin: 12px 0;">
        <strong>Remark:</strong> ${ticket.remark || 'N/A'}<br>
        <strong>Status Comment:</strong> ${ticket.status_comment || 'N/A'}<br>
        <strong>Status:</strong> ${ticket.status || 'N/A'}<br>
        <strong>Assigned Tech:</strong> <span style="color: #1976d2; font-weight: bold;">${ticket.assigned_tech || 'N/A'}</span><br>
        <strong>Route:</strong> ${ticket.rout || 'N/A'}<br>
        <strong>I/O:</strong> ${ticket.io || 'N/A'}<br>
        
        <!-- NEW: We replaced the old plain text parts with our dynamic purple HTML -->
        ${modalPartsHtml}
        
        <strong>Call Details:</strong> ${ticket.call_details || 'N/A'}
    `;

    // 3. ROLE-BASED UI TOGGLE
    
    // --- NEW: Universal History ---
    // Fetch the history for EVERYONE and make sure the box is visible
    document.getElementById('coordHistorySection').style.display = 'block';
    fetchAndRenderTicketHistory(ticket.so);
    
    // Reset accordion to closed state
    document.getElementById('followUpContent').style.display = 'none';
    document.getElementById('followUpArrow').textContent = '▼';
    
    // Fetch and populate the data in the background
    fetchAndRenderFollowUpHistory(ticket.so);


    if (lockStatus.isLocked) {
        // --- PHASE 4: LOCK OVERRIDE (FORCE READ-ONLY) ---
        document.getElementById('techActionSection').style.display = 'none';
        document.getElementById('confirmTechBtn').style.display = 'none';
        document.getElementById('coordActionSection').style.display = 'none';
        document.getElementById('confirmCoordBtn').style.display = 'none';
    } else if (viewMode === 'coordinator' || viewMode === 'tracking') {
        // Hide Tech Zone
        document.getElementById('techActionSection').style.display = 'none';
        document.getElementById('confirmTechBtn').style.display = 'none';
        
        // Show Coordinator Zone
        document.getElementById('coordActionSection').style.display = 'block';
        
        const confirmCoordBtn = document.getElementById('confirmCoordBtn');
        confirmCoordBtn.style.display = 'block';

        // Reset Coord Form
        document.getElementById('coordStatusSelect').value = '';
        document.getElementById('coordTechSelect').style.display = 'none';
        document.getElementById('coordTechSelect').value = '';
        document.getElementById('coordCommentInput').value = '';
        confirmCoordBtn.disabled = true;
        confirmCoordBtn.textContent = 'Confirm (Coord) 🔒';

    } else {
        // Show Tech Zone
        document.getElementById('techActionSection').style.display = 'block';
        document.getElementById('confirmTechBtn').style.display = 'block';
        
        // Hide Coordinator Zone
        document.getElementById('coordActionSection').style.display = 'none';
        document.getElementById('confirmCoordBtn').style.display = 'none';

        // Execute original Tech form reset
        collectedInput.value = '';
        mainReasonSelect.value = '';
        subReasonSelect.innerHTML = '<option value="">-- Select Sub --</option>';
        subReasonContainer.style.display = 'none';
        scheduledDateContainer.style.display = 'none'; // NEW: Hide date picker by default
        scheduledDateInput.value = ''; // NEW: Clear previous date value
        commentInput.value = '';
        document.getElementById('smartThingsCheck').checked = false;
        document.getElementById('hassCheck').checked = false;

        // Reset hidden fields
        document.getElementById('techCommentGroup').style.display = 'flex'; // ALWAYS show comment field
        
        // Force the button to be locked by default when modal opens
        confirmTechBtn.disabled = true;
        confirmTechBtn.textContent = 'Confirm 🔒';

        // Reset dynamic media staging area and session trackers
        const stagingArea = document.getElementById('mediaStagingArea');
        if (stagingArea) stagingArea.innerHTML = '';
        
        currentSessionUploads = [];
        activeUploadsCount = 0;
        
        validateTechForm();
    }

    detailsModal.style.display = 'flex';
}



//=========This code for "Remove legacy media-grid logic"=========
// Validation Logic Gate
function validateTechForm() {
    const money = parseFloat(collectedInput.value) || 0;
    const mainReason = mainReasonSelect.value;
    const subReason = subReasonSelect.value;
    
    const prefixDisplay = document.getElementById('autoPrefixDisplay'); 
    
    // Combine strings for Auto-Prefix
    let combinedReason = mainReason;
    if (subReason) combinedReason += ` - ${subReason}`;

    // --- Generate Auto-Prefix ---
    let autoPrefix = '';
    if (money > 0) {
        autoPrefix = `تم تحصيل مبلغ ${money}${combinedReason ? ' - ' + combinedReason : ''} | `;
    } else if (combinedReason) {
        autoPrefix = `${combinedReason} | `;
    }

    if (autoPrefix) {
        prefixDisplay.textContent = autoPrefix;
        prefixDisplay.style.display = 'block';
    } else {
        prefixDisplay.style.display = 'none';
    }

    // Determine if the form requirements are met
    let isReasonValid = false;
    if (mainReason !== '') {
        if (subReasonMap[mainReason]) {
            if (subReason !== '') isReasonValid = true; // Requires Sub
        } else {
            isReasonValid = true; // Does not require Sub (e.g., No Visit)
        }

        // --- NEW: Scheduled Future-Date Interceptor ---
        if (mainReason === 'Scheduled تأجيل') {
            const selectedDate = scheduledDateInput.value;
            if (!selectedDate) {
                isReasonValid = false; // Lock if empty
            } else {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const pickedDate = new Date(selectedDate);
                
                // Ensure date is strictly in the future
                if (pickedDate <= today) {
                    isReasonValid = false; 
                }
            }
        }
        // ----------------------------------------------
    }

    // 2. Unlock logic for the Confirm Button
    if (isReasonValid && activeUploadsCount === 0) {
        confirmTechBtn.disabled = false;
        confirmTechBtn.textContent = 'Confirm ✅';
    } else if (activeUploadsCount > 0) {
        confirmTechBtn.disabled = true;
        confirmTechBtn.textContent = 'Uploading... ⏳';
    } else {
        confirmTechBtn.disabled = true;
        confirmTechBtn.textContent = 'Confirm 🔒';
    }
}

// --- Dynamic Sub-List Injection & Listeners ---
mainReasonSelect.addEventListener('change', (e) => {
    const selectedMain = e.target.value;
    subReasonSelect.innerHTML = '<option value="">-- Select Sub --</option>'; 
    
    if (subReasonMap[selectedMain]) {
        subReasonMap[selectedMain].forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub;
            opt.textContent = sub;
            subReasonSelect.appendChild(opt);
        });
        subReasonContainer.style.display = 'block';
    } else {
        subReasonContainer.style.display = 'none';
    }

    // --- NEW: Toggle Schedule Date UI ---
    if (selectedMain === 'Scheduled تأجيل') {
        scheduledDateContainer.style.display = 'block';
    } else {
        scheduledDateContainer.style.display = 'none';
        scheduledDateInput.value = ''; // Reset value to clear cache
    }
    // ------------------------------------

    validateTechForm();
});

subReasonSelect.addEventListener('change', validateTechForm);
scheduledDateInput.addEventListener('change', validateTechForm); //Listen for date selection
collectedInput.addEventListener('input', validateTechForm);
commentInput.addEventListener('input', validateTechForm);


// Submit Button Action
confirmTechBtn.addEventListener('click', async () => {
    if (!activeTechTicket) return;
    // --- NEW: STRICT NUMBER VALIDATION ---
    const rawMoneyString = collectedInput.value.trim();
    
    // Check if they typed something, but it is NOT a valid number
    if (rawMoneyString !== '' && isNaN(Number(rawMoneyString))) {
        alert("SECURITY BLOCK: The 'Collected' amount must be a valid number. Please remove any letters or symbols.");
        return; 
    }
    
    // Safely convert to a true Number (defaults to 0 if left blank)
    const validatedMoney = rawMoneyString !== '' ? Number(rawMoneyString) : 0;
    
    // --- COMPILE THE FINAL COMMENT ---
    const mainReason = mainReasonSelect.value;
    const subReason = subReasonSelect.value;
    const combinedReason = subReason ? `${mainReason} - ${subReason}` : mainReason;
    const typedComment = commentInput.value.trim();
    
    let finalComment = typedComment;
    if (validatedMoney > 0) {
        finalComment = `تم تحصيل مبلغ ${validatedMoney} - ${combinedReason} | ${typedComment}`;
    } else if (combinedReason) {
        finalComment = `${combinedReason} | ${typedComment}`;
    }

    // --- REPAIR EVALUATION ENGINE ---
    const isRepaired = (mainReason === "Repair صيانة" || subReason === "Installation تركيب");
    const resolvedEndTech = isRepaired ? currentUser.username : '';

    // Replace the anchored lines with:
    // Override the collected_reason with the compounded string for database mapping
    const reasonForDb = combinedReason;

    // --- FORMAT DATE TO MM.DD.YYYY ---
    let formattedScheduledDate = '';
    if (mainReason === 'Scheduled تأجيل' && scheduledDateInput.value) {
        const parts = scheduledDateInput.value.split('-'); // HTML5 input="date" strictly outputs YYYY-MM-DD
        if (parts.length === 3) {
            formattedScheduledDate = `${parts[1]}.${parts[2]}.${parts[0]}`; // Reassemble to MM.DD.YYYY
        }
    }
    // --------------------------------------

    // Lock button to prevent double-clicks and update text to show progress
    confirmTechBtn.disabled = true;
    confirmTechBtn.textContent = 'Saving Ticket...';

    // --- PHASE 1: EVALUATION REMINDER INTERCEPT (NON-BLOCKING) ---
    if (isRepaired) {
        document.getElementById('evaluationReminderModal').style.display = 'flex';
    }
    // -------------------------------------------------------------

    // 1. Harvest dynamic JSON payloads (Files are already uploaded!)
    let newImagePayloads = [];
    let newVideoPayloads = [];
    let newCallPayloads = [];
    let offlineFiles = {}; // Staged for the future Offline Sync Engine Update

    Array.from(document.querySelectorAll('.dynamic-media-row')).forEach((row, index) => {
        const rowId = row.id;
        const type = row.dataset.type;
        const labelSelect = row.querySelector(`#sel_${rowId}`);
        const label = labelSelect && labelSelect.value !== '' ? labelSelect.value : 'اخرى';

        const uploadedItem = currentSessionUploads.find(u => u.rowId === rowId);
        
        if (uploadedItem) {
            const payload = { url: uploadedItem.url, label: label, uploader: currentUser.username };
            if (type === 'image') newImagePayloads.push(payload);
            else if (type === 'video') newVideoPayloads.push(payload);
            else if (type === 'call') newCallPayloads.push(payload);
        } else {
            // Track un-uploaded files for offline packaging
            const fileInput = row.querySelector(`#file_${rowId}`);
            if (fileInput && fileInput.files.length > 0) {
                offlineFiles[`dynamic_${type}_${index}`] = { file: fileInput.files[0], label: label, type: type };
            }
        }
    });

    // 2. Prepare the visual checklist box
    const progressBox = document.getElementById('uploadProgressContainer');
    progressBox.style.display = 'flex';
    progressBox.style.flexDirection = 'column';
    progressBox.innerHTML = ''; // Wipe clean from previous tickets

    // Helper function to draw or update a line on the screen
    function setProgressLine(id, text, isFinished = false) {
        let line = document.getElementById(id);
        if (!line) {
            line = document.createElement('div');
            line.id = id;
            line.style.margin = '4px 0';
            progressBox.appendChild(line);
        }
        line.innerHTML = isFinished ? `✅ ${text}` : `⏳ ${text}...`;
    }

    // --- 3. NEW: PHASE 4 OFFLINE INTERCEPTOR ---
    if (!navigator.onLine) {
        setProgressLine('step-offline', 'No internet detected. Packaging data...');
        
        // Get current exact time
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');

        // Build the text payload (without URLs)
        const textData = {
            so: activeTechTicket.so,
            status: 'back_office',
            assigned_by: currentUser.username,
            end_tech: resolvedEndTech, // <-- INJECTED REPAIR FLAG
            assign_date: `${dd}-${mm}-${yyyy}`,
            assign_time: `${hh}:${min}`,
            smart_things: document.getElementById('smartThingsCheck').checked ? 'yes' : '',
            hass: document.getElementById('hassCheck').checked ? 'yes' : '',
            collected: validatedMoney,
            collected_reason: reasonForDb || '',
            comment: finalComment,
            scheduled_date: formattedScheduledDate, // NEW: Offline Vault Payload
            // Preserve legacy media state for the sync engine JSON compiler
            img1: activeTechTicket.img1,
            calls: activeTechTicket.calls,
            location_link: activeTechTicket.location_link,
            vid1: activeTechTicket.vid1,
            arrived_at: activeTechTicket.arrived_at,
            left_at: activeTechTicket.left_at
        };

        // Package the raw File objects and text into one bundle
        const offlineBundle = {
            so: activeTechTicket.so,
            timestamp: Date.now(), // Helps us upload the oldest tickets first later
            textData: textData,
            files: offlineFiles // Passed to the Offline Sync Engine
        };

        if (localDB) {
            // Open BOTH tables so we can move the ticket from "To Do" to "Done"
            const transaction = localDB.transaction(['outbox', 'inbox'], 'readwrite');
            const outboxStore = transaction.objectStore('outbox');
            const inboxStore = transaction.objectStore('inbox');

            // 1. Drop the bundle into the outbox
            outboxStore.put(offlineBundle);

            // 2. Remove the ticket from the local inbox so it visually disappears from the screen!
            const inboxReq = inboxStore.get('latest_tickets');
            inboxReq.onsuccess = function() {
                if (inboxReq.result && inboxReq.result.tickets) {
                    const remainingTickets = inboxReq.result.tickets.filter(t => String(t.so) !== String(activeTechTicket.so));
                    inboxStore.put({ id: 'latest_tickets', tickets: remainingTickets });
                }
            };

            // 3. When the database finishes saving...
            transaction.oncomplete = function() {
                setProgressLine('step-offline', 'Safely stored in Offline Vault!', true);
                alert("You are offline. Ticket saved to local Vault! Please sync when you regain connection.");
                
                detailsModal.style.display = 'none';
                document.querySelectorAll('.media-grid input[type="file"]').forEach(input => input.value = '');
                
                // --- PHASE 4: RELEASE LOCK ---
                releaseTicketLock(activeTechTicket.so);
                
                loadActiveTickets(); // Redraws the UI (the ticket is now gone!)
            };
        }
        return; // CRITICAL: Stop the function here so it doesn't try to upload to Supabase!
    }
    // -------------------------------------------


    // --- 4. JSON METADATA CONCATENATION ---
    const parseLegacyMedia = (mediaString, baseLabel) => {
        if (!mediaString || mediaString.trim() === '') return [];
        if (mediaString.trim().startsWith('[')) {
            try { return JSON.parse(mediaString); } catch(e) { return []; }
        }
        return [{ url: mediaString, label: `Legacy ${baseLabel}`, uploader: 'System' }];
    };

    const finalImageArray = [...parseLegacyMedia(activeTechTicket.img1, 'Image'), ...newImagePayloads];
    const finalVideoArray = [...parseLegacyMedia(activeTechTicket.vid1, 'Video'), ...newVideoPayloads];
    const finalCallArray = [...parseLegacyMedia(activeTechTicket.calls, 'Call Record'), ...newCallPayloads];

    const finalImg1Str = finalImageArray.length > 0 ? JSON.stringify(finalImageArray) : '';
    const finalVid1Str = finalVideoArray.length > 0 ? JSON.stringify(finalVideoArray) : '';
    const finalCallsStr = finalCallArray.length > 0 ? JSON.stringify(finalCallArray) : '';
    setProgressLine('step-db', 'Saving text to database');

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    
    const logPayload = {
        so: activeTechTicket.so,
        status: 'back_office',
        assigned_by: currentUser.username,
        end_tech: resolvedEndTech, // <-- INJECTED REPAIR FLAG
        assign_date: `${dd}-${mm}-${yyyy}`,
        assign_time: `${hh}:${min}`,
        smart_things: document.getElementById('smartThingsCheck').checked ? 'yes' : '',
        hass: document.getElementById('hassCheck').checked ? 'yes' : '',
        collected: validatedMoney,
        collected_reason: reasonForDb || '',
        comment: finalComment,
        scheduled_date: formattedScheduledDate, // NEW: repair_log Payload
        
        // Consolidated JSON payloads target img1, vid1, and calls exclusively
        img1: finalImg1Str, 
        calls: finalCallsStr, 
        location_link: activeTechTicket.location_link,
        vid1: finalVid1Str, 
        arrived_at: activeTechTicket.arrived_at, 
        left_at: activeTechTicket.left_at
    };

    const { error: logErr } = await supabaseClient.from('repair_log').insert(logPayload);
    if (logErr) {
        alert("Sync Failed (Logs): " + logErr.message);
        validateTechForm(); 
        return;
    }

    const { error: orderErr } = await supabaseClient
        .from('orders')
        .update({ 
            status: 'back_office',
            complete_tech: resolvedEndTech, // <-- INJECTED REPAIR FLAG
            // Consolidated JSON payloads target img1, vid1, and calls exclusively
            img1: finalImg1Str,
            calls: finalCallsStr, 
            location_link: activeTechTicket.location_link,
            vid1: finalVid1Str, 
            arrived_at: activeTechTicket.arrived_at, 
            left_at: activeTechTicket.left_at,
            // --- NEW: Wipe visit sequence upon taking action ---
            visit_sequence: null,
            scheduled_date: formattedScheduledDate // NEW: orders Payload
            // ---------------------------------------------------
        })
        .eq('so', activeTechTicket.so);

    if (orderErr) {
        alert("Sync Failed (Orders): " + orderErr.message);
        validateTechForm(); 
        return;
    }

    alert("Ticket Successfully Submitted with Media!");
    detailsModal.style.display = 'none';
    document.querySelectorAll('.media-grid input[type="file"]').forEach(input => input.value = '');
    
    // --- PHASE 4: RELEASE LOCK ---
    releaseTicketLock(activeTechTicket.so);
    
    loadActiveTickets();
});


// --- COORDINATOR MODAL LOGIC ---
const coordStatusSelect = document.getElementById('coordStatusSelect');
const confirmCoordBtn = document.getElementById('confirmCoordBtn');
const coordTechSelect = document.getElementById('coordTechSelect');

// New Validation Gate
function validateCoordForm() {
    const status = coordStatusSelect.value;
    const tech = coordTechSelect.value;
    
    // --- NEW: Grab the comment text ---
    const coordComment = document.getElementById('coordCommentInput').value.trim();
    
    let isValid = false;
    
    if (status === 'Re-Assign') {
        coordTechSelect.style.display = 'block'; // Show tech list
        // Require BOTH a technician and a comment
        if (tech !== '' && coordComment !== '') isValid = true;         
    } else if (status !== '') {
        coordTechSelect.style.display = 'none';  // Hide tech list
        // Require a comment for all other statuses
        if (coordComment !== '') isValid = true;
    } else {
        coordTechSelect.style.display = 'none';
    }

    if (isValid) {
        confirmCoordBtn.disabled = false;
        confirmCoordBtn.textContent = 'Confirm Action ✅';
    } else {
        confirmCoordBtn.disabled = true;
        confirmCoordBtn.textContent = 'Confirm (Coord) 🔒';
    }
}

// Unlock button when a status is chosen and fetch technicians if needed
coordStatusSelect.addEventListener('change', async (e) => {
    if (e.target.value === 'Re-Assign' && coordTechSelect.children.length <= 1) {
        // Fetch technicians if the list hasn't been built yet
        if (availableTechnicians.length === 0) {
            const { data, error } = await supabaseClient
                .from('profiles')
                .select('username')
                .or('role.ilike.%technician%,role.ilike.%supervisor%');
            
            if (data && !error) {
                availableTechnicians = data.map(d => d.username);
            }
        }
        
        // Populate the dropdown
        coordTechSelect.innerHTML = '<option value="">-- Select Technician --</option>';
        availableTechnicians.forEach(tech => {
            const opt = document.createElement('option');
            opt.value = tech;
            opt.textContent = tech;
            coordTechSelect.appendChild(opt);
        });
    }
    validateCoordForm();
});

coordTechSelect.addEventListener('change', validateCoordForm);
// Trigger validation every time they type in the comment box
document.getElementById('coordCommentInput').addEventListener('input', validateCoordForm);

// Submit Coord Changes
confirmCoordBtn.addEventListener('click', async () => {
    if (!activeTechTicket || !coordStatusSelect.value) return;

    // Lock button to prevent double-clicks
    confirmCoordBtn.disabled = true;
    confirmCoordBtn.textContent = 'Processing...';

    let newStatus = coordStatusSelect.value;
    const selectedTech = coordTechSelect.value;
    
    // --- NEW: Grab the comment ---
    const coordComment = document.getElementById('coordCommentInput').value.trim();
    
    // Calculate timestamp
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');

    // --- NEW: RE-ASSIGN ROUTING LOGIC ---
    // Calculate the final status and assigned tech before saving to the database
    let finalOrderStatus = newStatus;
    let finalAssignedTech = activeTechTicket.assigned_tech || ''; // Keep existing unless changed

    if (newStatus === 'Re-Assign') {
        finalOrderStatus = 'Technician'; // Push it live to the technician's phone
        finalAssignedTech = selectedTech; // Assign the selected user
    } else if (newStatus === 'Complete' || newStatus === 'Cancel') {
        finalAssignedTech = ''; // Wipe the technician clean for completed/cancelled tickets
    }

    // 1. Log the action in repair_log
    const previousTech = activeTechTicket.assigned_tech || ''; // Capture before wiping
    
    const logPayload = {
        so: activeTechTicket.so,
        status: finalOrderStatus, 
        assigned_by: currentUser.username, 
        assigned_tech: finalAssignedTech,
        end_tech: newStatus === 'Complete' ? previousTech : '',
        complete_coord: newStatus === 'Complete' ? currentUser.username : '',
        comment: coordComment, // <-- Push the Back Office comment to the history log!
        assign_date: `${dd}-${mm}-${yyyy}`,
        assign_time: `${hh}:${min}`
    };

    const { error: logErr } = await supabaseClient.from('repair_log').insert(logPayload);
    
    if (logErr) {
        alert("Action failed (Log Error): " + logErr.message);
        confirmCoordBtn.disabled = false;
        confirmCoordBtn.textContent = 'Confirm Action ✅';
        return;
    }

    // 2. Update the main orders table
    const orderUpdatePayload = { 
        status: finalOrderStatus,
        assigned_tech: finalAssignedTech,
        visit_sequence: null // --- Wipe visit sequence upon taking action ---
    };

    // --- Intercept 'Complete' and 'Cancel' to purge scheduled date ---
    if (newStatus === 'Complete' || newStatus === 'Cancel') {
        orderUpdatePayload.scheduled_date = '';
    }
    // ----------------------------------------------------------------------

    if (newStatus === 'Complete') {
        orderUpdatePayload.complete_tech = previousTech;
        orderUpdatePayload.complete_coord = currentUser.username;
    }

    const { error: orderErr } = await supabaseClient
        .from('orders')
        .update(orderUpdatePayload)
        .eq('so', activeTechTicket.so);

    if (orderErr) {
        alert("Action failed (Order Update Error): " + orderErr.message);
        confirmCoordBtn.disabled = false;
        confirmCoordBtn.textContent = 'Confirm Action ✅';
        return;
    }

    // TRIGGER CALL CENTER
    if (newStatus === 'Complete' && typeof window.pushToCCQueue === 'function') {
        window.pushToCCQueue([activeTechTicket.so], 'qa_complete');
    }

    alert(`Success: Order ${activeTechTicket.so} has been updated!`);
    
    // Close modal and refresh the list (ticket vanishes because status is no longer back_office)
    detailsModal.style.display = 'none';
    
    // --- PHASE 4: RELEASE LOCK ---
    releaseTicketLock(activeTechTicket.so);
    
    // --- PHASE 2: CONTEXT-AWARE REFRESH ---
    // Detect which screen the user is currently on and reload the appropriate dataset
    if (document.getElementById('systemPage').classList.contains('active')) {
        if (typeof loadDatabaseData === 'function') loadDatabaseData();
    } else {
        if (typeof loadActiveTickets === 'function') loadActiveTickets(); 
    }
});


// --- MEDIA UPLOAD ENGINE ---

/**
 * Uploads a file to Supabase Storage and returns the public URL with a retry mechanic.
 * @param {File} fileObject - The actual image or video file from the input.
 * @param {string} soNumber - The Service Order number (used to organize files).
 * @param {string} fileTypeLabel - E.g., 'img1' or 'vid1' to keep names unique.
 * @param {number} retries - How many times to attempt the upload before failing.
 */
/**
 * Uploads a file to Supabase Storage with a LIVE Visual Progress Bar & Retry Mechanic.
 */
async function uploadMediaToSupabase(fileObject, soNumber, fileTypeLabel, retries = 3) {
    // 1. Safety check
    if (!fileObject) return '';

    let finalFile = fileObject;
    let fileExtension = finalFile.name.split('.').pop().toLowerCase();
    const progressLine = document.getElementById(`step-${fileTypeLabel}`);

    // --- NEW: AUTO HEIC TO JPG CONVERTER ---
    if (fileExtension === 'heic' || fileExtension === 'heif') {
        if (progressLine) progressLine.innerHTML = `⏳ Converting ${fileTypeLabel} from Apple HEIC to JPG...`;
        try {
            // Process the conversion
            const convertedBlob = await heic2any({ blob: finalFile, toType: "image/jpeg", quality: 0.8 });
            const blobToUse = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
            
            // Re-package it as a standard JPG file
            const newName = finalFile.name.replace(/\.heic|\.heif/gi, ".jpg");
            finalFile = new File([blobToUse], newName, { type: "image/jpeg" });
            fileExtension = 'jpg';
        } catch (err) {
            console.error("HEIC conversion failed:", err);
            // If it fails, we just continue and try to upload the original HEIC anyway
        }
    }

    // 2. Build Date & Time strings
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');

    const formattedDate = `${dd}-${mm}-${yyyy}`;
    const formattedTime = `${hh}-${min}`;

    // 3. Create the requested file name (USING finalFile instead of fileObject!)
    const uniqueFileName = `${soNumber}_${fileTypeLabel}_${formattedDate}_${formattedTime}.${fileExtension}`;
    


    // 4. Retry Loop Mechanic
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            if (attempt > 1 && progressLine) {
                progressLine.innerHTML = `⚠️ Retrying network connection... (Attempt ${attempt} of ${retries})`;
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
            }

            // --- THE NEW "SPEEDOMETER" UPLOAD ENGINE ---
            // We use a Promise so it waits to finish before moving to the next video
            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                
                // We construct the direct Supabase API URL using your global variables
                const url = `${SUPABASE_URL}/storage/v1/object/repair_media/${uniqueFileName}`;

                // This event fires constantly as data is pushed through the network!
                xhr.upload.addEventListener("progress", (event) => {
                    // DEBUG: Print exactly what the browser sees to the F12 Console
                    console.log("Upload Progress Fired ->", "Loaded:", event.loaded, "Total:", event.total, "Computable:", event.lengthComputable);

                    if (progressLine) {
                        // If the browser knows the total file size, do the math
                        if (event.lengthComputable && event.total > 0) {
                            const percent = Math.round((event.loaded / event.total) * 100);
                            const loadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
                            const totalMB = (event.total / (1024 * 1024)).toFixed(1);
                            
                            progressLine.innerHTML = `
                                <div style="margin-bottom: 4px; font-size: 13px;">
                                    ⏳ Uploading ${fileTypeLabel}... <strong style="color: #2e7d32;">${percent}%</strong> 
                                    <span style="opacity: 0.7; font-size: 11px;">(${loadedMB} MB / ${totalMB} MB)</span>
                                </div>
                                <div style="width: 100%; background: var(--border-color); border-radius: 4px; overflow: hidden; height: 12px;">
                                    <div style="width: ${percent}%; background: #2e7d32; height: 100%; transition: width 0.2s;"></div>
                                </div>
                            `;
                        } else {
                            // FALLBACK: If the browser is struggling to do the math, just show the MBs moving
                            const loadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
                            progressLine.innerHTML = `
                                <div style="margin-bottom: 4px; font-size: 13px;">
                                    ⏳ Uploading ${fileTypeLabel}... <strong style="color: #f57c00;">Streaming data...</strong> 
                                    <span style="opacity: 0.7; font-size: 11px;">(${loadedMB} MB pushed)</span>
                                </div>
                            `;
                        }
                    }
                });

                // When the upload finishes successfully
                xhr.addEventListener("load", () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(); // Tell the code to continue!
                    } else {
                        reject(new Error(`Server rejected the file: ${xhr.responseText}`));
                    }
                });

                // If the internet completely drops
                xhr.addEventListener("error", () => {
                    reject(new Error("Network connection dropped."));
                });

                // Open the connection and attach your specific Supabase Keys
                xhr.open("POST", url, true);
                xhr.setRequestHeader("Authorization", `Bearer ${SUPABASE_KEY}`);
                xhr.setRequestHeader("apikey", SUPABASE_KEY);
                xhr.setRequestHeader("Content-Type", fileObject.type);
                //(This follwing line tells Supabase: "If this file already exists from a broken previous attempt, just overwrite it instead of throwing an error.")
                xhr.setRequestHeader("x-upsert", "true"); 
                
                // Send the file!
                xhr.send(finalFile);
            });
            // --- END NEW ENGINE ---

            // 5. If upload succeeds, ask Supabase for the direct public web link
            const { data: publicUrlData } = supabaseClient
                .storage
                .from('repair_media')
                .getPublicUrl(uniqueFileName);

            return publicUrlData.publicUrl;

        } catch (err) {
            console.warn(`Upload failed for ${fileTypeLabel} (Attempt ${attempt}/${retries}):`, err);
            if (progressLine) {
                progressLine.innerHTML = `<span style="color: #d32f2f; font-size: 13px;">⚠️ Attempt ${attempt} failed: ${err.message}. Retrying...</span>`;
            }
            
            if (attempt === retries) {
                alert(`Upload completely failed for ${fileTypeLabel} after ${retries} attempts: ` + err.message);
                return ''; 
            }
        }
    }
}

// ==========================================
// --- PHASE 5: OFFLINE SYNC ENGINE ---
// ==========================================

const offlineSyncBanner = document.getElementById('offlineSyncBanner');
const syncCountText = document.getElementById('syncCountText');

// 1. Check the vault and update the banner
window.checkOfflineVault = function() {
    if (!localDB) return;
    const transaction = localDB.transaction('outbox', 'readonly');
    const store = transaction.objectStore('outbox');
    const countRequest = store.count();

    countRequest.onsuccess = function() {
        if (countRequest.result > 0) {
            syncCountText.textContent = countRequest.result;
            offlineSyncBanner.style.display = 'block';
        } else {
            offlineSyncBanner.style.display = 'none';
        }
    };
};

// 2. The Sync Process
offlineSyncBanner.addEventListener('click', async () => {
    // Safety check: Don't let them try to sync if they are still offline!
    if (!navigator.onLine) {
        alert("You are still offline! Please connect to Wi-Fi or Mobile Data to sync.");
        return;
    }

    // Lock the banner so they can't click it twice
    offlineSyncBanner.innerHTML = "⏳ Syncing Data... Please leave the app open.";
    offlineSyncBanner.style.backgroundColor = "#f57c00"; // Orange to show it's working
    offlineSyncBanner.style.pointerEvents = "none"; 

    // Pull all saved bundles from the vault
    const transaction = localDB.transaction('outbox', 'readonly');
    const store = transaction.objectStore('outbox');
    const request = store.getAll();

    request.onsuccess = async function() {
        const pendingOrders = request.result;

        // Loop through each ticket one by one
        for (const bundle of pendingOrders) {
            console.log(`Syncing offline SO: ${bundle.so}...`);

            // A. Iterate dynamic offline files and upload sequentially
            let newImagePayloads = [];
            let newVideoPayloads = [];
            let newCallPayloads = [];

            for (const [key, fileData] of Object.entries(bundle.files)) {
                // fileData contains { file: File, label: string, type: string }
                const url = await uploadMediaToSupabase(fileData.file, bundle.so, key);
                if (url) {
                    const payload = { url: url, label: fileData.label, uploader: bundle.textData.assigned_by };
                    if (fileData.type === 'image') newImagePayloads.push(payload);
                    else if (fileData.type === 'video') newVideoPayloads.push(payload);
                    else if (fileData.type === 'call') newCallPayloads.push(payload);
                }
            }

            // B. JSON Compilation
            const parseLegacyMedia = (mediaString, baseLabel) => {
                if (!mediaString || mediaString.trim() === '') return [];
                if (mediaString.trim().startsWith('[')) {
                    try { return JSON.parse(mediaString); } catch(e) { return []; }
                }
                return [{ url: mediaString, label: `Legacy ${baseLabel}`, uploader: 'System' }];
            };

            const finalImageArray = [...parseLegacyMedia(bundle.textData.img1, 'Image'), ...newImagePayloads];
            const finalVideoArray = [...parseLegacyMedia(bundle.textData.vid1, 'Video'), ...newVideoPayloads];
            const finalCallArray  = [...parseLegacyMedia(bundle.textData.calls, 'Call Record'), ...newCallPayloads];

            const finalImg1Str = finalImageArray.length > 0 ? JSON.stringify(finalImageArray) : '';
            const finalVid1Str = finalVideoArray.length > 0 ? JSON.stringify(finalVideoArray) : '';
            const finalCallsStr = finalCallArray.length > 0 ? JSON.stringify(finalCallArray) : '';

            // C. Attach the compiled JSON payloads to the text data
            const finalLogPayload = {
                ...bundle.textData,
                img1: finalImg1Str, 
                calls: finalCallsStr, 
                location_link: bundle.textData.location_link,
                vid1: finalVid1Str, 
                arrived_at: bundle.textData.arrived_at, 
                left_at: bundle.textData.left_at
            };

            // D. Push the combined data to the repair_log table
            const { error: logErr } = await supabaseClient.from('repair_log').insert(finalLogPayload);
            if (logErr) {
                console.error("Failed to sync log for " + bundle.so, logErr);
                continue; // Skip deleting this ticket so we can try syncing it again later!
            }

            //=========This code for "Fix Offline Sync to push complete_tech safely"=========
            // E. Push the status change to the orders table
            const { error: orderErr } = await supabaseClient.from('orders')
                .update({ 
                    status: 'back_office',
                    complete_tech: bundle.textData.end_tech, // <-- Fix: Inject complete_tech
                    img1: finalImg1Str, 
                    calls: finalCallsStr, 
                    location_link: bundle.textData.location_link,
                    vid1: finalVid1Str, 
                    arrived_at: bundle.textData.arrived_at, 
                    left_at: bundle.textData.left_at,
                    visit_sequence: null // Ensure sequence resets on action
                })
                .eq('so', bundle.so);

            // E. SUCCESS! Remove this ticket from the offline vault to free up phone storage
            if (!orderErr) {
                const deleteTx = localDB.transaction('outbox', 'readwrite');
                deleteTx.objectStore('outbox').delete(bundle.so);
            }
        }

        // Clean up UI when the loop is totally finished
        alert("✅ All offline tickets have been successfully synced to the database!");
        
        // Reset banner styling
        offlineSyncBanner.innerHTML = '⚠️ <span id="syncCountText">0</span> Orders Pending Offline Sync. Click here to sync now!';
        offlineSyncBanner.style.backgroundColor = "#d32f2f"; 
        offlineSyncBanner.style.pointerEvents = "auto";
        
        // This will hide the banner if all tickets cleared successfully
        checkOfflineVault(); 
    };
});


// --- WIPE ALL MEDIA BUTTON LOGIC ---
document.getElementById('btnWipeMedia').addEventListener('click', async () => {
    // 1. Strict confirmation to prevent accidents
    if (!confirm("⚠️ WARNING: This will permanently delete ALL media (images and videos) from the database bucket. This cannot be undone. Proceed?")) {
        return;
    }

    showGlobalLoader("Wiping all media...");
    
    // 2. Fetch the list of all files in the repair_media bucket
    // We set a high limit to ensure it grabs everything
    const { data: files, error: listError } = await supabaseClient
        .storage
        .from('repair_media')
        .list('', { limit: 5000 });
    
    if (listError) {
        hideGlobalLoader();
        alert("Error finding files: " + listError.message);
        return;
    }

    if (!files || files.length === 0) {
        hideGlobalLoader();
        alert("The media bucket is already empty.");
        return;
    }

    // 3. Extract just the file names and delete them
    const fileNames = files.map(file => file.name);
    const { error: deleteError } = await supabaseClient.storage.from('repair_media').remove(fileNames);

    hideGlobalLoader();

    if (deleteError) {
        alert("Failed to delete media: " + deleteError.message);
    } else {
        alert(`Successfully deleted ${fileNames.length} media files.`);
    }
});

// --- DOWNLOAD ALL MEDIA BUTTON LOGIC (ZIP BUNDLE WITH PROGRESS BAR) ---
document.getElementById('btnDownloadMedia').addEventListener('click', async () => {
    // 1. Confirm with the user
    if (!confirm("This will securely package all media into a single Zip file. Continue?")) {
        return;
    }

    // 2. Trigger the global loader overlay but inject custom Progress Bar HTML
    showGlobalLoader(""); // Opens the black overlay
    const loaderText = document.getElementById('loaderText');
    
    // Build the visual progress bar right inside the loading screen
    loaderText.innerHTML = `
        <div id="zipPhaseText" style="margin-bottom: 10px; font-size: 16px;">Preparing to download...</div>
        <div style="width: 300px; background: rgba(255, 255, 255, 0.2); border-radius: 4px; overflow: hidden; height: 18px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.4);">
            <div id="zipProgressBar" style="width: 0%; background: #4caf50; height: 100%; transition: width 0.2s;"></div>
        </div>
        <div id="zipPercentText" style="margin-top: 8px; font-size: 14px; font-weight: normal;">0%</div>
    `;

    const phaseText = document.getElementById('zipPhaseText');
    const progressBar = document.getElementById('zipProgressBar');
    const percentText = document.getElementById('zipPercentText');

    // 3. Fetch the list of all files in the bucket
    const { data: files, error: listError } = await supabaseClient
        .storage
        .from('repair_media')
        .list('', { limit: 5000 });

    if (listError || !files || files.length === 0) {
        hideGlobalLoader();
        alert(listError ? "Error finding files: " + listError.message : "No media found to download.");
        return;
    }

    // Filter out the background placeholder file
    const validFiles = files.filter(f => f.name !== '.emptyFolderPlaceholder');
    const totalFiles = validFiles.length;

    const zip = new JSZip();
    const folder = zip.folder("KE_Media_Backup");

    // 4. PHASE 1: Download files from Supabase into memory
    phaseText.textContent = `Step 1 of 2: Downloading files from server...`;
    
    for (let i = 0; i < totalFiles; i++) {
        const file = validFiles[i];
        const { data: fileBlob, error: downloadErr } = await supabaseClient
            .storage
            .from('repair_media')
            .download(file.name);
        
        if (!downloadErr && fileBlob) {
            folder.file(file.name, fileBlob);
        }

        // Math: Make the downloading phase represent the first 50% of the bar
        const phasePercent = Math.round(((i + 1) / totalFiles) * 50);
        progressBar.style.width = phasePercent + '%';
        percentText.textContent = `Downloaded ${i + 1} of ${totalFiles}`;
    }

    // 5. PHASE 2: Generate the final Zip file and track compression progress
    phaseText.textContent = `Step 2 of 2: Compressing files into Zip...`;
    
    // JSZip has a built-in progress tracker we can listen to
    zip.generateAsync({ type: "blob" }, function updateCallback(metadata) {
        
        // metadata.percent tracks from 0 to 100 for the zip process. 
        // We divide by 2 and add 50 so it fills the second half of our progress bar.
        const totalPercent = 50 + Math.round(metadata.percent / 2);
        
        progressBar.style.width = totalPercent + '%';
        percentText.textContent = `Zipping: ${Math.round(metadata.percent)}%`;
        
    }).then(function(zipContent) {
        
        // 6. Finish up and trigger browser download
        hideGlobalLoader();
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipContent);
        link.download = `Media_Backup_${new Date().getTime()}.zip`; 
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
    }).catch(function(err) {
        hideGlobalLoader();
        alert("An error occurred while zipping the files: " + err.message);
    });
});




// --- COLUMN RESIZING ENGINE ---
function applyResizableColumns(tableId, storageKey) {
    const table = document.getElementById(tableId);
    if (!table) return;
    
    const headers = table.querySelectorAll('thead tr:first-child th');
    
    // Load previously saved widths for this specific user
    const userStorageKey = `${storageKey}_${currentUser ? currentUser.username : 'guest'}`;
    const savedWidths = JSON.parse(localStorage.getItem(userStorageKey) || '{}');

    headers.forEach((th, index) => {
        // Prevent adding multiple handles if re-rendered
        if (th.querySelector('.resizer')) return;

        // Use the text content as a unique key (e.g., 'SO', 'assigned_tech')
        const colKey = th.textContent.trim() || `col_${index}`;

        // Apply saved width if it exists
        if (savedWidths[colKey]) {
            th.style.width = savedWidths[colKey];
        } else if (!th.style.width) {
            // Default width if none exists
            th.style.width = '120px'; 
        }

        const resizer = document.createElement('div');
        resizer.classList.add('resizer');
        th.appendChild(resizer);

        let startX, startWidth;

        resizer.addEventListener('mousedown', (e) => {
            startX = e.pageX;
            startWidth = th.offsetWidth;
            resizer.classList.add('resizing');

            const mouseMoveHandler = (e) => {
                const newWidth = Math.max(30, startWidth + (e.pageX - startX)); // 30px minimum width
                th.style.width = `${newWidth}px`;
            };

            const mouseUpHandler = () => {
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
                resizer.classList.remove('resizing');

                // Save to local storage on release
                savedWidths[colKey] = th.style.width;
                localStorage.setItem(userStorageKey, JSON.stringify(savedWidths));
            };

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });
    });
}

// ==========================================
// --- PHASE 1: EXCEL DATA-ENTRY ENGINE ---
// ==========================================

let isSelecting = false;
let selectedInputs = new Set();

// Mouse selection tracking
document.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.closest('td')) {
        isSelecting = true;
        selectedInputs.forEach(input => input.classList.remove('selected-cell'));
        selectedInputs.clear();
        e.target.classList.add('selected-cell');
        selectedInputs.add(e.target);
    } else {
        // Clear selection if clicking outside
        selectedInputs.forEach(input => input.classList.remove('selected-cell'));
        selectedInputs.clear();
    }
});

document.addEventListener('mouseover', (e) => {
    if (isSelecting && e.target.tagName === 'INPUT' && e.target.closest('td')) {
        e.target.classList.add('selected-cell');
        selectedInputs.add(e.target);
    }
});

document.addEventListener('mouseup', () => {
    isSelecting = false;
});

// Paste Interceptor
document.addEventListener('paste', (e) => {
    const targetInput = e.target;
    if (targetInput.tagName !== 'INPUT' || !targetInput.closest('td')) return;

    const pasteData = (e.clipboardData || window.clipboardData).getData('text');
    
    // SCENARIO A: Mass Fill (Multiple highlighted cells + Single word pasted)
    const isSingleWord = !pasteData.includes('\n') && !pasteData.includes('\t');
    if (selectedInputs.size > 1 && isSingleWord) {
        e.preventDefault();
        selectedInputs.forEach(input => {
            input.value = pasteData;
            input.dispatchEvent(new Event('input', { bubbles: true })); // Trigger staging memory
        });
        return;
    }

    // SCENARIO B: Column Auto-Flow (Pasting multiple rows of data from Excel)
    if (pasteData.includes('\n')) {
        e.preventDefault();
        const rowsToPaste = pasteData.split(/\r?\n/).filter(r => r !== ''); // Clean empty trailing rows
        
        const startTd = targetInput.closest('td');
        const startTr = startTd.closest('tr');
        const cellIndex = Array.from(startTr.children).indexOf(startTd);
        
        let currentRow = startTr;
        
        rowsToPaste.forEach(pastedValue => {
            if (currentRow) {
                const targetCell = currentRow.children[cellIndex];
                if (targetCell) {
                    const inputField = targetCell.querySelector('input');
                    if (inputField) {
                        inputField.value = pastedValue.trim();
                        inputField.dispatchEvent(new Event('input', { bubbles: true })); // Trigger memory
                    }
                }
                currentRow = currentRow.nextElementSibling; // Move to the row below
            }
        });
    }
});

// ==========================================
// --- PHASE 2: CLICK-TO-MOVE ARROWS ---
// ==========================================

function attachClickMoveLogic(headerRowId, colArray, storageKey, renderCallback) {
    const headerRow = document.getElementById(headerRowId);
    const headers = Array.from(headerRow.querySelectorAll('th')); 
    const skipCount = (headerRowId === 'headerRow' || headerRowId === 'assignHeaderRow') ? 2 : 0; // Skip number and checkbox column
    
    headers.slice(skipCount).forEach((th, i) => {
        const index = i; // Map to the exact array index
        const leftBtn = th.querySelector('.left-arrow');
        const rightBtn = th.querySelector('.right-arrow');
        
        if (!leftBtn || !rightBtn) return;

        th.addEventListener('click', (e) => {
            // Ignore clicks on inner elements so sorting and resizing still work normally
            if (e.target.classList.contains('sort-header') || e.target.classList.contains('delete-col-btn') || e.target.classList.contains('move-arrow') || e.target.classList.contains('resizer')) {
                return; 
            }

            const isActive = th.classList.contains('move-active');

            // Turn off all other headers
            document.querySelectorAll('.move-arrow').forEach(btn => btn.style.display = 'none');
            document.querySelectorAll('th.move-active').forEach(activeTh => activeTh.classList.remove('move-active'));

            // Turn this one on if it wasn't already open
            if (!isActive) {
                th.classList.add('move-active');
                leftBtn.style.display = 'inline-block';
                rightBtn.style.display = 'inline-block';
            }
        });

        leftBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (index > 0) {
                const temp = colArray[index];
                colArray[index] = colArray[index - 1];
                colArray[index - 1] = temp;
                saveAndRender();
            }
        });

        rightBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (index < colArray.length - 1) {
                const temp = colArray[index];
                colArray[index] = colArray[index + 1];
                colArray[index + 1] = temp;
                saveAndRender();
            }
        });

        function saveAndRender() {
            const userKey = currentUser ? currentUser.username : 'guest';
            localStorage.setItem(storageKey + '_' + userKey, JSON.stringify(colArray));
            renderCallback();
        }
    });
}

// Global click to dismiss the arrows if you click outside the headers
document.addEventListener('click', (e) => {
    if (!e.target.closest('th')) {
        document.querySelectorAll('.move-arrow').forEach(btn => btn.style.display = 'none');
        document.querySelectorAll('th.move-active').forEach(activeTh => activeTh.classList.remove('move-active'));
    }
});



// Bind System Export
document.getElementById('btnDownloadVisibleSystem').addEventListener('click', () => {
    downloadGroupedVisibleText('tableBody', editedOrders, ALL_COLUMNS, 'System_Visible_Export');
});

// --- EXCEL EXPORT FOR SYSTEM PAGE ---
document.getElementById('btnDownloadExcelSystem').addEventListener('click', () => {
    const tableBody = document.getElementById('tableBody');
    if (!tableBody || tableBody.children.length === 0) {
        alert("No visible data to export.");
        return;
    }

    // 2. Gather visible SOs from the DOM
    const visibleSOs = Array.from(tableBody.querySelectorAll('tr')).map(tr => {
        const soInput = Array.from(tr.querySelectorAll('input')).find(inp => inp.readOnly === true && inp.style.fontWeight === '900');
        if (soInput) return soInput.value;
        return null;
    }).filter(val => val !== null);

    if (visibleSOs.length === 0) {
        alert("No valid orders found to export.");
        return;
    }

    showGlobalLoader("Generating Excel File...");

    // 3. Reconstruct the data matching the exact columns currently visible on screen
    const excelData = visibleSOs.map(so => {
        const rowData = editedOrders[so] || databaseOrders.find(o => String(o.so) === String(so)) || {};
        let cleanRow = {};
        
        activeColumns.forEach(col => {
            cleanRow[col] = rowData[col] || '';
        });
        
        return cleanRow;
    });

    // 4. Generate and download the Excel file using SheetJS
    try {
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Visible_Orders");
        
        // Create a neat filename with the date
        const dateStr = new Date().toISOString().split('T')[0];
        XLSX.writeFile(workbook, `System_Orders_${dateStr}.xlsx`);
    } catch (error) {
        alert("An error occurred while generating the Excel file: " + error.message);
    }
    
    hideGlobalLoader();
});





// ==========================================
// --- FULL SYSTEM BACKUP ENGINE ---
// ==========================================

function generateSystemBackupData() {
    // Combine the live database with any active edits on the screen
    return databaseOrders.map(row => {
        const activeRow = { ...row, ...(editedOrders[row.so] || {}) };
        let cleanRow = {};
        // Strictly force the data to map to ALL_COLUMNS to guarantee restore compatibility
        ALL_COLUMNS.forEach(col => {
            cleanRow[col] = activeRow[col] || '';
        });
        return cleanRow;
    });
}


document.getElementById('btnBackupCsv').addEventListener('click', () => {
    const data = generateSystemBackupData();
    if (data.length === 0) return alert("No data available to backup.");
    
    // Generates a perfect Excel CSV with Headers
    const csv = Papa.unparse(data);
    
    // --- FIXED: Added the UTF-8 BOM ('\uFEFF') so Excel reads Arabic correctly ---
    const blob = new Blob(['\uFEFF' + csv], { type: "text/csv;charset=utf-8;" });
    
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `System_Full_Backup_${new Date().getTime()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

document.getElementById('btnBackupTxt').addEventListener('click', () => {
    const data = generateSystemBackupData();
    if (data.length === 0) return alert("No data available to backup.");
    
    // Generates a Tab-Separated TXT file with NO headers (Strict upload compatibility)
    let fileContent = "";
    data.forEach(row => {
        const rowString = ALL_COLUMNS.map(col => row[col]).join('\t');
        fileContent += rowString + "\n";
    });

    const blob = new Blob([fileContent], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `System_Full_Backup_${new Date().getTime()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// ==========================================
// --- VIEW ONLY MODAL ENGINE view ticket---
// ==========================================
// --- UNIVERSAL COPY BUTTON LOGIC ---
// We create a variable to track whichever ticket is currently open in either modal
let currentlyViewedTicket = null;

document.getElementById('modalCopyBtn').addEventListener('click', () => {
    if (!currentlyViewedTicket) return;
    
    const t = currentlyViewedTicket;
    
    // Extract and format the parts neatly
    let partsStr = '';
    for (let i = 1; i <= 5; i++) {
        let part = (t[`part_${i}`] || '').trim();
        let qty = (t[`qty_${i}`] || '').trim();
        if (part && part.toUpperCase() !== 'EMPTY') {
            partsStr += `${part} (x${qty && qty.toUpperCase() !== 'EMPTY' ? qty : '1'}) `;
        }
    }

    // Build the giant text block
    const copyText = `SO: ${t.so}
    Days: ${t.days || 0}
    Name: ${t.name || 'N/A'}
    Phones: ${t.phone || ''} ${t.phone_2 ? '/ ' + t.phone_2 : ''}
    Date: ${t.date || 'N/A'}
    Address: ${t.address || 'N/A'}
    Model: ${t.model || 'N/A'}
    SN: ${t.serial || 'N/A'}
    Remark: ${t.remark || 'N/A'}
    Status Comment: ${t.status_comment || 'N/A'}
    Status: ${t.status || 'N/A'}
    Assigned Tech: ${t.assigned_tech || 'N/A'}
    Route: ${t.rout || 'N/A'}
    I/O: ${t.io || 'N/A'}
    Parts: ${partsStr || 'N/A'}
    Call Details: ${t.call_details || 'N/A'}`;
        
    // Send to clipboard
    navigator.clipboard.writeText(copyText).then(() => {
        alert("Order details copied to clipboard!");
    }).catch(err => {
        alert("Failed to copy details: " + err.message);
    });
});

async function openViewOnlyModal(ticket) {
    currentlyViewedTicket = ticket;
    
    // --- PHASE 4: CHECK LOCK ---
    const lockStatus = await checkAndAcquireLock(ticket.so);
    
    const modal = document.getElementById('detailsModal');
    
    // 1. Set Header
    const modalHeaders = document.querySelectorAll('#modalSoHeader');
    modalHeaders.forEach(h => h.textContent = 'View Order - SO: ' + ticket.so);
    
    // 2. Hide Upload Progress if it was left over
    const progressBox = document.getElementById('uploadProgressContainer');
    if (progressBox) progressBox.style.display = 'none';

    // 3. Render Dynamic Media Links
    renderDynamicMediaLinks(ticket.img1, ticket.vid1, ticket.calls);

    // 4. Generate Phone Links
    const safePhone1 = ticket.phone ? String(ticket.phone).replace(/\s+/g, '') : '';
    const safePhone2 = ticket.phone_2 ? String(ticket.phone_2).replace(/\s+/g, '') : '';
    const p1 = ticket.phone ? `<a class="phone-link" href="tel:${safePhone1}">📞 ${ticket.phone}</a>` : 'N/A';
    const p2 = ticket.phone_2 ? `<a class="phone-link" href="tel:${safePhone2}">📞 ${ticket.phone_2}</a>` : 'N/A';

    // 5. Populate Read-Only Details

    // --- DYNAMIC PURPLE PARTS FOR THE VIEW-ONLY TICKET ---
    let viewPartsArray = [];
    for (let i = 1; i <= 5; i++) {
        let part = (ticket[`part_${i}`] || '').trim();
        let qty = (ticket[`qty_${i}`] || '').trim();
        if (part && part.toUpperCase() !== 'EMPTY') {
            viewPartsArray.push(`${part} (x${qty && qty.toUpperCase() !== 'EMPTY' ? qty : '1'})`);
        }
    }
    
    let viewPartsHtml = viewPartsArray.length > 0 
        ? `<div style="color: #8e24aa; font-size: 14px; font-weight: bold; margin-bottom: 5px;">🛠️ Parts: ${viewPartsArray.join(', ')}</div>` 
        : `<strong>Parts:</strong> N/A<br>`;
    // -------------------------------------------------------

    // --- PHASE 2: RETURN & REDO VIEW-ONLY MODAL BANNER ---
    let returnViewBanner = '';
    const returnValStr = ticket.return ? String(ticket.return).toLowerCase() : '';

    if (returnValStr.startsWith('return')) {
        returnViewBanner = `
            <div style="background-color: #d32f2f; color: white; padding: 10px; border-radius: 4px; margin-bottom: 15px; text-align: center; font-weight: bold; font-size: 16px; border: 2px solid #b71c1c;">
                ⚠️ WARNING: RETURN ORDER ⚠️<br>
                <span style="font-size: 14px; font-weight: normal;">${ticket.return}</span>
            </div>
        `;
    } else if (returnValStr.startsWith('redo')) {
        returnViewBanner = `
            <div style="background-color: #f57c00; color: white; padding: 10px; border-radius: 4px; margin-bottom: 15px; text-align: center; font-weight: bold; font-size: 16px; border: 2px solid #e65100;">
                ⚠️ WARNING: REDO ORDER ⚠️<br>
                <span style="font-size: 14px; font-weight: normal;">${ticket.return}</span>
            </div>
        `;
    }
    // ------------------------------------------

    document.getElementById('modalReadOnlyDetails').innerHTML = lockStatus.message + returnViewBanner + `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 8px;">
            <span style="color:#ffb300; font-weight: bold; font-size: 15px;">Days: ${ticket.days || 0}</span>
        </div>
        <div class="ticket-row"><span><strong>Name:</strong> ${ticket.name || 'N/A'}</span> <span>${p1}</span></div>
        <div class="ticket-row"><span><strong>Date:</strong> ${ticket.date || 'N/A'}</span> <span>${p2}</span></div>
        <div class="ticket-row" style="margin-top: 5px;"><strong>Address:</strong> ${ticket.address || 'N/A'}</div>
        <div class="ticket-row"><span><strong>Model:</strong> ${ticket.model || 'N/A'}</span> <span><strong>SN:</strong> ${ticket.serial || 'N/A'}</span></div>
        <hr style="border-color: var(--border-color); margin: 12px 0;">
        <strong>Remark:</strong> ${ticket.remark || 'N/A'}<br>
        <strong>Status Comment:</strong> ${ticket.status_comment || 'N/A'}<br>
        <strong>Status:</strong> ${ticket.status || 'N/A'}<br>
        <strong>Assigned Tech:</strong> <span style="color: #1976d2; font-weight: bold;">${ticket.assigned_tech || 'N/A'}</span><br>
        <strong>Route:</strong> ${ticket.rout || 'N/A'}<br>
        <strong>I/O:</strong> ${ticket.io || 'N/A'}<br>
        
        <!-- NEW: Replaced the old parts format -->
        ${viewPartsHtml}
        
        <strong>Call Details:</strong> ${ticket.call_details || 'N/A'}
    `;

    // 6. Force View-Only Mode (Hide all action sections by default)
    document.getElementById('techActionSection').style.display = 'none';
    document.getElementById('confirmTechBtn').style.display = 'none';
    
    // --- PHASE 2: MANAGER/ADMIN GLOBAL SEARCH EDITING ---
    const userRole = currentUser && currentUser.role ? currentUser.role.toLowerCase() : '';
    const isManagerOrAdmin = userRole.includes('manager') || userRole.includes('admin');

    if (isManagerOrAdmin && !lockStatus.isLocked) {
        // Link the active ticket so the confirm button knows what to update in the database
        activeTechTicket = ticket;
        
        // Expose the Coordinator panel for authorized management
        document.getElementById('coordActionSection').style.display = 'block';
        const confirmCoordBtn = document.getElementById('confirmCoordBtn');
        confirmCoordBtn.style.display = 'block';
        
        // Reset form fields to ensure a clean slate
        document.getElementById('coordStatusSelect').value = '';
        document.getElementById('coordTechSelect').style.display = 'none';
        document.getElementById('coordTechSelect').value = '';
        document.getElementById('coordCommentInput').value = '';
        confirmCoordBtn.disabled = true;
        confirmCoordBtn.textContent = 'Confirm (Coord) 🔒';
    } else {
        // Strict View-Only enforcement for standard users
        document.getElementById('coordActionSection').style.display = 'none';
        document.getElementById('confirmCoordBtn').style.display = 'none';
    }
    
    fetchAndRenderTicketHistory(ticket.so);

    // 7. Show the Modal
    modal.style.display = 'flex';
}



// --- TICKET MODAL: DOWNLOAD TICKET MEDIA BUTTON ---
document.getElementById('modalDownloadMediaBtn').addEventListener('click', async () => {
    // 1. Safety check to ensure a ticket is actually open
    if (!currentlyViewedTicket) return;
    
    const targetSO = String(currentlyViewedTicket.so);

    // 2. Setup Progress UI in the Loader
    showGlobalLoader("Finding media for SO: " + targetSO + "...");
    const loaderText = document.getElementById('loaderText');
    
    loaderText.innerHTML = `
        <div id="modalZipPhaseText" style="margin-bottom: 10px; font-size: 16px;">Scanning bucket...</div>
        <div style="width: 300px; background: rgba(255, 255, 255, 0.2); border-radius: 4px; overflow: hidden; height: 18px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.4);">
            <div id="modalZipProgressBar" style="width: 0%; background: #4caf50; height: 100%; transition: width 0.2s;"></div>
        </div>
        <div id="modalZipPercentText" style="margin-top: 8px; font-size: 14px; font-weight: normal;">0%</div>
    `;

    const phaseText = document.getElementById('modalZipPhaseText');
    const progressBar = document.getElementById('modalZipProgressBar');
    const percentText = document.getElementById('modalZipPercentText');

    // 3. Fetch all files from the bucket
    const { data: files, error: listError } = await supabaseClient
        .storage
        .from('repair_media')
        .list('', { limit: 5000 });

    if (listError || !files || files.length === 0) {
        hideGlobalLoader();
        alert(listError ? "Error finding files: " + listError.message : "No media found in the database bucket.");
        return;
    }

    // 4. Filter the files to strictly match THIS ticket's SO number
    const ticketFiles = files.filter(f => {
        if (f.name === '.emptyFolderPlaceholder') return false;
        
        // Split the file name by the underscore and check if the first piece is the SO number
        const prefix = f.name.split('_')[0];
        
        // Fallback for older files that don't have the underscore yet
        const isOldFormat = f.name.startsWith(targetSO + 'img') || f.name.startsWith(targetSO + 'vid');
        
        return prefix === targetSO || isOldFormat;
    });

    // If no matches were found, stop the process
    if (ticketFiles.length === 0) {
        hideGlobalLoader();
        alert("No media files found in the database for this specific ticket (SO: " + targetSO + ").");
        return;
    }

    // 5. Download and Zip
    const zip = new JSZip();
    const folder = zip.folder(`SO_${targetSO}_Media`);
    
    phaseText.textContent = `Step 1 of 2: Downloading ${ticketFiles.length} files...`;

    // A. Download files from server
    for (let i = 0; i < ticketFiles.length; i++) {
        const file = ticketFiles[i];
        const { data: fileBlob, error: downloadErr } = await supabaseClient
            .storage
            .from('repair_media')
            .download(file.name);
        
        if (!downloadErr && fileBlob) {
            folder.file(file.name, fileBlob);
        }

        const phasePercent = Math.round(((i + 1) / ticketFiles.length) * 50);
        progressBar.style.width = phasePercent + '%';
        percentText.textContent = `Downloaded ${i + 1} of ${ticketFiles.length}`;
    }

    phaseText.textContent = `Step 2 of 2: Compressing files...`;

    // B. Compress and export
    zip.generateAsync({ type: "blob" }, function updateCallback(metadata) {
        const totalPercent = 50 + Math.round(metadata.percent / 2);
        progressBar.style.width = totalPercent + '%';
        percentText.textContent = `Zipping: ${Math.round(metadata.percent)}%`;
    }).then(function(zipContent) {
        hideGlobalLoader();
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipContent);
        link.download = `SO_${targetSO}_Media.zip`; 
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }).catch(function(err) {
        hideGlobalLoader();
        alert("An error occurred while zipping: " + err.message);
    });
});




// --- CLICK OUTSIDE MODAL TO CLOSE ---
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        // If the user clicked directly on the dark overlay background (outside modal-content)
        if (e.target === overlay) {
            // Route detailsModal through the safe close engine to drop locks and clear orphaned files
            if (overlay.id === 'detailsModal' && typeof executeModalClose === 'function') {
                executeModalClose();
            } else {
                overlay.style.display = 'none';
            }
        }
    });
});

// --- USER HISTORY PANEL LOGIC (FIXED) ---

async function fetchAndRenderUserHistory() {
    const historyBody = document.getElementById('historyPanelBody');
    if (!historyBody) return;

    if (!currentUser || !currentUser.username) {
        historyBody.innerHTML = '<p style="text-align: center; opacity: 0.7;">Please log in to view history.</p>';
        return;
    }

    historyBody.innerHTML = '<p style="text-align: center; opacity: 0.7;">Loading history...</p>';

    const activeUser = currentUser.username.trim();

    // Query repair_log without ordering by non-existent 'id' column
    const { data: logs, error } = await supabaseClient
        .from('repair_log')
        .select('*')
        .or(`assigned_by.eq.${activeUser},assigned_tech.eq.${activeUser}`);

    if (error) {
        console.error("Error fetching user history:", error);
        
        // Fallback: Query assigned_by and assigned_tech separately if needed
        const [resBy, resTech] = await Promise.all([
            supabaseClient.from('repair_log').select('*').eq('assigned_by', activeUser),
            supabaseClient.from('repair_log').select('*').eq('assigned_tech', activeUser)
        ]);

        const combined = [...(resBy.data || []), ...(resTech.data || [])];
        const uniqueMap = new Map();
        combined.forEach((item, index) => uniqueMap.set(item.so + '_' + (item.assign_date || '') + '_' + index, item));
        
        const fallbackLogs = Array.from(uniqueMap.values());
        if (fallbackLogs.length > 0) {
            sortAndDisplayHistory(fallbackLogs, historyBody);
            return;
        }

        historyBody.innerHTML = '<p style="color: #d32f2f; text-align: center;">Failed to load history.</p>';
        return;
    }

    if (!logs || logs.length === 0) {
        historyBody.innerHTML = '<p style="text-align: center; opacity: 0.7;">No recent activity found.</p>';
        return;
    }

    sortAndDisplayHistory(logs, historyBody);
}

// Helper function to sort logs by assign_date & assign_time (Newest First) and render top 50
async function sortAndDisplayHistory(logs, historyBody) {
    logs.sort((a, b) => {
        const parseDate = (d) => d ? d.split('-').reverse().join('-') : '1970-01-01';
        const timeA = new Date(`${parseDate(a.assign_date)}T${a.assign_time || '00:00'}`);
        const timeB = new Date(`${parseDate(b.assign_date)}T${b.assign_time || '00:00'}`);
        return timeB - timeA; 
    });

    // Take the newest 50 entries
    const latest50 = logs.slice(0, 50);
    
    // --- NEW: Fetch customer names and addresses from main database ---
    const soList = [...new Set(latest50.map(l => l.so))];
    const { data: ordersData } = await supabaseClient.from('orders').select('so, name, address').in('so', soList);
    const orderMap = {};
    if (ordersData) {
        ordersData.forEach(o => orderMap[o.so] = o);
    }
    // ------------------------------------------------------------------

    renderHistoryCards(latest50, historyBody, orderMap);
}

function renderHistoryCards(logs, container, orderMap = {}) {
    container.innerHTML = '';

    logs.forEach(log => {
        const card = document.createElement('div');
        card.className = 'history-card';

        const commentText = log.comment && log.comment.trim() !== '' ? log.comment : 'No comment recorded';
        
        // --- NEW: Map the fetched name and address to this specific card ---
        const customer = orderMap[log.so] || {};
        const custName = customer.name || 'N/A';
        const custAddress = customer.address || 'N/A';
        // ------------------------------------------------------------------

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="history-so-link">SO: ${log.so}</span>
                <span style="font-size: 11px; opacity: 0.7;">${log.assign_date || ''} ${log.assign_time || ''}</span>
            </div>
            <div class="history-row" style="color: #1976d2; font-weight: bold; padding-top: 4px;">
                <span>👤 ${custName}</span>
            </div>
            <div class="history-row" style="opacity: 0.8; font-size: 11px; padding-bottom: 6px; border-bottom: 1px solid var(--border-color); margin-bottom: 6px;">
                <span>📍 ${custAddress}</span>
            </div>
            <div class="history-row">
                <span><strong>By:</strong> ${log.assigned_by || 'N/A'}</span>
                <span><strong>To:</strong> ${log.assigned_tech || 'N/A'}</span>
            </div>
            <div class="history-row">
                <span><strong>Status:</strong> ${log.status || 'N/A'}</span>
            </div>
            <div class="history-comment-box">
                <strong>Comment:</strong> ${commentText}
            </div>
        `;

        card.querySelector('.history-so-link').addEventListener('click', async () => {
            let fullOrder = (typeof databaseOrders !== 'undefined' ? databaseOrders.find(o => String(o.so) === String(log.so)) : null) || 
                            (typeof assignationOrders !== 'undefined' ? assignationOrders.find(o => String(o.so) === String(log.so)) : null);

            if (!fullOrder) {
                showGlobalLoader("Loading ticket details...");
                const { data: fetchedOrder } = await supabaseClient
                    .from('orders')
                    .select('*')
                    .eq('so', log.so)
                    .single();
                hideGlobalLoader();

                if (fetchedOrder) {
                    fullOrder = fetchedOrder;
                }
            }

            if (fullOrder) {
                openViewOnlyModal(fullOrder);
            } else {
                alert(`Could not load full ticket details for SO: ${log.so}`);
            }
        });

        container.appendChild(card);
    });
}

// SAFE EVENT ATTACHMENT
document.addEventListener('DOMContentLoaded', () => {
    const btnOpenHistory = document.getElementById('btnOpenHistory');
    const closeHistoryPanelBtn = document.getElementById('closeHistoryPanelBtn');

    if (btnOpenHistory) {
        btnOpenHistory.addEventListener('click', () => {
            const historyPanel = document.getElementById('historyPanel');
            if (historyPanel) historyPanel.classList.add('open');
            fetchAndRenderUserHistory();
        });
    }

    if (closeHistoryPanelBtn) {
        closeHistoryPanelBtn.addEventListener('click', () => {
            const historyPanel = document.getElementById('historyPanel');
            if (historyPanel) historyPanel.classList.remove('open');
        });
    }
});

// CLICK OUTSIDE TO COLLAPSE
document.addEventListener('click', (e) => {
    const historyPanel = document.getElementById('historyPanel');
    const btnOpenHistory = document.getElementById('btnOpenHistory');

    if (!historyPanel || !historyPanel.classList.contains('open')) return;

    const isAnyModalOpen = Array.from(document.querySelectorAll('.modal-overlay'))
                                .some(modal => modal.style.display === 'flex');

    if (isAnyModalOpen) return;

    const clickedInsidePanel = historyPanel.contains(e.target);
    const clickedOpenBtn = btnOpenHistory && btnOpenHistory.contains(e.target);

    if (!clickedInsidePanel && !clickedOpenBtn) {
        historyPanel.classList.remove('open');
    }
});



async function fetchAndRenderFollowUpHistory(soNumber) {
    const contentBox = document.getElementById('followUpContent');
    contentBox.innerHTML = '<span style="color: gray;">Loading follow-up records...</span>';

    const { data: followUps, error } = await supabaseClient
        .from('follow_up')
        .select('*')
        .eq('so', soNumber)
        .eq('call_status', 'submitted')
        .order('submitted_at', { ascending: false });

    if (error || !followUps || followUps.length === 0) {
        contentBox.innerHTML = '<span style="opacity: 0.7;">No completed follow-up records found for this order.</span>';
        return;
    }

    contentBox.innerHTML = '';
    
    followUps.forEach(record => {
        // Format the date nicely
        const dateObj = new Date(record.submitted_at);
        const niceDate = dateObj.toLocaleDateString() + ' at ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // QA Questions layout
        let qaHtml = '';
        if (record.call_type === 'qa_complete') {
            qaHtml = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 8px; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 4px;">
                    <div><strong>Good Service:</strong> ${record.qa_good_service || '-'}</div>
                    <div><strong>Cleaned Up:</strong> ${record.qa_clean || '-'}</div>
                    <div><strong>Uniform:</strong> ${record.qa_uniform || '-'}</div>
                    <div><strong>Overshoe:</strong> ${record.qa_overshoe || '-'}</div>
                </div>
            `;
        }

        // Audio Player
        const audioHtml = record.recording_url ? `
            <div style="margin-top: 10px;">
                <audio controls style="width: 100%; height: 30px;">
                    <source src="${record.recording_url}">
                    Your browser does not support audio playback.
                </audio>
            </div>
        ` : '';

        const card = document.createElement('div');
        card.style.cssText = "margin-bottom: 12px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--card-bg);";
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--border-color); padding-bottom: 5px; margin-bottom: 5px;">
                <strong style="color: #ffb300;">${record.call_type.replace('_', ' ').toUpperCase()}</strong>
                <span style="font-size: 11px; opacity: 0.8;">${niceDate}</span>
            </div>
            <div><strong>Operator:</strong> ${record.operator_name || 'Unknown'}</div>
            <div style="margin-top: 5px;"><strong>Comment:</strong> ${record.comment || 'No comment left.'}</div>
            ${qaHtml}
            ${audioHtml}
        `;
        contentBox.appendChild(card);
    });
}

// Attach the toggle button listener once globally
document.getElementById('toggleFollowUpBtn').addEventListener('click', () => {
    const content = document.getElementById('followUpContent');
    const arrow = document.getElementById('followUpArrow');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        arrow.textContent = '▲';
    } else {
        content.style.display = 'none';
        arrow.textContent = '▼';
    }
});

// ==========================================
// --- TECHNICIAN "MY PARTS" MODAL LOGIC ---
// ==========================================
const btnOpenTechParts = document.getElementById('btnOpenTechParts');
const techPartsModal = document.getElementById('techPartsModal');
const closeTechPartsBtn = document.getElementById('closeTechPartsBtn');
const cancelTechPartsBtn = document.getElementById('cancelTechPartsBtn');
const techPartsListContainer = document.getElementById('techPartsListContainer');

if (btnOpenTechParts) {
    btnOpenTechParts.addEventListener('click', async () => {
        // Fallback for offline mode or missing user
        if (!currentUser) return;
        if (!navigator.onLine) {
            alert("You must have an active internet connection to check live inventory.");
            return;
        }
        
        techPartsModal.style.display = 'flex';
        techPartsListContainer.innerHTML = '<div style="text-align:center; padding: 20px; opacity: 0.8;">⏳ Reconciling your inventory...</div>';

        const techName = currentUser.username;

        // 1. Fetch current active orders for this tech to see what they NEED
        const { data: activeOrders } = await supabaseClient
            .from('orders')
            .select('*')
            .eq('status', 'Technician')
            .ilike('assigned_tech', techName);

        let requiredPartsMap = {}; 
        
        if (activeOrders) {
            activeOrders.forEach(order => {
                // Use our global utility function from warehouse.js
                const parts = window.parseRequiredParts(order);
                parts.forEach(p => {
                    if (!requiredPartsMap[p.part_name]) {
                        requiredPartsMap[p.part_name] = { qty: 0, soList: [] };
                    }
                    requiredPartsMap[p.part_name].qty += p.required_qty;
                    requiredPartsMap[p.part_name].soList.push(order.so);
                });
            });
        }

        // 2. Fetch the tech's actual liability from the Warehouse view to see what they HAVE
        const { data: stockData } = await supabaseClient
            .from('inventory_current_stock_view')
            .select('*')
            .eq('tech_id', techName);

        let heldPartsMap = {};
        if (stockData) {
            stockData.forEach(stock => {
                if (!heldPartsMap[stock.part_name]) {
                    heldPartsMap[stock.part_name] = { qty: 0, soList: [] };
                }
                heldPartsMap[stock.part_name].qty += stock.qty_on_hand;
                heldPartsMap[stock.part_name].soList.push(stock.so);
            });
        }

        // 3. Reconcile and build the UI
        let html = '';
        const allPartNames = new Set([...Object.keys(requiredPartsMap), ...Object.keys(heldPartsMap)]);

        if (allPartNames.size === 0) {
            techPartsListContainer.innerHTML = '<div style="text-align:center; padding: 20px; opacity: 0.8;">You currently have no parts assigned or required.</div>';
            return;
        }

        allPartNames.forEach(partName => {
            const req = requiredPartsMap[partName] || { qty: 0, soList: [] };
            const held = heldPartsMap[partName] || { qty: 0, soList: [] };
            
            let statusBadge = '';
            let bgColor = 'var(--bg-color)';
            
            if (held.qty === 0 && req.qty > 0) {
                // Need it but don't have it
                statusBadge = `<span style="color: #d32f2f; font-weight: bold; background: rgba(211, 47, 47, 0.1); padding: 3px 8px; border-radius: 4px;">Pick Up Needed (0 / ${req.qty})</span>`;
            } else if (held.qty < req.qty) {
                // Have some, but not enough
                statusBadge = `<span style="color: #fbc02d; font-weight: bold; background: rgba(251, 192, 45, 0.1); padding: 3px 8px; border-radius: 4px;">Partial (${held.qty} / ${req.qty})</span>`;
            } else if (held.qty >= req.qty && req.qty > 0) {
                // Have exactly what's needed (or more)
                statusBadge = `<span style="color: #2e7d32; font-weight: bold; background: rgba(46, 125, 50, 0.1); padding: 3px 8px; border-radius: 4px;">Ready to Use (${held.qty} / ${req.qty})</span>`;
            } else if (held.qty > 0 && req.qty === 0) {
                // Held but NOT required anymore (Orphaned!)
                statusBadge = `<span style="color: #d32f2f; font-weight: bold; background: rgba(211, 47, 47, 0.1); padding: 3px 8px; border-radius: 4px;">⚠️ Orphaned (${held.qty}) - Return to WH!</span>`;
                bgColor = 'rgba(211, 47, 47, 0.05)';
            }

            // Build clickable links for the SO numbers
            const soLinks = [...new Set([...req.soList, ...held.soList])].map(so => 
                `<a href="#" onclick="window.openWhViewModal('${so}'); return false;" style="color: #1976d2; font-weight: bold; text-decoration: underline;">${so}</a>`
            ).join(', ');

            html += `
                <div style="background: ${bgColor}; border: 1px solid var(--border-color); border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 15px; color: #8e24aa;">⚙️ ${partName}</strong>
                        ${statusBadge}
                    </div>
                    <div style="font-size: 12px; opacity: 0.8;"><strong>Related SOs:</strong> ${soLinks || 'None'}</div>
                </div>
            `;
        });

        techPartsListContainer.innerHTML = html;
    });
}

//=========This code for "Wire Tech Parts Modal close listeners"=========
// Close Triggers (Consolidated with Garbage Collection & Lock Release)
const executeModalClose = () => {
    cleanupOrphanedUploads(); // Destroy any unconfirmed file uploads
    activeUploadsCount = 0;   // Reset the upload lock
    
    detailsModal.style.display = 'none';
    if (currentlyViewedTicket) releaseTicketLock(currentlyViewedTicket.so);
};

document.getElementById('closeModalBtn').addEventListener('click', executeModalClose);
document.getElementById('cancelModalBtn').addEventListener('click', executeModalClose);

if (closeTechPartsBtn) closeTechPartsBtn.addEventListener('click', () => techPartsModal.style.display = 'none');
if (cancelTechPartsBtn) cancelTechPartsBtn.addEventListener('click', () => techPartsModal.style.display = 'none');

// --- EVALUATION REMINDER MODAL CLOSURE ---
document.getElementById('closeEvalReminderBtn')?.addEventListener('click', () => {
    document.getElementById('evaluationReminderModal').style.display = 'none';
});
// ==========================================
// --- PHASE 2: DAILY ROUTE PLANNER LOGIC ---
// ==========================================
const btnOpenRoutePlanner = document.getElementById('btnOpenRoutePlanner');
const routePlannerModal = document.getElementById('routePlannerModal');
const routePlannerListContainer = document.getElementById('routePlannerListContainer');

if (btnOpenRoutePlanner) {
    btnOpenRoutePlanner.addEventListener('click', () => {
        if (!currentMyOrders || currentMyOrders.length === 0) {
            alert("No active orders found to plan.");
            return;
        }
        
        routePlannerListContainer.innerHTML = '';
        
        // Build the isolated UI list focusing strictly on Name, Rout, and Address
        currentMyOrders.forEach(order => {
            const item = document.createElement('div');
            item.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: var(--card-bg); border: 1px solid var(--border-color); padding: 10px; border-radius: 4px; gap: 10px;";
            
            item.innerHTML = `
                <div style="flex-grow: 1; font-size: 13px;">
                    <strong style="color: #1976d2;">SO: ${order.so}</strong> - ${order.name || 'N/A'}<br>
                    <span style="opacity: 0.8;"><strong>Rout:</strong> ${order.rout || 'N/A'} | <strong>Address:</strong> ${order.address || 'N/A'}</span>
                </div>
                <div>
                    <input type="number" class="route-seq-input" data-so="${order.so}" value="${order.visit_sequence || ''}" placeholder="#" style="width: 60px; padding: 8px; text-align: center; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
                </div>
            `;
            routePlannerListContainer.appendChild(item);
        });
        
        routePlannerModal.style.display = 'flex';
    });
}

document.getElementById('closeRoutePlannerBtn')?.addEventListener('click', () => routePlannerModal.style.display = 'none');
document.getElementById('cancelRoutePlannerBtn')?.addEventListener('click', () => routePlannerModal.style.display = 'none');

document.getElementById('saveRoutePlannerBtn')?.addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.route-seq-input');
    const updates = [];
    let hasDuplicates = false;
    const usedNumbers = new Set();

    // Data Aggregation & Duplicate Validation
    inputs.forEach(input => {
        const val = input.value.trim();
        if (val) {
            if (usedNumbers.has(val)) {
                hasDuplicates = true;
            }
            usedNumbers.add(val);
        }
        
        // Push all inputs to ensure we nullify any sequences the tech decided to erase
        updates.push({
            so: input.dataset.so,
            visit_sequence: val ? Number(val) : null
        });
    });

    if (hasDuplicates) {
        alert("Error: Sequence numbers must be strictly unique. Please fix any duplicate numbers before saving.");
        return;
    }

    const saveBtn = document.getElementById('saveRoutePlannerBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    // Execute bulk update safely using isolated update promises to avoid full-row overwrites
    const updatePromises = updates.map(update => 
        supabaseClient.from('orders').update({ visit_sequence: update.visit_sequence }).eq('so', update.so)
    );
    
    await Promise.all(updatePromises);
    
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save Sequence';
    routePlannerModal.style.display = 'none';
    
    // Globally reload the tickets. The manager override dropdown value is passed to ensure it reloads the correct target.
    const managerSelect = document.getElementById('managerUserSelect');
    loadActiveTickets(managerSelect && managerSelect.value !== '' ? managerSelect.value : null);
});
// ==========================================

// Helper to delete orphaned files from Supabase if the user cancels the ticket
async function cleanupOrphanedUploads() {
    if (currentSessionUploads.length === 0) return;
    
    // Extract filenames from the Supabase public URLs
    const fileNames = currentSessionUploads.map(file => file.url.split('/').pop());
    
    // Fire and forget deletion
    supabaseClient.storage.from('repair_media').remove(fileNames).then(({error}) => {
        if (error) console.error("Failed to clean up orphaned media:", error);
    });
    
    currentSessionUploads = []; // Reset the session
}

// ==========================================
// --- DYNAMIC MEDIA CAPTURE ENGINE ---
// ==========================================
function createMediaStagingRow(type) {
    const stagingArea = document.getElementById('mediaStagingArea');
    if (!stagingArea) return;

    const rowId = `media_${Date.now()}`;
    let acceptType = 'image/*';
    let icon = '📷';
    
    if (type === 'video') { acceptType = 'video/*'; icon = '📹'; }
    if (type === 'call') { acceptType = 'audio/*'; icon = '📞'; }

    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'dynamic-media-row';
    row.dataset.type = type;
    // Updated flex layout to stack the progress bar below the controls
    row.style.cssText = "display: flex; flex-direction: column; gap: 5px; background: var(--bg-color); padding: 8px; border: 1px solid var(--border-color); border-radius: 4px;";

    row.innerHTML = `
        <div style="display: flex; gap: 10px; align-items: center;">
            <label id="lbl_${rowId}" class="secondary-btn" style="cursor: pointer; min-width: 110px; text-align: center; margin: 0; flex-shrink: 0; padding: 6px;">
                ${icon} Upload
                <input type="file" id="file_${rowId}" class="dynamic-media-input" data-type="${type}" accept="${acceptType}" hidden>
            </label>
            <select id="sel_${rowId}" class="dynamic-media-label" style="padding: 8px; flex-grow: 1; border: 1px solid var(--border-color); border-radius: 4px; background: var(--card-bg); color: var(--text-color);">
                <option value="">-- Select Label --</option>
                <option value="قبل صيانة">قبل صيانة</option>
                <option value="بعد صيانة">بعد صيانة</option>
                <option value="ليبل">ليبل</option>
                <option value="اوبن سيل قديم">اوبن سيل قديم</option>
                <option value="اوبن سيل جديد">اوبن سيل جديد</option>
                <option value="اخرى">اخرى</option>
            </select>
            <button type="button" style="background: #d32f2f; color: white; padding: 8px 12px; font-size: 14px; font-weight: bold; border: none; border-radius: 4px; cursor: pointer; flex-shrink: 0;" id="del_${rowId}">X</button>
        </div>
        <!-- Localized Progress Bar Target -->
        <div id="step-${rowId}" style="width: 100%; font-size: 13px;"></div>
    `;

    stagingArea.appendChild(row);

    const fileInput = row.querySelector(`#file_${rowId}`);
    const delBtn = row.querySelector(`#del_${rowId}`);
    const lblBtn = row.querySelector(`#lbl_${rowId}`);
    const stepContainer = row.querySelector(`#step-${rowId}`);

    // Auto-Upload Trigger
    fileInput.addEventListener('change', async function() {
        if (this.files && this.files.length > 0) {
            const file = this.files[0];
            
            // 1. Lock UI
            activeUploadsCount++;
            validateTechForm();
            
            // 2. Prevent duplicate clicks during upload
            lblBtn.style.pointerEvents = 'none';
            lblBtn.style.opacity = '0.5';
            
            // 3. Execute Upload (Repurposing rowId as the target label for the progress bar text)
            const uploadedUrl = await uploadMediaToSupabase(file, activeTechTicket.so, rowId);
            
            // 4. Network Resolution Handle
            if (uploadedUrl) {
                // Critical Safety Check: Did the user close the ticket or delete this row mid-upload?
                if (!document.getElementById(rowId)) {
                    const fileName = uploadedUrl.split('/').pop();
                    supabaseClient.storage.from('repair_media').remove([fileName]).then(({error}) => {
                        if (error) console.error("Failed to destroy orphaned mid-upload file:", error);
                    });
                } else {
                    currentSessionUploads.push({ url: uploadedUrl, type: type, rowId: rowId });
                    lblBtn.style.backgroundColor = '#2e7d32';
                    lblBtn.style.color = 'white';
                    lblBtn.style.opacity = '1';
                    lblBtn.childNodes[0].nodeValue = '✅ Uploaded ';
                    stepContainer.innerHTML = `
                        <div style="margin-bottom: 4px; font-size: 13px;">
                            <span style="color: #2e7d32; font-weight: bold;">✅ Upload Complete</span>
                        </div>
                        <div style="width: 100%; background: var(--border-color); border-radius: 4px; overflow: hidden; height: 12px;">
                            <div style="width: 100%; background: #2e7d32; height: 100%;"></div>
                        </div>
                    `;
                }
            } else {
                lblBtn.style.pointerEvents = 'auto';
                lblBtn.style.opacity = '1';
                stepContainer.innerHTML = '<span style="color: #d32f2f;">⚠️ Upload failed. Please try again.</span>';
            }
            
            // 5. Unlock UI
            activeUploadsCount--;
            validateTechForm();
        }
    });

    // Row Deletion with Targeted Garbage Collection
    delBtn.addEventListener('click', () => {
        // Destroy the file in Supabase if it already finished uploading
        const uploadIndex = currentSessionUploads.findIndex(u => u.rowId === rowId);
        if (uploadIndex > -1) {
            const urlObj = currentSessionUploads[uploadIndex];
            const fileName = urlObj.url.split('/').pop();
            supabaseClient.storage.from('repair_media').remove([fileName]).then(({error}) => {
                if (error) console.error("Failed to delete removed row media:", error);
            });
            currentSessionUploads.splice(uploadIndex, 1);
        }
        
        row.remove();
        validateTechForm(); // Re-validate in case an active upload was destroyed
    });
}
// Bind the HTML buttons to the row generator
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnAddImageRow')?.addEventListener('click', () => createMediaStagingRow('image'));
    document.getElementById('btnAddVideoRow')?.addEventListener('click', () => createMediaStagingRow('video'));
    document.getElementById('btnAddCallRow')?.addEventListener('click', () => createMediaStagingRow('call'));
});

// --- FLEET MANAGER NAVIGATION ---
const fleetManagerPage = document.getElementById('fleetManagerPage');

document.getElementById('btnFleetManager').addEventListener('click', () => {
    menuPage.classList.remove('active');
    fleetManagerPage.classList.add('active');
    
    // We will call the initialization function from drivers_fleet.js here later
    if (typeof initializeFleetManager === 'function') {
        initializeFleetManager();
    }
});

document.getElementById('fleetHubBtn').addEventListener('click', () => {
    fleetManagerPage.classList.remove('active');
    menuPage.classList.add('active');
});