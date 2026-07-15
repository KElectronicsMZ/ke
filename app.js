// --- 1. SUPABASE CONNECTION CONFIGURATION ---
const SUPABASE_URL = "https://nltzapfwhuidmjlnjwgy.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_9uEZtAWURjryzdCaVwH2Eg_OaW1MmpC"; 

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
let activeInputTarget = null; // Tracks the currently selected table cell input
let sortDirection = {}; // Tracks if column is sorting 'asc' or 'desc'
let currentUser = null;
let databaseOrders = []; 
let editedOrders = {};    
let hiddenColumns = [];
let selectedSystemOrders = new Set(); //to track the selected order in system page
let selectedAssignationOrders = new Set();  //to track the selected order in assignation page
// NEW TRACKING DATASETS FOR MONITOR SPLIT
let monitorTrackingRows = []; 
let editedMonitorRows = {};   
const MONITOR_TABLE_NAME = 'repair_log'; // Your secondary table name in Supabase

// CHANGED: 'SO' is now 'so' to match the database strict case rules
const ALL_COLUMNS = [
    "so", "created_by", "branch", "date", "days", "status", "reason","service_type", "name", 
    "phone", "phone_2", "phone_3", "address", "rout", "model", "serial", "io", "remark", 
    "status_comment", "change_log", "return", "part_1", "qty_1", "part_2", 
    "qty_2", "part_3", "qty_3", "part_4", "qty_4", "part_5", "qty_5",
    "call_details", "img1", "img2", "img3", "vid1", "vid2", "vid3",
    "end_tech", "end_coord", "collected", "history", "assigned_tech"
];


const DEFAULT_SYSTEM_COLUMNS = ['so', 'date', "days" , 'address', "rout", "assigned_tech",'status', 'reason', 'service_type', 'name', 'phone']; // edit column name as they are in the supabase tables orders table as you see fit
let activeColumns = [...DEFAULT_SYSTEM_COLUMNS];

// related to assignation page
let assignationOrders = [];
let availableTechnicians = [];
let editedAssignations = {};
const ASSIGN_COLUMNS = [
    "so", "date", "days", "status", "service_type", "address", "rout", 
    "assigned_tech", "model", "remark", "status_comment", 
    "part_1", "qty_1", "part_2", "qty_2", "part_3", "qty_3"
];

// --- 3. DOM ELEMENTS ELEMENT SELECTORS ---
const loginPage = document.getElementById('loginPage');
const menuPage = document.getElementById('menuPage');
const systemPage = document.getElementById('systemPage');

// --- 4. THEME SELECTION ENGINE ---
const themeSelect = document.getElementById('themeSelect');
themeSelect.addEventListener('change', (e) => {
    document.body.setAttribute('data-theme', e.target.value);
});


// --- ASSIGNATION PAGE: RESET LAYOUT ---
document.getElementById('assignResetLayoutBtn').addEventListener('click', () => {
    const userKey = currentUser ? currentUser.username : 'guest';
    
    // 1. Wipe saved memory for this page
    localStorage.removeItem('assign_cols_' + userKey);
    localStorage.removeItem('assign_order_' + userKey);
    
    // 2. Restore factory defaults
    ASSIGN_COLUMNS.length = 0;
    ASSIGN_COLUMNS.push("so", "date", "days", "status", "service_type", "address", "rout", "assigned_tech", "model", "remark", "status_comment", "part_1", "qty_1", "part_2", "qty_2", "part_3", "qty_3");
    
    // 3. Redraw table
    renderAssignationTable();
    alert("Assignation layout has been reset to defaults.");
});


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
            document.getElementById('globalUserBanner').style.display = 'block';
            // Restore their column preferences
            const savedHidden = localStorage.getItem('hiddenColumns_' + currentUser.username);
            if (savedHidden) {
                hiddenColumns = JSON.parse(savedHidden);
                activeColumns = ALL_COLUMNS.filter(col => !hiddenColumns.includes(col));
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
document.getElementById('loginOkBtn').addEventListener('click', async () => {
    const userIn = document.getElementById('usernameInput').value.trim();
    const passIn = document.getElementById('passwordInput').value.trim();

    if (!userIn || !passIn) {
        alert("Please fill in both fields.");
        return;
    }

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('username', userIn)
        .eq('password', passIn)
        .single();

    if (error || !data) {
        alert("Invalid username or password.");
        return;
    }

    currentUser = data;

    // Show top banner
    document.getElementById('bannerUsername').textContent = currentUser.username;
    document.getElementById('bannerRole').textContent = currentUser.role;
    document.getElementById('globalUserBanner').style.display = 'block';
    
    // --- NEW: SAVE SESSION TICKET TO PHONE ---
    const sessionPayload = {
        user: currentUser,
        timestamp: Date.now() // Record the exact millisecond they logged in
    };
    localStorage.setItem('ke_user_session', JSON.stringify(sessionPayload));
    // -----------------------------------------

    // --- UPDATED LOGIN COLUMN LOGIC ---
    // First, check if they have a saved custom column order
    const savedOrder = localStorage.getItem('sys_order_' + currentUser.username);
    if (savedOrder) {
        activeColumns = JSON.parse(savedOrder);
    } else {
        // If no custom order, load your preferred defaults instead of ALL_COLUMNS
        activeColumns = [...DEFAULT_SYSTEM_COLUMNS]; 
    }

    // Then, apply any hidden columns they saved
    const savedHidden = localStorage.getItem('hiddenColumns_' + currentUser.username);
    if (savedHidden) {
        hiddenColumns = JSON.parse(savedHidden);
        // Filter out the hidden columns from whatever the activeColumns list currently is
        activeColumns = activeColumns.filter(col => !hiddenColumns.includes(col));
    } else {
        hiddenColumns = [];
    }
    // ----------------------------------
    loginPage.classList.remove('active');
    menuPage.classList.add('active');
});

document.getElementById('loginCancelBtn').addEventListener('click', () => {
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
});

document.getElementById('menuCancelBtn').addEventListener('click', () => {
    document.getElementById('globalUserBanner').style.display = 'none'; //hide the banner on logout
    // --- DESTROY SESSION TICKET ---
    localStorage.removeItem('ke_user_session');

    hiddenColumns = [];
    activeColumns = [...DEFAULT_SYSTEM_COLUMNS];
    currentUser = null;
    menuPage.classList.remove('active');
    loginPage.classList.add('active');
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
});

document.getElementById('btnSystem').addEventListener('click', () => {
    // Exactly matches the lowercase database roles
    const allowedRoles = ['coordinator', 'supervisor', 'manager']; 
    
    if (!currentUser || !allowedRoles.includes(currentUser.role)) {
        alert("Access Denied: Your account role does not have permission to view the System page.");
        return;
    }

    menuPage.classList.remove('active');
    systemPage.classList.add('active');
    loadDatabaseData(); 
});

document.getElementById('systemCancelBtn').addEventListener('click', () => {
    if (Object.keys(editedOrders).length > 0) {
        if (!confirm("You have unsaved inline changes. Are you sure you want to discard them?")) {
            return;
        }
    }
    editedOrders = {};
    systemPage.classList.remove('active');
    menuPage.classList.add('active');
});

// Open Monitor Page from HUB Menu
document.getElementById('btnMonitor').addEventListener('click', () => {
    // Changed to match the exact lowercase roles in your database
    const allowedRoles = ['coordinator', 'supervisor', 'manager']; 
    
    if (!currentUser || !allowedRoles.includes(currentUser.role)) {
        alert("Access Denied: Your account role does not have permission to view the Monitor page.");
        return;
    }

    menuPage.classList.remove('active');
    monitorPage.classList.add('active');
    
    // --- NEW: SET DEFAULT DATES TO CURRENT MONTH ---
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const formatInputDate = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    document.getElementById('monitorStartDate').value = formatInputDate(firstDay);
    document.getElementById('monitorEndDate').value = formatInputDate(now);
    // -----------------------------------------------

    // Wait for the data engine to finish downloading the records, 
    // then automatically apply the filter for the current month!
    loadMonitorDataEngine().then(() => {
        document.getElementById('monitorFilterDateBtn').click();
    }); 
});


// Back to HUB button inside Monitor Page
document.getElementById('monitorHubBtn').addEventListener('click', () => {
    if (Object.keys(editedMonitorRows).length > 0) {
        if (!confirm("You have unsaved monitoring changes. Are you sure you want to discard them?")) {
            return;
        }
    }
    editedMonitorRows = {};
    document.getElementById('monitorTableArea').style.display = 'none';
    document.getElementById('monitorSubmitBtn').style.display = 'none';
    document.getElementById('activeMonitorStatusHeader').textContent = 'Select a Status from the Left';
    monitorPage.classList.remove('active');
    menuPage.classList.add('active');
});

// Close Action Table inside Monitor Page
document.getElementById('closeMonitorTableBtn').addEventListener('click', () => {
    document.getElementById('monitorTableArea').style.display = 'none';
    document.getElementById('monitorSubmitBtn').style.display = 'none';
    document.getElementById('activeMonitorStatusHeader').textContent = 'Select a Status from the Left';
});

document.getElementById('systemHubBtn').addEventListener('click', () => {
    // Safety check: Don't let the user accidentally lose their work
    if (Object.keys(editedOrders).length > 0) {
        if (!confirm("You have unsaved inline changes. Are you sure you want to leave for the HUB?")) {
            return;
        }
    }
    
    // Clear out any unsaved edits so they don't linger
    editedOrders = {};
    
    // Hide the system page and show the menu (HUB) page
    systemPage.classList.remove('active');
    menuPage.classList.add('active');
});

const assignationPage = document.getElementById('assignationPage');

document.getElementById('btnAssignation').addEventListener('click', async () => {
    menuPage.classList.remove('active');
    assignationPage.classList.add('active');
    
    // FETCH UPDATE: The '%' symbols tell the database to look for the word 
    // "technician" even if there are accidental spaces before or after it.
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('username')
        .ilike('role', '%technician%'); 
        
    if (!error && data) {
        availableTechnicians = data.map(d => d.username);
        
        // DEBUG TOOL: This will print the list to your browser console 
        console.log("Technicians successfully loaded:", availableTechnicians);
        
        const dataList = document.getElementById('technicianList');
        dataList.innerHTML = '';
        availableTechnicians.forEach(tech => {
            const opt = document.createElement('option');
            opt.value = tech;
            opt.textContent = tech; // Helps force visibility in some Chrome versions
            dataList.appendChild(opt);
        });
    } else if (error) {
        console.error("Supabase Error:", error);
    }
    
    assignationOrders = [];
    editedAssignations = {};
    
    // --- LAYOUT FIX: LOAD SAVED COLUMN ORDER ---
    const userKey = currentUser ? currentUser.username : 'guest';
    const savedAssignOrder = localStorage.getItem('assign_order_' + userKey);
    
    if (savedAssignOrder) {
        // Empty the default array and fill it with their saved custom order
        const parsedOrder = JSON.parse(savedAssignOrder);
        ASSIGN_COLUMNS.length = 0;
        ASSIGN_COLUMNS.push(...parsedOrder);
    }
    // -------------------------------------------
});

document.getElementById('assignHubBtn').addEventListener('click', () => {
    if (Object.keys(editedAssignations).length > 0) {
        if (!confirm("Discard unsaved assignations?")) return;
    }
    assignationPage.classList.remove('active');
    menuPage.classList.add('active');
});

// --- TECH PAGE (MY ORDERS) NAVIGATION ---
const techPage = document.getElementById('techPage');

document.getElementById('btnMyOrders').addEventListener('click', () => {
    // 1. Hide the main menu and show the technician page
    menuPage.classList.remove('active');
    techPage.classList.add('active');
    
    // 2. Trigger the fetch logic to load their active tickets
    loadActiveTickets();
});

// Wire up the Logout/Back button inside the Tech Page
document.getElementById('techHubBtn').addEventListener('click', () => {
    // Go back to the HUB menu
    techPage.classList.remove('active');
    menuPage.classList.add('active');
});

// --- 6. DATA VISUALIZATION ENGINE (DYNAMIC TABLE) ---
async function loadDatabaseData() {
    const { data, error } = await supabaseClient.from('orders').select('*');
    if (error) {
        alert("Error loading data from database: " + error.message);
        return;
    }
    databaseOrders = data || [];
    editedOrders = {};
    renderTableStructure();
}

function renderTableStructure() {
    const headerRow = document.getElementById('headerRow');
    const filterRow = document.getElementById('filterRow');
    
    headerRow.innerHTML = '';
    filterRow.innerHTML = '';

    // --- Add empty header cells for the checkbox column --------------
    const checkHeader = document.createElement('th');
    checkHeader.textContent = "Select";
    headerRow.appendChild(checkHeader);
    
    const checkFilter = document.createElement('th');
    filterRow.appendChild(checkFilter);
    // -------end of Add empty header cells for the checkbox colum------

    activeColumns.forEach(colKey => {
        const th = document.createElement('th');
        const displayName = colKey === 'so' ? 'SO' : colKey;
        
        // Wrap the name in a clickable span for sorting
        th.innerHTML = `
            <div class="header-wrapper" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <button class="move-arrow left-arrow" title="Move Left" style="display: none; background: transparent; border: none; cursor: pointer; font-size: 16px;">◀</button>
                <div style="display: flex; justify-content: center; align-items: center; flex-grow: 1;">
                    <span class="sort-header" style="cursor:pointer;">${displayName}</span> 
                    <button class="delete-col-btn" onclick="hideColumn('${colKey}')" style="margin-left: 5px;">-</button>
                </div>
                <button class="move-arrow right-arrow" title="Move Right" style="display: none; background: transparent; border: none; cursor: pointer; font-size: 16px;">▶</button>
            </div>
        `;
        
        headerRow.appendChild(th);

        // --- NEW EXCEL-STYLE DROPDOWN FILTER ---
        const filterTd = document.createElement('th');
        const filterSelect = document.createElement('select');
        filterSelect.dataset.column = colKey;
        
        // Add the default option at the top
        filterSelect.innerHTML = `<option value="">-- All --</option>`;
        
        // Extract unique values from the database for this specific column
        const uniqueValues = new Set();
        databaseOrders.forEach(row => {
            let val = (editedOrders[row.so] && editedOrders[row.so][colKey] !== undefined) 
                ? editedOrders[row.so][colKey] 
                : row[colKey];
            
            if (val !== null && val !== undefined && String(val).trim() !== '') {
                uniqueValues.add(String(val).trim());
            }
        });

        // Sort alphabetically and add them to the dropdown list
        Array.from(uniqueValues).sort().forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            filterSelect.appendChild(opt);
        });

        filterSelect.addEventListener('change', runFilters);
        filterTd.appendChild(filterSelect);
        filterRow.appendChild(filterTd);
        // ---------------------------------------
    });

    populateTableRows(databaseOrders);
    updateDropdownOptions();
    // Fire resizer
    applyResizableColumns('dataTable', 'sys_cols');

    attachClickMoveLogic('headerRow', activeColumns, 'sys_order', renderTableStructure);
}

function populateTableRows(dataToDisplay) {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    dataToDisplay.forEach(row => {
        const tr = document.createElement('tr');
        const currentSO = row.so; // CHANGED to lowercase 'so'

        // --- Inject the Checkbox Cell ---
        const checkTd = document.createElement('td');
        checkTd.style.textAlign = 'center';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.width = 'auto'; // Prevent it from stretching
        checkbox.checked = selectedSystemOrders.has(currentSO);
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedSystemOrders.add(currentSO);
            } else {
                selectedSystemOrders.delete(currentSO);
            }
        });
        
        checkTd.appendChild(checkbox);
        tr.appendChild(checkTd);
        // --- end of Inject the Checkbox Cell --

        activeColumns.forEach(colKey => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            
            const currentValue = (editedOrders[currentSO] && editedOrders[currentSO][colKey] !== undefined) 
                ? editedOrders[currentSO][colKey] 
                : (row[colKey] || '');

            input.value = currentValue;

            input.addEventListener('input', (e) => {
                if (!editedOrders[currentSO]) {
                    editedOrders[currentSO] = { ...row };
                }
                editedOrders[currentSO][colKey] = e.target.value;
            });

            td.appendChild(input);

            // DATA TYPE: PHONE (Adds a tiny clickable phone icon link if the column is a phone column)
            if ((colKey === 'phone' || colKey === 'phone_2' || colKey === 'phone_3') && currentValue) {
                const dialLink = document.createElement('a');
                dialLink.href = `tel:${currentValue.replace(/\s+/g, '')}`; // Strips spaces out for standard phone app dialing
                dialLink.textContent = '📞';
                dialLink.style.textDecoration = 'none';
                dialLink.style.marginLeft = '4px';
                dialLink.title = "Click to call number";
                td.appendChild(dialLink);
            }

            // Triple click copy (Bulletproof version)
            input.addEventListener('mousedown', (e) => {
                if (e.detail === 3) {
                    e.preventDefault(); // Prevents the browser's default text highlighting interference
                    navigator.clipboard.writeText(e.target.value)
                        .then(() => alert(`Copied to clipboard: "${e.target.value}"`))
                        .catch(err => console.error("Clipboard copy failed: ", err));
                }
            });

            // ACTIVE TRACKING HEADER COMPONENT LINK (Upgraded to look below the table)
            input.addEventListener('focus', (e) => {
                activeInputTarget = e.target; 
                
                const masterSOKey = document.getElementById('masterSOKey');
                const masterHeaderLabel = document.getElementById('masterHeaderLabel');
                const masterValueInput = document.getElementById('masterValueInput');
                const actionButtons = document.getElementById('masterActionButtons'); // NEW

                if (masterSOKey && masterHeaderLabel && masterValueInput) {
                    masterSOKey.textContent = `SO: (${currentSO}) - `;
                    masterHeaderLabel.textContent = `${colKey === 'so' ? 'SO' : colKey}: `;
                    
                    masterValueInput.value = e.target.value;
                    masterValueInput.style.display = 'inline-block';
                    
                    // NEW: Show buttons and attach the current SO to the container's memory
                    actionButtons.style.display = 'flex';
                    actionButtons.dataset.activeSo = currentSO; 
                    
                    // NEW: Reset the tech dropdown to a clean state if they click a different cell
                    document.getElementById('masterTechDropdown').style.display = 'none';
                    document.getElementById('btnSubmitTechAssign').style.display = 'none';
                    document.getElementById('masterTechDropdown').value = '';
                }
            });

            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

// --- 7. FILTERING SYSTEM ---
function runFilters() {
    const filterInputs = document.querySelectorAll('#filterRow select');
    let filteredData = [...databaseOrders];

    filterInputs.forEach(input => {
        const val = input.value.toLowerCase();
        const colKey = input.dataset.column;

        if (val) {
            filteredData = filteredData.filter(row => {
                const cellValue = (editedOrders[row.so] && editedOrders[row.so][colKey] !== undefined)
                    ? String(editedOrders[row.so][colKey])
                    : String(row[colKey] || '');
                return cellValue.toLowerCase().includes(val);
            });
        }
    });

    populateTableRows(filteredData);
}

// --- 8. SHOW/HIDE COLUMN CONTROL MODULES ---
window.hideColumn = function(columnName) {
    if (columnName === 'so') {
        alert("The primary key 'SO' column cannot be hidden.");
        return;
    }
    activeColumns = activeColumns.filter(c => c !== columnName);
    if (!hiddenColumns.includes(columnName)) hiddenColumns.push(columnName);
    
    // NEW: Save to local storage under this user's name
    localStorage.setItem('hiddenColumns_' + currentUser.username, JSON.stringify(hiddenColumns));
    
    renderTableStructure();
};

function updateDropdownOptions() {
    const dropdown = document.getElementById('columnDropdown');
    
    // Add default option
    dropdown.innerHTML = '<option value="">+ add removed column</option>';
    
    // ADDED: The RESET option styled in red
    dropdown.innerHTML += '<option value="RESET" style="color: red; font-weight: bold;">RESET</option>';
    
    hiddenColumns.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        dropdown.appendChild(opt);
    });
}


document.getElementById('columnDropdown').addEventListener('change', (e) => {
    const chosenCol = e.target.value;
    
    // --- PHASE 3: MASTER LAYOUT RESET ---
    if (chosenCol === "RESET") {
        hiddenColumns = [];
        activeColumns = [...ALL_COLUMNS]; 
        
        const userKey = currentUser ? currentUser.username : 'guest';
        
        // 1. Wipe Hidden Columns
        localStorage.removeItem('hiddenColumns_' + userKey);
        // 2. Wipe Resized Widths (System & Assignation)
        localStorage.removeItem('sys_cols_' + userKey);
        localStorage.removeItem('assign_cols_' + userKey);
        // 3. Wipe Column Ordering
        localStorage.removeItem('sys_order_' + userKey);
        localStorage.removeItem('assign_order_' + userKey);
        
        // Force reload original assignation columns
        ASSIGN_COLUMNS.length = 0;
        ASSIGN_COLUMNS.push("so", "date", "days", "status", "service_type", "address", "rout", "assigned_tech", "model", "remark", "status_comment", "part_1", "qty_1", "part_2", "qty_2", "part_3", "qty_3");

        renderTableStructure(); 
        if (assignationPage.classList.contains('active')) renderAssignationTable();
        
        e.target.value = ""; 
        alert("Layout reset to factory defaults.");
        return; 
    }

    if (chosenCol) {
        hiddenColumns = hiddenColumns.filter(c => c !== chosenCol);
        activeColumns.push(chosenCol);
        localStorage.setItem('hiddenColumns_' + (currentUser ? currentUser.username : 'guest'), JSON.stringify(hiddenColumns));
        renderTableStructure();
    }
});

// --- 9. INLINE CHANGES SUBMISSION ---
document.getElementById('systemSubmitBtn').addEventListener('click', async () => {
    const recordsToUpdate = Object.values(editedOrders);
    if (recordsToUpdate.length === 0) {
        alert("No changes detected to submit.");
        return;
    }

    // CHANGED: onConflict uses lowercase 'so'
    const { error } = await supabaseClient
        .from('orders')
        .upsert(recordsToUpdate, { onConflict: 'so' });

    if (error) {
        alert("Failed to submit updates: " + error.message);
    } else {
        alert("Database successfully synchronized!");
        loadDatabaseData(); 
    }
});

// --- WIPE ENTIRE SYSTEM LOGIC ---
document.getElementById('btnWipeSystem').addEventListener('click', async () => {
    
    // 1. Check Permissions (You mentioned possibly changing this later)
    const allowedRoles = ['coordinator', 'supervisor', 'manager']; 
    if (!currentUser || !allowedRoles.includes(currentUser.role)) {
        alert("Access Denied: Your account role does not have permission to wipe the database.");
        return;
    }

    // 2. Strict Confirmation Sequence
    const firstConfirm = confirm("⚠️ CRITICAL WARNING: You are about to DELETE ALL DATA in the system (Orders and Logs). This cannot be undone. Are you absolutely sure?");
    if (!firstConfirm) return;
    
    const secondConfirm = prompt("To confirm total deletion, type the word 'DELETE' in all capital letters:");
    if (secondConfirm !== "DELETE") {
        alert("Wipe aborted. Your data is safe.");
        return;
    }

    // 3. Execution: Delete dependencies first (repair_log), then parent table (orders)
    
    // Step A: Wipe repair_log
    const { error: logError } = await supabaseClient
        .from('repair_log')
        .delete()
        .neq('so', '0'); // Dummy filter required by Supabase to allow mass deletion

    if (logError) {
        alert("Failed to wipe repair_log table: " + logError.message);
        return; // Stop here so we don't try to delete orders if logs failed
    }

    // Step B: Wipe orders
    const { error: ordersError } = await supabaseClient
        .from('orders')
        .delete()
        .neq('so', '0'); 

    if (ordersError) {
        alert("Logs were wiped, but failed to wipe orders table: " + ordersError.message);
        return;
    }

    // 4. Reset User Interface
    alert("System successfully wiped. All data has been permanently deleted.");
    loadDatabaseData(); // Fetch the now-empty database to update the view
});

// --- 10. CSV PARSING (WITH PAPAPARSE) ---
document.getElementById('csvUploadBtn').addEventListener('click', () => {
    document.getElementById('csvFileInput').click();
});

document.getElementById('csvFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        processCSVText(text);
    };
    reader.readAsText(file);
});

function processCSVText(text) {
    Papa.parse(text, {
        header: true, 
        skipEmptyLines: true,
        complete: function(results) {
            const data = results.data;
            
            data.forEach(csvRow => {
                let rowObj = {};
                
                for (const [csvHeader, csvValue] of Object.entries(csvRow)) {
                    // Clean invisible characters from the CSV header
                    const cleanHeader = csvHeader.replace(/["\r]/g, '').trim();
                    
                    // If the CSV column matches one of our active columns, keep it
                    if (ALL_COLUMNS.includes(cleanHeader)) {
                        let finalValue = csvValue ? String(csvValue).trim() : '';
                        
                        // Strip the leading apostrophe from Excel phone numbers so the leading zero stays
                        if (finalValue.startsWith("'")) {
                            finalValue = finalValue.substring(1);
                        }
                        
                        rowObj[cleanHeader] = finalValue;
                    }
                }

                // Stage the row so the Submit button detects it as an edit/addition
                if (rowObj.so) {
                    if (!editedOrders[rowObj.so]) {
                        editedOrders[rowObj.so] = {};
                    }
                    editedOrders[rowObj.so] = { ...editedOrders[rowObj.so], ...rowObj };
                }
            });

            alert("CSV uploaded successfully! Click 'Submit' to sync these orders to the database.");
            renderTableStructure();
            document.getElementById('csvFileInput').value = '';
        },
        error: function(err) {
            alert("Error reading CSV file: " + err.message);
        }
    });
}

// --- NEW FEATURE: ADD ORDER FROM CLIPBOARD ---
document.getElementById('clipboardUploadBtn').addEventListener('click', async () => {
    try {
        // Request permission and read the clipboard
        const text = await navigator.clipboard.readText();
        if (!text || text.trim() === '') {
            alert("Your clipboard is empty.");
            return;
        }

        // Use PapaParse to read the raw text without expecting column headers
        Papa.parse(text, {
            header: false, // We are mapping raw data, not looking for headers
            skipEmptyLines: true,
            complete: function(results) {
                const data = results.data;
                let addedCount = 0;

                data.forEach(rowArray => {
                    let rowObj = {};
                    
                    // Map the raw clipboard values to your system's ALL_COLUMNS sequence
                    rowArray.forEach((val, index) => {
                        if (ALL_COLUMNS[index]) {
                            rowObj[ALL_COLUMNS[index]] = val ? String(val).trim() : '';
                        }
                    });

                    // Ensure the row has an 'so' before adding it
                    if (rowObj.so) {
                        // Stage it in memory so the Submit button sees it as a new edit
                        if (!editedOrders[rowObj.so]) {
                            editedOrders[rowObj.so] = {};
                        }
                        editedOrders[rowObj.so] = { ...editedOrders[rowObj.so], ...rowObj };
                        addedCount++;
                        
                        // Push it visually to the top of the table
                        const existingIndex = databaseOrders.findIndex(o => String(o.so) === String(rowObj.so));
                        if (existingIndex === -1) {
                            databaseOrders.unshift(rowObj); 
                        } else {
                            // If it exists, update the visual data
                            databaseOrders[existingIndex] = { ...databaseOrders[existingIndex], ...rowObj };
                        }
                    }
                });

                if (addedCount > 0) {
                    alert(`${addedCount} order(s) staged from clipboard! Click 'Submit' to push to the database.`);
                    renderTableStructure(); // Redraw the table to show the new rows
                } else {
                    alert("No valid Service Orders (SO) found in the clipboard data.");
                }
            },
            error: function(err) {
                alert("Error parsing clipboard data: " + err.message);
            }
        });
    } catch (err) {
        alert("Clipboard access failed. Please ensure you allow browser clipboard permissions. Error: " + err.message);
    }
});


// --- NEW FEATURE: NEW BLANK ORDER ---
document.getElementById('newBlankOrderBtn').addEventListener('click', () => {
    // 1. Force the user to declare the primary key upfront
    const newSO = prompt("Enter the unique Service Order (SO) number for this new blank order:");
    
    if (!newSO || newSO.trim() === '') {
        alert("Action canceled. A unique SO number is required to create a new order.");
        return;
    }

    const cleanSO = newSO.trim();

    // 2. Protect the database by checking if this SO already exists locally
    const existingOrder = databaseOrders.find(o => String(o.so) === cleanSO);
    if (existingOrder || editedOrders[cleanSO]) {
        alert(`Error: SO "${cleanSO}" already exists in the system. Primary keys must be unique.`);
        return;
    }

    // 3. Generate a completely blank row mapped to your exact columns
    const blankOrder = { so: cleanSO };
    
    ALL_COLUMNS.forEach(col => {
        if (col !== 'so') {
            blankOrder[col] = '';
        }
    });

    // 4. Stage it in memory for the final database submission
    editedOrders[cleanSO] = { ...blankOrder };
    
    // 5. Inject it at the very top of the visual table
    databaseOrders.unshift(blankOrder);
    
    // 6. Redraw the UI
    renderTableStructure();
});

function sortColumn(colKey) {
    // Toggle sort direction between ascending and descending
    const currentDir = sortDirection[colKey] === 'asc' ? 'desc' : 'asc';
    sortDirection = { [colKey]: currentDir }; // Reset other tracking, prioritize this one

    databaseOrders.sort((a, b) => {
        let valA = (editedOrders[a.so] && editedOrders[a.so][colKey] !== undefined) ? editedOrders[a.so][colKey] : (a[colKey] || '');
        let valB = (editedOrders[b.so] && editedOrders[b.so][colKey] !== undefined) ? editedOrders[b.so][colKey] : (b[colKey] || '');

        // 1. DATA TYPE: DAYS (Treat strictly as numbers)
        if (colKey === 'days') {
            return currentDir === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
        }

        // 2. DATA TYPE: DATE (Convert dd/mm/yy format to computer-readable time)
        if (colKey === 'date' && valA && valB) {
            const partsA = valA.split('/');
            const partsB = valB.split('/');
            // Assumes 20yy for the year part
            const dateA = new Date(`20${partsA[2]}`, partsA[1] - 1, partsA[0]);
            const dateB = new Date(`20${partsB[2]}`, partsB[1] - 1, partsB[0]);
            return currentDir === 'asc' ? dateA - dateB : dateB - dateA;
        }

        // 3. DATA TYPE: DEFAULT TEXT STRINGS
        return currentDir === 'asc' 
            ? String(valA).localeCompare(String(valB)) 
            : String(valB).localeCompare(String(valA));
    });

    populateTableRows(databaseOrders);
}

// 1. Sync typing from the Master Edit Box back into the active table cell instantly
document.getElementById('masterValueInput').addEventListener('input', (e) => {
    if (activeInputTarget) {
        // Send the value directly to the original cell in the table layout
        activeInputTarget.value = e.target.value;
        
        // Trigger the original cell's internal input event so it saves to the workspace memory
        activeInputTarget.dispatchEvent(new Event('input', { bubbles: true }));
    }
});



// --- 12. MONITOR ENGINE AND DATA INTERSECTION LOGIC ---
async function loadMonitorDataEngine() {
    // 1. Fetch main rows from the orders table
    const { data: mainOrders, error: orderErr } = await supabaseClient.from('orders').select('*');
    // 2. Fetch logistical columns from tracking table
    const { data: trackRows, error: trackErr } = await supabaseClient.from(MONITOR_TABLE_NAME).select('*');

    if (orderErr) {
        alert("Error loading orders data: " + orderErr.message);
        return;
    }
    
    databaseOrders = mainOrders || [];
    monitorTrackingRows = trackRows || [];

    calculateStatusMetrics();
}

let currentFilteredMonitorRows = [];

document.getElementById('monitorFilterDateBtn').addEventListener('click', () => {
    const startDateVal = document.getElementById('monitorStartDate').value;
    const endDateVal = document.getElementById('monitorEndDate').value;

    if (!startDateVal || !endDateVal) {
        alert("Please select both a start and end date.");
        return;
    }

    const start = new Date(startDateVal);
    const end = new Date(endDateVal);
    end.setHours(23, 59, 59, 999); 
    
    currentFilteredMonitorRows = monitorTrackingRows.filter(row => {
        if (!row.assign_date) return false;
        const parts = row.assign_date.split('-');
        if (parts.length !== 3) return false;
        
        const rowDate = new Date(parts[2], parts[1] - 1, parts[0]);
        return rowDate >= start && rowDate <= end;
    });

    calculateStatusMetrics(currentFilteredMonitorRows);
    document.getElementById('monitorTableArea').style.display = 'none';
});

document.getElementById('monitorClearDateBtn').addEventListener('click', () => {
    document.getElementById('monitorStartDate').value = '';
    document.getElementById('monitorEndDate').value = '';
    currentFilteredMonitorRows = [...monitorTrackingRows];
    calculateStatusMetrics(currentFilteredMonitorRows);
    document.getElementById('monitorTableArea').style.display = 'none';
});

// UPDATED: Calculates both Status counts AND Technician counts
function calculateStatusMetrics(dataToProcess = monitorTrackingRows) {
    const statusList = document.getElementById('statusMetricsList');
    const techList = document.getElementById('technicianMetricsList');
    
    statusList.innerHTML = '';
    techList.innerHTML = '';

    let statusCounts = { "All Tracking Logs": dataToProcess.length };
    let techCounts = {};

    dataToProcess.forEach(row => {
        // Status Tally
        let statusName = row.status ? row.status.trim() : 'Unknown';
        if (statusName === '') statusName = 'Unknown';
        statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;

        // Technician Tally (Tracks by assigned_tech)
        let techName = row.assigned_tech ? row.assigned_tech.trim() : '';
        if (techName) {
            techCounts[techName] = (techCounts[techName] || 0) + 1;
        }
    });

    // Render Status Buttons
    for (const [statusName, totalCount] of Object.entries(statusCounts)) {
        const li = document.createElement('li');
        li.className = 'monitor-filter-item'; // Tag for CSS manipulation
        li.innerHTML = `<span>${statusName}</span> <span style="background: var(--border-color); padding: 2px 8px; border-radius: 10px; font-size: 12px;">${totalCount}</span>`;
        li.addEventListener('click', () => {
            document.querySelectorAll('.monitor-filter-item').forEach(el => el.classList.remove('active-monitor-btn'));
            li.classList.add('active-monitor-btn');
            renderMonitorTable('status', statusName, dataToProcess);
        });
        statusList.appendChild(li);
    }

    // Render Technician Buttons
    for (const [techName, totalCount] of Object.entries(techCounts)) {
        const li = document.createElement('li');
        li.className = 'monitor-filter-item'; // Tag for CSS manipulation
        li.innerHTML = `<span>${techName}</span> <span style="background: var(--border-color); padding: 2px 8px; border-radius: 10px; font-size: 12px;">${totalCount}</span>`;
        li.addEventListener('click', () => {
            document.querySelectorAll('.monitor-filter-item').forEach(el => el.classList.remove('active-monitor-btn'));
            li.classList.add('active-monitor-btn');
            renderMonitorTable('technician', techName, dataToProcess);
        });
        techList.appendChild(li);
    }
}

// NEW UNIFIED RENDERER: Handles both Status and Technician views in strictly Read-Only mode
function renderMonitorTable(viewType, targetValue, dataPool = monitorTrackingRows) {
    const headerEl = document.getElementById('activeMonitorStatusHeader');
    const tableArea = document.getElementById('monitorTableArea');
    const badgesArea = document.getElementById('technicianBadges');
    const tbody = document.getElementById('monitorTableBody');
    const theadRow = document.getElementById('monitorHeaderRow');
    
    tableArea.style.display = 'block';
    badgesArea.style.display = 'none'; // Hidden by default
    tbody.innerHTML = '';
    theadRow.innerHTML = '';

    let rowsToRender = [];

    // 1. FILTER DATA BASED ON VIEW TYPE
    if (viewType === 'status') {
        headerEl.textContent = `Status View: ${targetValue}`;
        rowsToRender = targetValue === "All Tracking Logs" 
            ? dataPool 
            : dataPool.filter(r => (r.status || 'Unknown').trim() === targetValue || (targetValue === 'Unknown' && !r.status));
    } else if (viewType === 'technician') {
        headerEl.textContent = `Technician View: ${targetValue}`;
        // Filters based on your rule: matches assigned_by OR assigned_tech
        rowsToRender = dataPool.filter(r => 
            (r.assigned_by && r.assigned_by.trim() === targetValue) || 
            (r.assigned_tech && r.assigned_tech.trim() === targetValue)
        );
    }

    // 2. DEFINE COLUMNS (Added 'assigned_by' to table to help trace origin)
    const columnsConfig = [
        { key: 'so', label: 'SO', source: 'main' },
        { key: 'assign_date', label: 'Assign Date', source: 'track' },
        { key: 'assign_time', label: 'Assign Time', source: 'track' },
        { key: 'status', label: 'Status', source: 'track' }, 
        { key: 'days', label: 'Days', source: 'main' },
        { key: 'rout', label: 'Rout', source: 'main' },
        { key: 'assigned_by', label: 'Assigned By', source: 'track' },
        { key: 'assigned_tech', label: 'Assigned Tech', source: 'track' },
        { key: 'end_tech', label: 'End Tech', source: 'track' },
        { key: 'end_coord', label: 'End Coord', source: 'track' },
        { key: 'collected', label: 'Collected', source: 'track' },
        { key: 'comment', label: 'Comment', source: 'track' }
    ];

    // 3. BUILD HEADERS DYNAMICALLY
    columnsConfig.forEach(cfg => {
        const th = document.createElement('th');
        th.textContent = cfg.label;
        theadRow.appendChild(th);
    });

    // Tracking Variables for Technician Badges
    let totalCollected = 0;
    let countHass = 0;
    let countSmartThings = 0;
    let countFinished = 0;

    // 4. BUILD ROWS (Strictly Read-Only)
    rowsToRender.forEach(trackingMatch => {
        const tr = document.createElement('tr');
        const currentSO = trackingMatch.so;
        const orderMatch = databaseOrders.find(o => String(o.so) === String(currentSO)) || {};

        columnsConfig.forEach(cfg => {
            const td = document.createElement('td');
            let val = cfg.source === 'main' ? orderMatch[cfg.key] : trackingMatch[cfg.key];
            
            td.textContent = val || '';
            td.style.padding = "10px";
            tr.appendChild(td);
        });
        tbody.appendChild(tr);

        // 5. CALCULATE BADGES (Only matters if viewType is technician)
        if (viewType === 'technician') {
            totalCollected += (Number(trackingMatch.collected) || 0);
            if (trackingMatch.hass && String(trackingMatch.hass).trim() !== '') countHass++;
            if (trackingMatch.smart_things && String(trackingMatch.smart_things).toLowerCase() === 'yes') countSmartThings++;
            if (trackingMatch.end_tech && trackingMatch.end_tech.trim() === targetValue) countFinished++;
        }
    });

    // 6. RENDER BADGES (If Technician View)
    if (viewType === 'technician') {
        badgesArea.style.display = 'flex';
        badgesArea.innerHTML = `
            <div style="background: var(--btn-bg); padding: 10px 15px; border-radius: 5px; border: 1px solid var(--border-color); font-weight: bold;">
                💰 Collected: <span style="font-size: 1.2em; color: var(--text-color);">${totalCollected}</span>
            </div>
            <div style="background: var(--btn-bg); padding: 10px 15px; border-radius: 5px; border: 1px solid var(--border-color); font-weight: bold;">
                🔌 Hass: <span style="font-size: 1.2em; color: var(--text-color);">${countHass}</span>
            </div>
            <div style="background: var(--btn-bg); padding: 10px 15px; border-radius: 5px; border: 1px solid var(--border-color); font-weight: bold;">
                📱 Smart Things: <span style="font-size: 1.2em; color: var(--text-color);">${countSmartThings}</span>
            </div>
            <div style="background: var(--btn-bg); padding: 10px 15px; border-radius: 5px; border: 1px solid var(--border-color); font-weight: bold;">
                ✅ Finished Orders: <span style="font-size: 1.2em; color: var(--text-color);">${countFinished}</span>
            </div>
        `;
    }

    // 7. FIRE RESIZER ENGINE
    applyResizableColumns('monitorDataTable', 'mon_cols');
}

// --- HUB & CLOSE BUTTONS ---
// Make sure we remove the old "unsaved changes" warning since it's read-only now
document.getElementById('monitorHubBtn').addEventListener('click', () => {
    document.getElementById('monitorTableArea').style.display = 'none';
    document.getElementById('activeMonitorStatusHeader').textContent = 'Select a Status or Technician from the Left';
    monitorPage.classList.remove('active');
    menuPage.classList.add('active');
});

document.getElementById('closeMonitorTableBtn').addEventListener('click', () => {
    document.getElementById('monitorTableArea').style.display = 'none';
    document.getElementById('activeMonitorStatusHeader').textContent = 'Select a Status or Technician from the Left';
});


// --- ASSIGNATION ENGINE ---

document.getElementById('btnFetchBatchSo').addEventListener('click', () => {
    const rawText = document.getElementById('batchSoInput').value;
    // Split by comma or newline and clean up spaces
    const soList = rawText.split(/[\n,]+/).map(s => s.trim()).filter(s => s);
    fetchOrdersForAssignation(soList);
});



async function fetchOrdersForAssignation(soArray) {
    if (soArray.length === 0) return;

    // 1. Fetch main order details from the 'orders' table
    const { data: ordersData, error: ordersError } = await supabaseClient
        .from('orders')
        .select('*')
        .in('so', soArray);
        
    console.log("Supabase returned:", ordersData, "Error:", ordersError);
    
    if (ordersError) {
        alert("Error fetching orders: " + ordersError.message);
        return;
    }

    // 2. Prepare data using the assigned_tech directly from the orders table
    ordersData.forEach(order => {
        // Clean up the word 'EMPTY' if it accidentally got saved to the database previously
        const existingTech = (order.assigned_tech === 'EMPTY' ? '' : order.assigned_tech) || '';

        if (!editedAssignations[order.so]) {
            // Store the order in memory with the tech we just pulled from the orders table
            editedAssignations[order.so] = { ...order, assigned_tech: existingTech };
        } else {
             // If the row is already on the screen but the user hasn't typed a new tech yet, 
             // update it with what the database currently has
             if(!editedAssignations[order.so].assigned_tech) {
                 editedAssignations[order.so].assigned_tech = existingTech;
             }
        }
    });

    // 3. Merge new fetches with existing ones in the view
    const newSOs = ordersData.map(d => d.so);
    assignationOrders = [...assignationOrders.filter(o => !newSOs.includes(o.so)), ...ordersData];
    
    renderAssignationTable();
    document.getElementById('batchSoInput').value = '';
}

let assignationSortDir = {};

function renderAssignationTable(dataToRender = assignationOrders) {

    // --- NEW: DYNAMIC DATALISTS FOR SERVICE_TYPE AND ROUT ---
    const uniqueServiceTypes = new Set();
    const uniqueRouts = new Set();

    dataToRender.forEach(row => {
        const st = (editedAssignations[row.so] && editedAssignations[row.so]['service_type'] !== undefined) ? editedAssignations[row.so]['service_type'] : row['service_type'];
        if (st && String(st).trim() !== '') uniqueServiceTypes.add(String(st).trim());

        const rt = (editedAssignations[row.so] && editedAssignations[row.so]['rout'] !== undefined) ? editedAssignations[row.so]['rout'] : row['rout'];
        if (rt && String(rt).trim() !== '') uniqueRouts.add(String(rt).trim());
    });

    const stList = document.getElementById('serviceTypeList');
    const rtList = document.getElementById('routList');
    if (stList) {
        stList.innerHTML = '';
        uniqueServiceTypes.forEach(val => stList.appendChild(new Option(val, val)));
    }
    if (rtList) {
        rtList.innerHTML = '';
        uniqueRouts.forEach(val => rtList.appendChild(new Option(val, val)));
    }
    // --------------------------------------------------------


    const headerRow = document.getElementById('assignHeaderRow');
    const filterRow = document.getElementById('assignFilterRow');
    const tbody = document.getElementById('assignTableBody');
    
    // BUG FIX: Only build the headers and filter inputs if they are empty!
    // This stops the input box from being destroyed while you are actively typing in it.
    if (headerRow.children.length === 0) {

        // --- Add empty header cells for the checkbox column ---
        const checkHeader = document.createElement('th');
        checkHeader.textContent = "Select";
        headerRow.appendChild(checkHeader);
        
        const checkFilter = document.createElement('th');
        filterRow.appendChild(checkFilter);
        // --- end of Add empty header cells for the checkbox column ---


        ASSIGN_COLUMNS.forEach(colKey => {
            // 1. Header with Sorting capability
            const th = document.createElement('th');
            const displayName = colKey === 'so' ? 'SO' : colKey;
            th.innerHTML = `
                <div class="header-wrapper" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <button class="move-arrow left-arrow" title="Move Left" style="display: none; background: transparent; border: none; cursor: pointer; font-size: 16px;">◀</button>
                    <div style="display: flex; justify-content: center; align-items: center; flex-grow: 1;">
                        <span class="sort-header" style="cursor:pointer;">${displayName}</span>
                    </div>
                    <button class="move-arrow right-arrow" title="Move Right" style="display: none; background: transparent; border: none; cursor: pointer; font-size: 16px;">▶</button>
                </div>
            `;
            
            th.querySelector('.sort-header').addEventListener('click', () => {
                sortAssignationColumn(colKey);
            });
            headerRow.appendChild(th);

            // 2. Filter Input Box (Creates empty dropdowns structure)
            const filterTd = document.createElement('th');
            const filterSelect = document.createElement('select');
            filterSelect.dataset.column = colKey;
            filterSelect.addEventListener('change', runAssignationFilters);
            filterTd.appendChild(filterSelect);
            filterRow.appendChild(filterTd);
        });

        attachClickMoveLogic('assignHeaderRow', ASSIGN_COLUMNS, 'assign_order', () => {
            document.getElementById('assignHeaderRow').innerHTML = ''; // Force header redraw
            document.getElementById('assignFilterRow').innerHTML = ''; // Force filter redraw
            renderAssignationTable();
        });
    }

    // --- REFRESH DROPDOWN OPTIONS EVERY TIME DATA IS FETCHED ---
    const allFilterDropdowns = document.querySelectorAll('#assignFilterRow select');
    allFilterDropdowns.forEach(select => {
        const colKey = select.dataset.column;
        const currentSelection = select.value; // Save what the user has currently selected

        select.innerHTML = `<option value="">-- All --</option>`;
        
        const uniqueValues = new Set();
        assignationOrders.forEach(row => {
            let val = (editedAssignations[row.so] && editedAssignations[row.so][colKey] !== undefined) 
                ? editedAssignations[row.so][colKey] 
                : row[colKey];
            
            if (val !== null && val !== undefined && String(val).trim() !== '') {
                uniqueValues.add(String(val).trim());
            }
        });

        Array.from(uniqueValues).sort().forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        });

        // Restore the selection if they were currently filtering
        select.value = currentSelection;
    });
    // ------------------------------------------------------------

    // Only wipe the body, leaving the headers intact
    tbody.innerHTML = '';

    // Build Rows
    dataToRender.forEach(row => {
        const tr = document.createElement('tr');
        const currentSO = row.so;

        // --- NEW: Inject the Checkbox Cell ---
        const checkTd = document.createElement('td');
        checkTd.style.textAlign = 'center';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.width = 'auto'; 
        checkbox.checked = selectedAssignationOrders.has(currentSO);
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedAssignationOrders.add(currentSO);
            } else {
                selectedAssignationOrders.delete(currentSO);
            }
        });
        checkTd.appendChild(checkbox);
        tr.appendChild(checkTd);
        // --- end of Inject the Checkbox Cell ---

        ASSIGN_COLUMNS.forEach(colKey => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            
            let currentValue = (editedAssignations[currentSO] && editedAssignations[currentSO][colKey] !== undefined) 
                ? editedAssignations[currentSO][colKey] 
                : (row[colKey] || '');

            input.value = currentValue;

            // Datalist Hookup for Technician
            if (colKey === 'assigned_tech') {
                input.setAttribute('list', 'technicianList');
                input.setAttribute('autocomplete', 'off'); 
                input.placeholder = "Select/Type Tech...";
                
                input.addEventListener('change', (e) => {
                    const val = e.target.value.trim();
                    const lowerTechs = availableTechnicians.map(t => t.toLowerCase());
                    if (val && !lowerTechs.includes(val.toLowerCase())) {
                        alert(`Warning: '${val}' is not in the recognized technicians list.`);
                    }
                });
            } else if (colKey === 'service_type') {
                input.setAttribute('list', 'serviceTypeList');
                input.setAttribute('autocomplete', 'off'); 
            } else if (colKey === 'rout') {
                input.setAttribute('list', 'routList');
                input.setAttribute('autocomplete', 'off'); 
            }

            input.addEventListener('input', (e) => {
                if (!editedAssignations[currentSO]) {
                    editedAssignations[currentSO] = { ...row };
                }
                editedAssignations[currentSO][colKey] = e.target.value;
            });

            // Triple click copy
            input.addEventListener('click', (e) => {
                if (e.detail === 3) {
                    navigator.clipboard.writeText(e.target.value)
                        .catch(err => console.error("Clipboard copy failed: ", err));
                }
            });

            input.addEventListener('input', (e) => {
                if (!editedAssignations[currentSO]) {
                    editedAssignations[currentSO] = { ...row };
                }
                editedAssignations[currentSO][colKey] = e.target.value;
            });

            // --- UPDATED: Active Tracking & Highlighting ---
            input.addEventListener('focus', (e) => {
                activeInputTarget = e.target; 
                
                // 1. VISUAL HIGHLIGHTING
                // Clear existing highlights from the whole table first
                const allRows = document.querySelectorAll('#assignTableBody tr');
                allRows.forEach(r => {
                    r.style.backgroundColor = ''; // Reset row
                    r.querySelectorAll('input').forEach(i => i.style.backgroundColor = ''); // Reset cells
                });

                // Apply darker background to the active row, and even darker to the active input
                // Using rgba with black lets it blend nicely over your dark/greenish themes
                tr.style.backgroundColor = 'rgba(0, 0, 0, 0.05)'; 
                e.target.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';

                // 2. MASTER EDIT CONTAINER UPDATES
                const masterSOKey = document.getElementById('assignMasterSOKey');
                const masterHeaderLabel = document.getElementById('assignMasterHeaderLabel');
                const masterValueInput = document.getElementById('assignMasterValueInput');

                if (masterSOKey && masterHeaderLabel && masterValueInput) {
                    
                    // Pull current data (checking edited memory first, then the base row)
                    const orderData = editedAssignations[currentSO] || row;
                    const rout = orderData.rout || 'N/A';
                    const model = orderData.model || 'N/A';
                    const address = orderData.address || 'N/A';

                    // Inject the rich tracking string 
                    masterSOKey.innerHTML = `<span style="color: var(--text-color); opacity: 0.7;">SO:</span> ${currentSO} &nbsp;|&nbsp; <span style="color: var(--text-color); opacity: 0.7;">Route:</span> ${rout} &nbsp;|&nbsp; <span style="color: var(--text-color); opacity: 0.7;">Model:</span> ${model} &nbsp;|&nbsp; <span style="color: var(--text-color); opacity: 0.7;">Address:</span> ${address}`;
                    
                    // Update label and show input
                    masterHeaderLabel.innerHTML = `&nbsp;&nbsp;<strong>▶ Editing [${colKey === 'so' ? 'SO' : colKey}]:</strong> `;
                    
                    masterValueInput.value = e.target.value;
                    masterValueInput.style.display = 'inline-block';
                }
            });
            // --- END UPDATED BLOCK ---

            td.appendChild(input);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    // Fire resizer for assignation page table 
    applyResizableColumns('assignationTable', 'assign_cols');
}

// --- FILTERING FOR ASSIGNATION PAGE ---
function runAssignationFilters() {
    const filterInputs = document.querySelectorAll('#assignFilterRow select');
    let filteredData = [...assignationOrders];

    filterInputs.forEach(input => {
        const val = input.value.toLowerCase();
        const colKey = input.dataset.column;

        if (val) {
            filteredData = filteredData.filter(row => {
                const cellValue = (editedAssignations[row.so] && editedAssignations[row.so][colKey] !== undefined)
                    ? String(editedAssignations[row.so][colKey])
                    : String(row[colKey] || '');
                return cellValue.toLowerCase().includes(val);
            });
        }
    });

    renderAssignationTable(filteredData);
}

// --- SORTING FOR ASSIGNATION PAGE ---
function sortAssignationColumn(colKey) {
    const currentDir = assignationSortDir[colKey] === 'asc' ? 'desc' : 'asc';
    assignationSortDir = { [colKey]: currentDir }; 

    assignationOrders.sort((a, b) => {
        let valA = (editedAssignations[a.so] && editedAssignations[a.so][colKey] !== undefined) ? editedAssignations[a.so][colKey] : (a[colKey] || '');
        let valB = (editedAssignations[b.so] && editedAssignations[b.so][colKey] !== undefined) ? editedAssignations[b.so][colKey] : (b[colKey] || '');

        if (colKey === 'days') {
            return currentDir === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
        }

        if (colKey === 'date' && valA && valB) {
            const partsA = valA.split('/');
            const partsB = valB.split('/');
            if(partsA.length === 3 && partsB.length === 3) {
                const dateA = new Date(`20${partsA[2]}`, partsA[1] - 1, partsA[0]);
                const dateB = new Date(`20${partsB[2]}`, partsB[1] - 1, partsB[0]);
                return currentDir === 'asc' ? dateA - dateB : dateB - dateA;
            }
        }

        return currentDir === 'asc' 
            ? String(valA).localeCompare(String(valB)) 
            : String(valB).localeCompare(String(valA));
    });

    // Run filters after sorting so we don't accidentally un-filter the list
    runAssignationFilters();
}




// --- ASSIGNATION SUBMISSION LOGIC ---
document.getElementById('assignSubmitBtn').addEventListener('click', async () => {
    const recordsToProcess = Object.values(editedAssignations);
    if (recordsToProcess.length === 0) {
        alert("No assignations to submit.");
        return;
    }

    // Grab the exact current moment
    const now = new Date();

    // 1. Calculate Today's Date (DD-MM-YYYY)
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const targetDate = `${dd}-${mm}-${yyyy}`;

    // 2. Calculate Current Time (HH:MM)
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const targetTime = `${hh}:${min}`;
    
    // 1. Prepare payload for 'orders' table
    const ordersPayload = recordsToProcess.map(record => {
        let orderUpdate = {};
        for (let key in record) {
            if (ALL_COLUMNS.includes(key)) {
                orderUpdate[key] = record[key];
            }
        }
        return orderUpdate;
    });

   // Prepare payload for 'repair_log' table
    const repairLogPayload = recordsToProcess.map(record => ({
        so: record.so,
        assigned_tech: record.assigned_tech || '',
        assigned_by: currentUser ? currentUser.username : 'Unknown',
        assign_date: targetDate,
        assign_time: targetTime,
        status: "Technician" // <--- ADD THIS LINE HERE
    }));

    // Execute Orders Update
    const { error: orderErr } = await supabaseClient
        .from('orders')
        .upsert(ordersPayload, { onConflict: 'so' });

    if (orderErr) {
        alert("Failed to update orders: " + orderErr.message);
        return;
    }

    // Execute Repair Log Update
    // Changed to .insert() so it creates a new log entry every time, 
    // allowing multiple assignments for the same SO on the same day.
    const { error: logErr } = await supabaseClient
        .from('repair_log')
        .insert(repairLogPayload);

    if (logErr) {
        alert("Orders updated, but failed to sync repair log: " + logErr.message);
    } else {
        alert("Assignations successfully submitted to your technicians!");
        assignationOrders = [];
        editedAssignations = {};
        renderAssignationTable(); // Clear view
    }
});

// --- ASSIGNATION PAGE: MASTER EDIT ENGINE ---

// 1. Sync typing from the Master Edit Box back into the assignation table cell
const assignMasterInput = document.getElementById('assignMasterValueInput');
if (assignMasterInput) {
    assignMasterInput.addEventListener('input', (e) => {
        if (activeInputTarget) {
            // Update the visual cell
            activeInputTarget.value = e.target.value;
            
            // Trigger the internal input event so it saves to editedAssignations memory
            activeInputTarget.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
}

// --- UNIFIED MASTER EDIT CLICK TRACKER ---
// Clears tracking details only when clicking completely away from BOTH tables and containers
document.addEventListener('click', (e) => {
    // System Page Elements
    const sysBody = document.getElementById('tableBody');
    const sysContainer = document.getElementById('masterEditContainer');

    // Assignation Page Elements
    const assignBody = document.getElementById('assignTableBody');
    const assignContainer = document.getElementById('assignMasterEditContainer');

    // Check if the click happened inside either of our active work zones
    const clickedInSystem = (sysBody && sysBody.contains(e.target)) || (sysContainer && sysContainer.contains(e.target));
    const clickedInAssign = (assignBody && assignBody.contains(e.target)) || (assignContainer && assignContainer.contains(e.target));

    // If the user clicked outside of BOTH work zones, wipe everything clean
    if (!clickedInSystem && !clickedInAssign) {
         // Wipe System View UI
         const sysKey = document.getElementById('masterSOKey');
         const sysLabel = document.getElementById('masterHeaderLabel');
         const sysVal = document.getElementById('masterValueInput');
         if (sysKey && sysLabel && sysVal) { 
             sysKey.textContent = ''; 
             sysLabel.textContent = ''; 
             sysVal.value = ''; 
             sysVal.style.display = 'none'; 
         }

         // Wipe Assignation View UI
         const assignKey = document.getElementById('assignMasterSOKey');
         const assignLabel = document.getElementById('assignMasterHeaderLabel');
         const assignVal = document.getElementById('assignMasterValueInput');
         if (assignKey && assignLabel && assignVal) { 
             assignKey.textContent = ''; 
             assignLabel.textContent = ''; 
             assignVal.value = ''; 
             assignVal.style.display = 'none'; 
         }

         // Hide the new action buttons
         const actionButtons = document.getElementById('masterActionButtons');
         if (actionButtons) actionButtons.style.display = 'none';
         // Safely clear the tracking target
         activeInputTarget = null;
    }
});

// --- SYSTEM PAGE: MASTER ACTION BUTTONS LOGIC ---

// Helper function to format today's date and time for the database
function getCurrentDateTime() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return { date: `${dd}-${mm}-${yyyy}`, time: `${hh}:${min}` };
}

// Action 1: Agree (Coord)
document.getElementById('btnAgreeCoord').addEventListener('click', async () => {
    const activeSo = document.getElementById('masterActionButtons').dataset.activeSo;
    if (!activeSo) return;

    const { date, time } = getCurrentDateTime();
    const currentUsername = currentUser ? currentUser.username : 'Unknown';

    const payload = {
        so: activeSo,
        status: 'Technician',
        assigned_by: currentUsername,
        agree_coord: currentUsername,
        assign_date: date,
        assign_time: time,
        assigned_tech: '' // <-- ADD THIS LINE to satisfy the database constraint
    };

    const { error } = await supabaseClient.from('repair_log').insert(payload);

    if (error) {
        alert("Error saving record: " + error.message);
    } else {
        alert(`Coordination agreement logged for SO: ${activeSo}`);
    }
});

// Action 2 (Part 1): Show the Tech Dropdown
document.getElementById('btnCompleteTech').addEventListener('click', async () => {
    const dropdown = document.getElementById('masterTechDropdown');
    const confirmBtn = document.getElementById('btnSubmitTechAssign');
    
    // If we haven't loaded technicians yet on this page, fetch them from Supabase
    if (availableTechnicians.length === 0) {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('username')
            .ilike('role', '%technician%'); 
        
        if (data && !error) {
            availableTechnicians = data.map(d => d.username);
        }
    }

    // Fill the dropdown options
    dropdown.innerHTML = '<option value="">-- Select Tech --</option>';
    availableTechnicians.forEach(tech => {
        const opt = document.createElement('option');
        opt.value = tech;
        opt.textContent = tech;
        dropdown.appendChild(opt);
    });

    // Reveal the dropdown and the final submit button
    dropdown.style.display = 'inline-block';
    confirmBtn.style.display = 'inline-block';
});

// Action 2 (Part 2): Confirm Assignment and Insert Database Record
document.getElementById('btnSubmitTechAssign').addEventListener('click', async () => {
    const activeSo = document.getElementById('masterActionButtons').dataset.activeSo;
    const selectedTech = document.getElementById('masterTechDropdown').value;

    if (!activeSo) return;
    if (!selectedTech) {
        alert("Please select a technician from the dropdown list first.");
        return;
    }

    const { date, time } = getCurrentDateTime();
    const currentUsername = currentUser ? currentUser.username : 'Unknown';

    const payload = {
        so: activeSo,
        status: 'Complete',
        assigned_by: currentUsername,
        complete_coord: currentUsername,
        end_tech: selectedTech,
        assigned_tech: selectedTech, // <-- ADD THIS LINE to satisfy the database constraint
        assign_date: date,
        assign_time: time
    };

    const { error } = await supabaseClient.from('repair_log').insert(payload);

    if (error) {
        alert("Error assigning tech: " + error.message);
    } else {
        alert(`SO: ${activeSo} successfully assigned to ${selectedTech}`);
        
        // Hide the dropdown elements to clean up the UI
        document.getElementById('masterTechDropdown').style.display = 'none';
        document.getElementById('btnSubmitTechAssign').style.display = 'none';
        document.getElementById('masterTechDropdown').value = '';
    }
});


// ==========================================
// --- BONUSES / PERFORMANCE TRACKING PAGE ---
// ==========================================

const bonusesPage = document.getElementById('bonusesPage');

// Set dates to First of Current Month and Today
function setBonusesDefaultDates() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Format to YYYY-MM-DD for standard HTML date inputs
    const formatInputDate = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    document.getElementById('bonusesStartDate').value = formatInputDate(firstDay);
    document.getElementById('bonusesEndDate').value = formatInputDate(now);
}

// Navigation Listeners
document.getElementById('btnBonuses').addEventListener('click', () => {
    menuPage.classList.remove('active');
    bonusesPage.classList.add('active');
    setBonusesDefaultDates();
    loadBonusesData(); // Auto-load data for the current month when opened
});

document.getElementById('bonusesHubBtn').addEventListener('click', () => {
    bonusesPage.classList.remove('active');
    menuPage.classList.add('active');
});

document.getElementById('btnFetchBonuses').addEventListener('click', loadBonusesData);

// Main Fetch and Filter Engine
async function loadBonusesData() {
    const startDateVal = document.getElementById('bonusesStartDate').value;
    const endDateVal = document.getElementById('bonusesEndDate').value;

    if (!startDateVal || !endDateVal) {
        alert("Please ensure both a start and end date are selected.");
        return;
    }

    const startLimit = new Date(startDateVal);
    startLimit.setHours(0, 0, 0, 0);
    const endLimit = new Date(endDateVal);
    endLimit.setHours(23, 59, 59, 999); 

    const { data, error } = await supabaseClient.from(MONITOR_TABLE_NAME).select('*');
    
    if (error) {
        alert("Error loading bonuses data: " + error.message);
        return;
    }

    const currentName = currentUser ? currentUser.username : '';
    
    // 1. DYNAMIC COLUMN TRACKING
    // Every column in the table that could potentially hold a staff member's name
    const nameColumns = [
        'assigned_by', 'agree_coord', 'complete_coord', 
        'assigned_tech', 'end_tech', 'hass', 'smart_things'
    ];
    
    let summaryCounts = {};
    nameColumns.forEach(col => summaryCounts[col] = 0);

    // 2. FILTER & COUNT ENGINE
    const filteredRows = data.filter(row => {
        if (!row.assign_date) return false;
        const parts = row.assign_date.split('-');
        if (parts.length !== 3) return false;
        const rowDate = new Date(parts[2], parts[1] - 1, parts[0]);
        
        if (rowDate < startLimit || rowDate > endLimit) return false;

        let userWasInvolved = false;
        
        nameColumns.forEach(colKey => {
            if (row[colKey] && String(row[colKey]).trim() === currentName) {
                userWasInvolved = true;
                summaryCounts[colKey]++; 
            }
        });

        // The row is kept if their name appeared in AT LEAST one of those columns
        return userWasInvolved; 
    });

    renderBonusesData(filteredRows, summaryCounts);
}

// Render the UI
function renderBonusesData(rows, counts) {
    // 1. RENDER SUMMARY BOXES
    const summaryContent = document.getElementById('bonusesSummaryContent');
    summaryContent.innerHTML = '';
    
    Object.entries(counts).forEach(([colName, totalCount]) => {
        // HIDE ZEROES: If the count is 0, skip building this box entirely
        if (totalCount === 0) return; 

        const cleanName = colName.replace('_', ' ').toUpperCase();
        
        const box = document.createElement('div');
        box.style.cssText = "background: var(--btn-bg); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; align-items: center; min-width: 120px; flex-grow: 1;";
        
        // DARKER FONTS: Changed colors to #333 and #000 with maximum font-weight
        box.innerHTML = `
            <span style="font-size: 11px; color: #333; margin-bottom: 5px; font-weight: 900; letter-spacing: 1px;">${cleanName}</span>
            <span style="font-size: 24px; font-weight: 900; color: #000;">${totalCount}</span>
        `;
        summaryContent.appendChild(box);
    });

    // 2. RENDER TABLE DATA
    const tbody = document.getElementById('bonusesTableBody');
    tbody.innerHTML = '';
    
    const columnsToDisplay = [
        'so', 'assign_date', 'assign_time', 'status', 'assigned_by', 
        'agree_coord', 'complete_coord', 'assigned_tech', 'end_tech', 
        'hass', 'smart_things', 'comment', 'collected'
    ];

    rows.forEach(row => {
        const tr = document.createElement('tr');
        
        columnsToDisplay.forEach(col => {
            const td = document.createElement('td');
            const cellValue = row[col] ? String(row[col]) : '';
            td.textContent = cellValue;
            
            if (cellValue.trim() === (currentUser ? currentUser.username : '')) {
                td.style.fontWeight = "bold";
                td.style.color = "#4caf50"; 
            }
            
            tr.appendChild(td);
        });
        
        tbody.appendChild(tr);
    });
}


// --- My orders - TECHNICIAN PAGE LOGIC ---

let activeTechTicket = null; // Keeps track of the currently opened order

async function loadActiveTickets() {
    if (!currentUser) return;

    // --- COORDINATOR ROUTE as they have different pool of tickets ---
    if (currentUser.role.includes('coordinator')) {
        document.getElementById('ticketContainer').innerHTML = "<h3 style='text-align:center;'>Loading Back Office Pool...</h3>";
        try {
            // Fetch directly from orders table where status is back_office
            const { data, error } = await supabaseClient
                .from('orders')
                .select('*')
                .eq('status', 'back_office');

            if (error) throw error;

            if (!data || data.length === 0) {
                document.getElementById('ticketContainer').innerHTML = "<h3 style='text-align:center;'>No orders in the Back Office pool! 🎉</h3>";
                return;
            }

            // Sort by Days (Highest first)
            data.sort((a, b) => Number(b.days || 0) - Number(a.days || 0));
            renderTickets(data);
        } catch (err) {
            alert("Error loading coordinator tickets: " + err.message);
        }
        return; // Stop here, so it doesn't run the Technician code below
    }
    // ---------end of COORDINATOR ROUTE------------

    // ---TECHNICIAN ROUTE ---
    if (!navigator.onLine) {
        loadTicketsFromVault();
        return; 
    }

    try {
        document.getElementById('ticketContainer').innerHTML = "<h3 style='text-align:center;'>Loading tickets...</h3>";

        const { data: logs, error: logErr } = await supabaseClient.from('repair_log').select('*');
        if (logErr) throw logErr;

        logs.sort((a, b) => {
            const parseDate = (d) => d ? d.split('-').reverse().join('-') : '1970-01-01';
            const timeA = new Date(`${parseDate(a.assign_date)}T${a.assign_time || '00:00'}`);
            const timeB = new Date(`${parseDate(b.assign_date)}T${b.assign_time || '00:00'}`);
            return timeB - timeA; 
        });

        const latestLogs = {};
        logs.forEach(log => {
            if (!latestLogs[log.so]) latestLogs[log.so] = log;
        });

        const myTicketSOs = Object.values(latestLogs)
            .filter(log => log.status === 'Technician' && log.assigned_tech === currentUser.username)
            .map(log => log.so);

        if (myTicketSOs.length === 0) {
            document.getElementById('ticketContainer').innerHTML = "<h3 style='text-align:center;'>You have no active orders! 🎉</h3>";
            if (localDB) {
                const transaction = localDB.transaction('inbox', 'readwrite');
                const store = transaction.objectStore('inbox');
                store.put({ id: 'latest_tickets', tickets: [] });
            }
            return;
        }

        const { data: ordersData, error: orderErr } = await supabaseClient
            .from('orders')
            .select('*')
            .in('so', myTicketSOs);

        if (orderErr) throw orderErr;

        ordersData.sort((a, b) => Number(b.days || 0) - Number(a.days || 0));

        if (localDB) {
            const transaction = localDB.transaction('inbox', 'readwrite');
            const store = transaction.objectStore('inbox');
            store.put({ id: 'latest_tickets', tickets: ordersData });
            console.log("Offline snapshot successfully updated!");
        }

        renderTickets(ordersData);

    } catch (err) {
        console.error('Network request failed, falling back to Vault:', err);
        loadTicketsFromVault();
    }
}

function renderTickets(tickets) {
    const container = document.getElementById('ticketContainer');
    container.innerHTML = '';

    try {
        tickets.forEach(ticket => {
            const card = document.createElement('div');
            card.className = 'ticket-card';
            
            // ARMORED: We use String() to force numbers into text so .replace() never crashes!
            const safePhone1 = ticket.phone ? String(ticket.phone).replace(/\s+/g, '') : '';
            const safePhone2 = ticket.phone_2 ? String(ticket.phone_2).replace(/\s+/g, '') : '';

            const p1 = ticket.phone ? `<a class="phone-link" href="tel:${safePhone1}">📞 ${ticket.phone}</a>` : 'N/A';
            const p2 = ticket.phone_2 ? `<a class="phone-link" href="tel:${safePhone2}">📞 ${ticket.phone_2}</a>` : 'N/A';

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

            card.innerHTML = `
                <div class="ticket-header">
                    <span>SO: ${ticket.so}</span>
                    <span style="color:#ffb300;">Days: ${ticket.days || 0}</span>
                </div>
                <div class="ticket-row"><span>Name: ${ticket.name || 'N/A'}</span> <span>${p1}</span></div>
                <div class="ticket-row"><span>Date: ${ticket.date || 'N/A'}</span> <span>${p2}</span></div>
                <div class="ticket-row" style="margin-top: 5px;"><strong>Address:</strong> ${ticket.address || 'N/A'}</div>
                <div class="ticket-row"><span><strong>Model:</strong> ${ticket.model || 'N/A'}</span> <span><strong>SN:</strong> ${ticket.serial || 'N/A'}</span></div>
                ${partsHtml}
                <button class="details-btn">Details & Action</button>
            `;

            card.querySelector('.details-btn').addEventListener('click', () => openDetailsModal(ticket));
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
const reasonSelect = document.getElementById('reasonSelect');
const commentInput = document.getElementById('commentInput');
const confirmTechBtn = document.getElementById('confirmTechBtn');

// Helper to generate the Download or Greyed-out link
function renderMediaLink(elementId, url, label) {
    const el = document.getElementById(elementId);
    if (url && url.trim() !== '') {
        el.innerHTML = `<a href="${url}" target="_blank" style="color: #1976d2; font-weight: bold; text-decoration: underline;">📥 ${label}</a>`;
    } else {
        el.innerHTML = `<span style="color: #9e9e9e; text-decoration: line-through;">${label}</span>`;
    }
}

function openDetailsModal(ticket) {
    activeTechTicket = ticket;
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
    
    // 1. Render Media Links (Shared for both roles)
    renderMediaLink('linkImg1', ticket.img1, 'Img 1');
    renderMediaLink('linkImg2', ticket.img2, 'Img 2');
    renderMediaLink('linkImg3', ticket.img3, 'Img 3');
    renderMediaLink('linkVid1', ticket.vid1, 'Vid 1');
    renderMediaLink('linkVid2', ticket.vid2, 'Vid 2');
    renderMediaLink('linkVid3', ticket.vid3, 'Vid 3');

    // --- Generate Clickable Phone Links for Modal ---
    const safePhone1 = ticket.phone ? String(ticket.phone).replace(/\s+/g, '') : '';
    const safePhone2 = ticket.phone_2 ? String(ticket.phone_2).replace(/\s+/g, '') : '';
    const p1 = ticket.phone ? `<a class="phone-link" href="tel:${safePhone1}">📞 ${ticket.phone}</a>` : 'N/A';
    const p2 = ticket.phone_2 ? `<a class="phone-link" href="tel:${safePhone2}">📞 ${ticket.phone_2}</a>` : 'N/A';
    // -------------------------------------------------

    // 2. Populate Read-Only Details
    document.getElementById('modalReadOnlyDetails').innerHTML = `
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
        <strong>Route:</strong> ${ticket.rout || 'N/A'}<br>
        <strong>I/O:</strong> ${ticket.io || 'N/A'}<br>
        <strong>Parts:</strong> ${ticket.part_1||''} (x${ticket.qty_1||0}), ${ticket.part_2||''} (x${ticket.qty_2||0})<br>
        <strong>Call Details:</strong> ${ticket.call_details || 'N/A'}
    `;

    // 3. ROLE-BASED UI TOGGLE
    if (currentUser.role.includes('coordinator')) {
        // Hide Tech Zone
        document.getElementById('techActionSection').style.display = 'none';
        document.getElementById('confirmTechBtn').style.display = 'none';
        
        // Show Coordinator Zone & History Zone
        document.getElementById('coordActionSection').style.display = 'block';
        document.getElementById('coordHistorySection').style.display = 'block';
        
        const confirmCoordBtn = document.getElementById('confirmCoordBtn');
        confirmCoordBtn.style.display = 'block';
        
        // --- NEW: FETCH TICKET HISTORY FROM REPAIR_LOG ---
        document.getElementById('lastPushedByValue').textContent = 'Loading...';
        document.getElementById('coordCommentsList').innerHTML = '<span style="color: gray;">Loading comments...</span>';

        supabaseClient.from('repair_log')
            .select('*')
            .eq('so', ticket.so)
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

                // Sort logs newest-first so the most recent events are at the top
                logs.sort((a, b) => {
                    const parseDate = (d) => d ? d.split('-').reverse().join('-') : '1970-01-01';
                    const timeA = new Date(`${parseDate(a.assign_date)}T${a.assign_time || '00:00'}`);
                    const timeB = new Date(`${parseDate(b.assign_date)}T${b.assign_time || '00:00'}`);
                    return timeB - timeA; 
                });

                // 1. Find who last pushed this to back_office
                const backOfficeLogs = logs.filter(l => l.status === 'back_office');
                if (backOfficeLogs.length > 0) {
                    const latestPush = backOfficeLogs[0]; // First item is the newest
                    document.getElementById('lastPushedByValue').textContent = `${latestPush.assigned_by || 'Unknown'} (on ${latestPush.assign_date} at ${latestPush.assign_time})`;
                } else {
                    document.getElementById('lastPushedByValue').textContent = 'N/A';
                }

                // 2. Extract and format all comments
                const commentLogs = logs.filter(l => l.comment && l.comment.trim() !== '');
                const commentsContainer = document.getElementById('coordCommentsList');
                commentsContainer.innerHTML = '';

                if (commentLogs.length > 0) {
                    commentLogs.forEach(log => {
                        const div = document.createElement('div');
                        div.style.padding = '8px';
                        div.style.background = 'var(--bg-color)';
                        div.style.border = '1px solid var(--border-color)';
                        div.style.borderRadius = '4px';
                        div.innerHTML = `
                            <strong style="color: #4caf50;">${log.assigned_by || 'Unknown'}</strong> 
                            <span style="font-size: 11px; opacity: 0.7;">(${log.assign_date} at ${log.assign_time}):</span><br>
                            <span style="margin-top: 4px; display: inline-block;">${log.comment}</span>
                        `;
                        commentsContainer.appendChild(div);
                    });
                } else {
                    commentsContainer.innerHTML = '<span style="color: gray;">No comments recorded yet.</span>';
                }
            });
        // -------------------------------------------------

        // Reset Coord Form
        document.getElementById('coordStatusSelect').value = '';
        confirmCoordBtn.disabled = true;
        confirmCoordBtn.textContent = 'Confirm (Coord) 🔒';

    } else {
        // Show Tech Zone
        document.getElementById('techActionSection').style.display = 'block';
        document.getElementById('confirmTechBtn').style.display = 'block';
        
        // Hide Coordinator Zone & History Zone
        document.getElementById('coordActionSection').style.display = 'none';
        document.getElementById('coordHistorySection').style.display = 'none'; // NEW
        document.getElementById('confirmCoordBtn').style.display = 'none';

        // Execute original Tech form reset
        collectedInput.value = '';
        reasonSelect.value = '';
        commentInput.value = '';
        document.getElementById('smartThingsCheck').checked = false;
        document.getElementById('hassCheck').checked = false
        // --- Reset the Warranty Checkbox ---
        document.getElementById('warrantyCheck').checked = false;

        reasonGroup.style.display = 'none';

        document.querySelectorAll('.media-grid input[type="file"]').forEach(input => {
            input.value = ''; 
            const labelBtn = input.parentElement;
            labelBtn.style.backgroundColor = ''; 
            labelBtn.style.color = ''; 
            if (labelBtn.childNodes[0].nodeValue) {
                const originalIcon = input.accept.includes('video') ? '📹' : '📷';
                labelBtn.childNodes[0].nodeValue = labelBtn.childNodes[0].nodeValue.replace('✅', originalIcon);
            }
        });
        validateTechForm(); 
    }

    detailsModal.style.display = 'flex';
}

// Close Triggers
document.getElementById('closeModalBtn').addEventListener('click', () => detailsModal.style.display = 'none');
document.getElementById('cancelModalBtn').addEventListener('click', () => detailsModal.style.display = 'none');

// --- MEDIA BUTTON VISUAL FEEDBACK (FIXED) ---
document.querySelectorAll('.media-grid input[type="file"]').forEach(input => {
    input.addEventListener('change', function() {
        // Find the label that wraps this specific input
        const labelBtn = this.parentElement; 
        
        if (this.files && this.files.length > 0) {
            // A file was selected! Change color safely
            labelBtn.style.backgroundColor = '#2e7d32'; // Green
            labelBtn.style.color = 'white';
            
            // Safely update ONLY the text node (child 0), leaving the hidden input untouched
            if (labelBtn.childNodes[0].nodeValue) {
                labelBtn.childNodes[0].nodeValue = labelBtn.childNodes[0].nodeValue.replace('📷', '✅').replace('📹', '✅');
            }
        } else {
            // They cancelled the selection, revert it safely
            labelBtn.style.backgroundColor = '';
            labelBtn.style.color = '';
            
            if (labelBtn.childNodes[0].nodeValue) {
                labelBtn.childNodes[0].nodeValue = labelBtn.childNodes[0].nodeValue.replace('✅', this.accept.includes('video') ? '📹' : '📷');
            }
        }
    });
});

// Validation Logic Gate
function validateTechForm() {
    const money = parseFloat(collectedInput.value) || 0;
    const reason = reasonSelect.value;
    const comment = commentInput.value.trim();
    const isWarranty = document.getElementById('warrantyCheck').checked;

    // Show Reason Dropdown if money is collected OR warranty is checked
    if (money > 0 || isWarranty) {
        reasonGroup.style.display = 'flex';
    } else {
        reasonGroup.style.display = 'none';
        reasonSelect.value = ''; // Clear it if neither is active
    }

    // 1. Comment is ALWAYS the master key (must not be empty)
    const isCommentValid = comment !== '';

    // 2. Financial Rule: If money is greater than 0, they MUST pick a reason.
    // If money is 0, this rule automatically passes.
    let isFinancialValid = true;
    if (money > 0 && reason === '') {
        isFinancialValid = false; 
    }

    // BOTH conditions must be met to unlock the confirm button
    if (isCommentValid && isFinancialValid) {
        confirmTechBtn.disabled = false;
        confirmTechBtn.textContent = 'Confirm ✅';
    } else {
        confirmTechBtn.disabled = true;
        confirmTechBtn.textContent = 'Confirm 🔒';
    }
}

// Listen for typing/changes to run the validation gate instantly
collectedInput.addEventListener('input', validateTechForm);
reasonSelect.addEventListener('change', validateTechForm);
commentInput.addEventListener('input', validateTechForm);
// Listen for clicks on the Warranty box!
document.getElementById('warrantyCheck').addEventListener('change', validateTechForm);


// Submit Button Action
confirmTechBtn.addEventListener('click', async () => {
    if (!activeTechTicket) return;

    // Lock button to prevent double-clicks and update text to show progress
    confirmTechBtn.disabled = true;
    confirmTechBtn.textContent = 'Uploading Media...';

    // 1. Grab files from inputs
    const fileImg1 = document.getElementById('img1Input').files[0];
    const fileImg2 = document.getElementById('img2Input').files[0];
    const fileImg3 = document.getElementById('img3Input').files[0];
    const fileVid1 = document.getElementById('vid1Input').files[0];
    const fileVid2 = document.getElementById('vid2Input').files[0];
    const fileVid3 = document.getElementById('vid3Input').files[0];

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
            assign_date: `${dd}-${mm}-${yyyy}`,
            assign_time: `${hh}:${min}`,
            smart_things: document.getElementById('smartThingsCheck').checked ? 'yes' : '',
            hass: document.getElementById('hassCheck').checked ? 'yes' : '',
            collected: collectedInput.value || '0',
            collected_reason: reasonSelect.value || '',
            comment: commentInput.value.trim()
        };

        // Package the raw File objects and text into one bundle
        const offlineBundle = {
            so: activeTechTicket.so,
            timestamp: Date.now(), // Helps us upload the oldest tickets first later
            textData: textData,
            files: { img1: fileImg1, img2: fileImg2, img3: fileImg3, vid1: fileVid1, vid2: fileVid2, vid3: fileVid3 }
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
                
                loadActiveTickets(); // Redraws the UI (the ticket is now gone!)
            };
        }
        return; // CRITICAL: Stop the function here so it doesn't try to upload to Supabase!
    }
    // -------------------------------------------


    // --- 4. EXISTING ONLINE SEQUENCE ---
    // Upload sequentially, updating the UI for each existing file
    let urlImg1 = '', urlImg2 = '', urlImg3 = '', urlVid1 = '', urlVid2 = '', urlVid3 = '';

    if (fileImg1) {
        setProgressLine('step-img1', 'Uploading Img 1');
        urlImg1 = await uploadMediaToSupabase(fileImg1, activeTechTicket.so, 'img1');
        setProgressLine('step-img1', 'Img 1 Complete', true);
    }
    if (fileImg2) {
        setProgressLine('step-img2', 'Uploading Img 2');
        urlImg2 = await uploadMediaToSupabase(fileImg2, activeTechTicket.so, 'img2');
        setProgressLine('step-img2', 'Img 2 Complete', true);
    }
    if (fileImg3) {
        setProgressLine('step-img3', 'Uploading Img 3');
        urlImg3 = await uploadMediaToSupabase(fileImg3, activeTechTicket.so, 'img3');
        setProgressLine('step-img3', 'Img 3 Complete', true);
    }
    if (fileVid1) {
        setProgressLine('step-vid1', 'Uploading Vid 1 (This may take a moment)');
        urlVid1 = await uploadMediaToSupabase(fileVid1, activeTechTicket.so, 'vid1');
        setProgressLine('step-vid1', 'Vid 1 Complete', true);
    }
    if (fileVid2) {
        setProgressLine('step-vid2', 'Uploading Vid 2');
        urlVid2 = await uploadMediaToSupabase(fileVid2, activeTechTicket.so, 'vid2');
        setProgressLine('step-vid2', 'Vid 2 Complete', true);
    }
    if (fileVid3) {
        setProgressLine('step-vid3', 'Uploading Vid 3');
        urlVid3 = await uploadMediaToSupabase(fileVid3, activeTechTicket.so, 'vid3');
        setProgressLine('step-vid3', 'Vid 3 Complete', true);
    }

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
        assign_date: `${dd}-${mm}-${yyyy}`,
        assign_time: `${hh}:${min}`,
        smart_things: document.getElementById('smartThingsCheck').checked ? 'yes' : '',
        hass: document.getElementById('hassCheck').checked ? 'yes' : '',
        collected: collectedInput.value || '0',
        collected_reason: reasonSelect.value || '',
        comment: commentInput.value.trim(),
        
        img1: urlImg1, img2: urlImg2, img3: urlImg3,
        vid1: urlVid1, vid2: urlVid2, vid3: urlVid3
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
            img1: urlImg1, img2: urlImg2, img3: urlImg3,
            vid1: urlVid1, vid2: urlVid2, vid3: urlVid3
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
    loadActiveTickets(); 
});


// --- COORDINATOR MODAL LOGIC ---
const coordStatusSelect = document.getElementById('coordStatusSelect');
const confirmCoordBtn = document.getElementById('confirmCoordBtn');

// Unlock button when a status is chosen
coordStatusSelect.addEventListener('change', () => {
    if (coordStatusSelect.value !== '') {
        confirmCoordBtn.disabled = false;
        confirmCoordBtn.textContent = 'Confirm Action ✅';
    } else {
        confirmCoordBtn.disabled = true;
        confirmCoordBtn.textContent = 'Confirm (Coord) 🔒';
    }
});

// Submit Coord Changes
confirmCoordBtn.addEventListener('click', async () => {
    if (!activeTechTicket || !coordStatusSelect.value) return;

    // Lock button to prevent double-clicks
    confirmCoordBtn.disabled = true;
    confirmCoordBtn.textContent = 'Processing...';

    const newStatus = coordStatusSelect.value;
    
    // Calculate timestamp
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');

    // 1. Log the action in repair_log
    const logPayload = {
        so: activeTechTicket.so,
        status: newStatus, // "Pending" or "Complete"
        assigned_by: currentUser.username, // Record who made the change
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
    const { error: orderErr } = await supabaseClient
        .from('orders')
        .update({ status: newStatus })
        .eq('so', activeTechTicket.so);

    if (orderErr) {
        alert("Action failed (Order Update Error): " + orderErr.message);
        confirmCoordBtn.disabled = false;
        confirmCoordBtn.textContent = 'Confirm Action ✅';
        return;
    }

    alert(`Success: Order ${activeTechTicket.so} has been moved to ${newStatus}!`);
    
    // Close modal and refresh the list (the ticket will vanish because status is no longer back_office)
    detailsModal.style.display = 'none';
    loadActiveTickets(); 
});



// --- MEDIA UPLOAD ENGINE ---

/**
 * Uploads a file to Supabase Storage and returns the public URL.
 * @param {File} fileObject - The actual image or video file from the input.
 * @param {string} soNumber - The Service Order number (used to organize files).
 * @param {string} fileTypeLabel - E.g., 'img1' or 'vid1' to keep names unique.
 */
async function uploadMediaToSupabase(fileObject, soNumber, fileTypeLabel) {
    console.log(`Preparing to upload ${fileTypeLabel}... Does the file exist?`, fileObject);

    // 1. Safety check
    if (!fileObject) return '';

    const fileExtension = fileObject.name.split('.').pop();

    // 2. Build the exact Date & Time strings
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');

    // Using a dash (-) instead of a colon (:) so Windows computers don't crash if you download the file later!
    const formattedDate = `${dd}-${mm}-${yyyy}`;
    const formattedTime = `${hh}-${min}`;

    // 3. Create the requested file name: e.g., "4258163256img1_07-07-2026_04-18.jpg"
    const uniqueFileName = `${soNumber}${fileTypeLabel}_${formattedDate}_${formattedTime}.${fileExtension}`;

    try {
        // 4. Send the file to the 'repair_media' bucket in Supabase
        const { data, error } = await supabaseClient
            .storage
            .from('repair_media')
            .upload(uniqueFileName, fileObject);

        if (error) {
            console.error(`Upload failed for ${fileTypeLabel}:`, error);
            alert(`Upload blocked by Supabase for ${fileTypeLabel}: ` + error.message);
            return '';
        }

        // 5. If upload succeeds, ask Supabase for the direct public web link
        const { data: publicUrlData } = supabaseClient
            .storage
            .from('repair_media')
            .getPublicUrl(uniqueFileName);

        return publicUrlData.publicUrl;

    } catch (err) {
        console.error("Unexpected error during upload:", err);
        return '';
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

            // A. Upload the media (the function automatically skips if the file is missing)
            const urlImg1 = await uploadMediaToSupabase(bundle.files.img1, bundle.so, 'img1');
            const urlImg2 = await uploadMediaToSupabase(bundle.files.img2, bundle.so, 'img2');
            const urlImg3 = await uploadMediaToSupabase(bundle.files.img3, bundle.so, 'img3');
            const urlVid1 = await uploadMediaToSupabase(bundle.files.vid1, bundle.so, 'vid1');
            const urlVid2 = await uploadMediaToSupabase(bundle.files.vid2, bundle.so, 'vid2');
            const urlVid3 = await uploadMediaToSupabase(bundle.files.vid3, bundle.so, 'vid3');

            // B. Attach the generated URLs to the text payload we saved earlier
            const finalLogPayload = {
                ...bundle.textData,
                img1: urlImg1, img2: urlImg2, img3: urlImg3,
                vid1: urlVid1, vid2: urlVid2, vid3: urlVid3
            };

            // C. Push the combined data to the repair_log table
            const { error: logErr } = await supabaseClient.from('repair_log').insert(finalLogPayload);
            if (logErr) {
                console.error("Failed to sync log for " + bundle.so, logErr);
                continue; // Skip deleting this ticket so we can try syncing it again later!
            }

            // D. Push the status change to the orders table
            const { error: orderErr } = await supabaseClient.from('orders')
                .update({ 
                    status: 'back_office',
                    img1: urlImg1, img2: urlImg2, img3: urlImg3,
                    vid1: urlVid1, vid2: urlVid2, vid3: urlVid3
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


// --- DOWNLOAD SELECTED BUTTON LOGIC ---
document.getElementById('btnDownloadSelected').addEventListener('click', () => {
    if (selectedSystemOrders.size === 0) {
        alert("Please select at least one order to download.");
        return;
    }

    let fileContent = "";

    selectedSystemOrders.forEach(so => {
        // Find the most up-to-date version of this row (checking edits first)
        const activeRow = editedOrders[so] || databaseOrders.find(o => String(o.so) === String(so));
        
        if (activeRow) {
            // Map the active columns to their values, joined by a tab space
            const rowString = activeColumns.map(col => activeRow[col] || '').join('\t');
            fileContent += rowString + "\n===========================\n";
        }
    });

    // Create a downloadable text file inside the browser
    const blob = new Blob([fileContent], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Orders_Export_${new Date().getTime()}.txt`;
    
    // Simulate a click to force the download, then clean up
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// --- DELETE SELECTED BUTTON LOGIC ---
document.getElementById('btnDeleteSelected').addEventListener('click', async () => {
    if (selectedSystemOrders.size === 0) {
        alert("Please select at least one order to delete.");
        return;
    }

    if (!confirm(`Are you sure you want to permanently delete ${selectedSystemOrders.size} selected order(s)?`)) {
        return;
    }

    const soArray = Array.from(selectedSystemOrders);

    // Delete from Supabase
    const { error } = await supabaseClient
        .from('orders')
        .delete()
        .in('so', soArray);

    if (error) {
        alert("Failed to delete orders: " + error.message);
    } else {
        alert("Successfully deleted selected orders.");
        
        // Wipe the memory and refresh the table
        selectedSystemOrders.clear();
        editedOrders = {}; // Clear pending edits so deleted items don't resurrect
        loadDatabaseData(); 
    }
});

// --- REMOVE SELECTED FROM ASSIGNATION VIEW ---
document.getElementById('assignRemoveSelectedBtn').addEventListener('click', () => {
    if (selectedAssignationOrders.size === 0) {
        alert("Please select at least one order to remove from the view.");
        return;
    }

    // Filter out the selected SOs from the array and clean up memory
    assignationOrders = assignationOrders.filter(o => !selectedAssignationOrders.has(o.so));
    selectedAssignationOrders.forEach(so => delete editedAssignations[so]);
    
    // Clear the selections and redraw the table
    selectedAssignationOrders.clear();
    renderAssignationTable();
});

// --- DOWNLOAD SELECTED FULL DATA (ORDERS FORMAT) ---
document.getElementById('assignDownloadSelectedBtn').addEventListener('click', () => {
    if (selectedAssignationOrders.size === 0) {
        alert("Please select at least one order to download.");
        return;
    }

    let fileContent = "";

    selectedAssignationOrders.forEach(so => {
        // Fetch the base row from the assignation array (which holds all orders data from the fetch)
        const baseRow = assignationOrders.find(o => String(o.so) === String(so)) || {};
        // Overlay any live edits
        const activeRow = { ...baseRow, ...(editedAssignations[so] || {}) };
        
        if (activeRow && activeRow.so) {
            // Use ALL_COLUMNS to export the complete data profile, just like the System page
            const rowString = ALL_COLUMNS.map(col => activeRow[col] || '').join('\t');
            fileContent += rowString + "\n===========================\n";
        }
    });

    const blob = new Blob([fileContent], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Assignation_Data_Export_${new Date().getTime()}.txt`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
// --- NEW PHASE 2: CLICK-TO-MOVE ARROWS ---
// ==========================================

function attachClickMoveLogic(headerRowId, colArray, storageKey, renderCallback) {
    const headerRow = document.getElementById(headerRowId);
    const headers = Array.from(headerRow.querySelectorAll('th')); 
    const skipCount = (headerRowId === 'headerRow' || headerRowId === 'assignHeaderRow') ? 1 : 0; // Skip checkbox column
    
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

// ==========================================
// --- PHASE 4: DYNAMIC EXPORT ENGINE ---
// ==========================================

// Helper: Formats the specific parts string request
function formatParts(row) {
    let partsArray = [];
    for (let i = 1; i <= 5; i++) {
        let part = (row[`part_${i}`] || '').trim();
        let qty = (row[`qty_${i}`] || '').trim();
        // Ignore "EMPTY" strings or actual empty fields
        if (part && part.toUpperCase() !== 'EMPTY') {
            partsArray.push(`${part} ${qty && qty.toUpperCase() !== 'EMPTY' ? qty : ''}`.trim());
        }
    }
    return partsArray.length > 0 ? partsArray.join('| ') + '|' : '';
}

// Reusable text export function for grouped Data
function downloadGroupedVisibleText(tableBodyId, memoryMap, allColsArray, filename) {
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody || tableBody.children.length === 0) {
        alert("No visible data to export.");
        return;
    }

    // 1. Gather visible SOs from DOM
    const visibleSOs = Array.from(tableBody.querySelectorAll('tr')).map(tr => {
        // Look up the row's SO based on the first active column (usually SO, but handles dynamic columns)
        const soInput = tr.querySelector('td:nth-child(2) input'); // nth-child(2) skips the checkbox td
        if(soInput) return soInput.value;
        return null;
    }).filter(val => val !== null);

    // 2. Organize data into groupings by Technician
    const groupedData = {};

    visibleSOs.forEach(so => {
        const rowData = memoryMap[so] || databaseOrders.find(o => String(o.so) === String(so)) || {};
        
        let tech = (rowData.assigned_tech || '').trim();
        if (tech === '' || tech.toUpperCase() === 'EMPTY') tech = 'Unassigned';

        if (!groupedData[tech]) groupedData[tech] = [];

        // Build the text line
        let lineCols = [];
        allColsArray.forEach(col => {
            // Exclude specified columns from export
            if (col === 'rout' || col === 'assigned_tech') return; 

            // If it's the start of the parts loop, inject the formatted parts string once
            if (col === 'part_1') {
                lineCols.push(formatParts(rowData));
            } 
            // Skip the rest of the raw part/qty columns since we aggregated them
            else if (col.startsWith('part_') || col.startsWith('qty_')) {
                return; 
            } else {
                lineCols.push(rowData[col] || '');
            }
        });
        
        groupedData[tech].push(lineCols.join('\t'));
    });

    // 3. Construct File Content
    let fileContent = "";
    Object.keys(groupedData).sort().forEach(tech => {
        fileContent += `${tech}\n--------------------\n`;
        groupedData[tech].forEach(line => {
            fileContent += line + "\n===========================\n";
        });
        fileContent += "\n";
    });

    // 4. Download
    const blob = new Blob([fileContent], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().getTime()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Bind System Export
document.getElementById('btnDownloadVisibleSystem').addEventListener('click', () => {
    const allowedRoles = ['coordinator', 'supervisor', 'manager']; 
    if (!currentUser || !allowedRoles.includes(currentUser.role)) {
        alert("Access Denied: You do not have permission to download grouped exports.");
        return;
    }
    downloadGroupedVisibleText('tableBody', editedOrders, ALL_COLUMNS, 'System_Visible_Export');
});

// Bind Assignation Export
document.getElementById('assignDownloadVisibleBtn').addEventListener('click', () => {
    const allowedRoles = ['coordinator', 'supervisor', 'manager']; 
    if (!currentUser || !allowedRoles.includes(currentUser.role)) {
        alert("Access Denied: You do not have permission to download grouped exports.");
        return;
    }
    downloadGroupedVisibleText('assignTableBody', editedAssignations, ALL_COLUMNS, 'Assignation_Visible_Export');
});

// Bind Monitor CSV Export (Using PapaParse)
document.getElementById('monitorDownloadCsvBtn').addEventListener('click', () => {
    const tbody = document.getElementById('monitorTableBody');
    if (!tbody || tbody.children.length === 0) {
        alert("No visible Monitor data to export.");
        return;
    }

    // Extract headers dynamically
    const headers = Array.from(document.querySelectorAll('#monitorHeaderRow th')).map(th => th.textContent);
    
    // Extract visible rows text
    const csvData = [];
    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
        const rowData = Array.from(tr.querySelectorAll('td')).map(td => td.textContent);
        csvData.push(rowData);
    });

    // Generate CSV string using your existing PapaParse dependency
    const csv = Papa.unparse({
        fields: headers,
        data: csvData
    });

    // Trigger Download
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Monitor_Export_${new Date().getTime()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});