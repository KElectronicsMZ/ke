// --- 1. SUPABASE CONNECTION CONFIGURATION ---
const SUPABASE_URL = "https://nltzapfwhuidmjlnjwgy.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_9uEZtAWURjryzdCaVwH2Eg_OaW1MmpC"; 

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 2. APPLICATION STATE CONFIGURATION ---
let activeInputTarget = null; // Tracks the currently selected table cell input
let sortDirection = {}; // Tracks if column is sorting 'asc' or 'desc'
let currentUser = null;
let databaseOrders = []; 
let editedOrders = {};    
let hiddenColumns = [];

// NEW TRACKING DATASETS FOR MONITOR SPLIT
let monitorTrackingRows = []; 
let editedMonitorRows = {};   
const MONITOR_TABLE_NAME = 'repair_log'; // Your secondary table name in Supabase

// CHANGED: 'SO' is now 'so' to match the database strict case rules
const ALL_COLUMNS = [
    "so", "created_by", "branch", "date", "days", "status", "reason", "name", 
    "phone", "phone_2", "phone_3", "address", "rout", "model", "serial", "io", "remark", 
    "status_comment", "change_log", "return", "part_1", "qty_1", "part_2", 
    "qty_2", "part_3", "qty_3", "part_4", "qty_4", "part_5", "qty_5",
    "call_details", "img1", "img2", "img3", "vid1", "vid2", "vid3",
    "end_tech", "end_coord", "collected", "history"
];
let activeColumns = [...ALL_COLUMNS];

// related to assignation page
let assignationOrders = [];
let availableTechnicians = [];
let editedAssignations = {};
const ASSIGN_COLUMNS = [
    "so", "date", "days", "status", "name", "phone", "address", "rout", 
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
    const savedHidden = localStorage.getItem('hiddenColumns_' + currentUser.username);
    if (savedHidden) {
        hiddenColumns = JSON.parse(savedHidden);
        activeColumns = ALL_COLUMNS.filter(col => !hiddenColumns.includes(col));
    } else {
        hiddenColumns = [];
        activeColumns = [...ALL_COLUMNS];
    }
    loginPage.classList.remove('active');
    menuPage.classList.add('active');
});

document.getElementById('loginCancelBtn').addEventListener('click', () => {
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
});

document.getElementById('menuCancelBtn').addEventListener('click', () => {
    hiddenColumns = [];
    activeColumns = [...ALL_COLUMNS];
    currentUser = null;
    menuPage.classList.remove('active');
    loginPage.classList.add('active');
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
});

document.getElementById('btnSystem').addEventListener('click', () => {
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
    const allowedRoles = ['Co-ordinator', 'Supervisor', 'Manager'];
    
    if (!currentUser || !allowedRoles.includes(currentUser.role)) {
        alert("Access Denied: Your account role does not have permission to view the Monitor page.");
        return;
    }

    menuPage.classList.remove('active');
    monitorPage.classList.add('active');
    loadMonitorDataEngine(); // Pull from both database tables
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
    renderAssignationTable();
});

document.getElementById('assignHubBtn').addEventListener('click', () => {
    if (Object.keys(editedAssignations).length > 0) {
        if (!confirm("Discard unsaved assignations?")) return;
    }
    assignationPage.classList.remove('active');
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

    activeColumns.forEach(colKey => {
        const th = document.createElement('th');
        const displayName = colKey === 'so' ? 'SO' : colKey;
        
        // Wrap the name in a clickable span for sorting
        th.innerHTML = `<span class="sort-header" style="cursor:pointer;">${displayName}</span> 
                        <button class="delete-col-btn" onclick="hideColumn('${colKey}')">-</button>`;
        
        // Add sorting click event listener
        th.querySelector('.sort-header').addEventListener('click', () => {
            sortColumn(colKey);
        });
        
        headerRow.appendChild(th);

        const filterTd = document.createElement('th');
        const filterInput = document.createElement('input');
        filterInput.placeholder = `Filter...`;
        filterInput.dataset.column = colKey;
        filterInput.addEventListener('input', runFilters);
        filterTd.appendChild(filterInput);
        filterRow.appendChild(filterTd);
    });

    populateTableRows(databaseOrders);
    updateDropdownOptions();
}

function populateTableRows(dataToDisplay) {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    dataToDisplay.forEach(row => {
        const tr = document.createElement('tr');
        const currentSO = row.so; // CHANGED to lowercase 'so'

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

            // ACTIVE TRACKING HEADER COMPONENT LINK
            // ACTIVE TRACKING HEADER COMPONENT LINK (Upgraded to look below the table)
            input.addEventListener('focus', (e) => {
                activeInputTarget = e.target; // Save this specific table cell input reference
                
                const masterSOKey = document.getElementById('masterSOKey');
                const masterHeaderLabel = document.getElementById('masterHeaderLabel');
                const masterValueInput = document.getElementById('masterValueInput');

                if (masterSOKey && masterHeaderLabel && masterValueInput) {
                    masterSOKey.textContent = `SO: (${currentSO}) - `;
                    masterHeaderLabel.textContent = `${colKey === 'so' ? 'SO' : colKey}: `;
                    
                    masterValueInput.value = e.target.value;
                    masterValueInput.style.display = 'inline-block'; // Show the text box
                }
            });

            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

// --- 7. FILTERING SYSTEM ---
function runFilters() {
    const filterInputs = document.querySelectorAll('#filterRow input');
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
    
    // NEW: Handle the RESET action
    if (chosenCol === "RESET") {
        hiddenColumns = []; // Clear hidden tracking
        activeColumns = [...ALL_COLUMNS]; // Restore all columns
        
        // Save the clean slate to the user's memory
        localStorage.setItem('hiddenColumns_' + currentUser.username, JSON.stringify(hiddenColumns));
        
        renderTableStructure(); // Redraw the table
        e.target.value = ""; // Reset the visual dropdown back to the top
        return; // Stop the function here
    }

    // Existing logic for adding a normal column back
    if (chosenCol) {
        hiddenColumns = hiddenColumns.filter(c => c !== chosenCol);
        activeColumns.push(chosenCol);
        activeColumns.sort((a, b) => ALL_COLUMNS.indexOf(a) - ALL_COLUMNS.indexOf(b));
        
        localStorage.setItem('hiddenColumns_' + currentUser.username, JSON.stringify(hiddenColumns));
        
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

// 2. Clear tracking details ONLY when clicking completely away from the table and the master container
document.addEventListener('click', (e) => {
    const tableBodyElement = document.getElementById('tableBody');
    const masterEditContainer = document.getElementById('masterEditContainer');
    
    // Check if the user clicked outside BOTH the table data cells AND the master text input field
    if (tableBodyElement && masterEditContainer && !tableBodyElement.contains(e.target) && !masterEditContainer.contains(e.target)) {
        const masterSOKey = document.getElementById('masterSOKey');
        const masterHeaderLabel = document.getElementById('masterHeaderLabel');
        const masterValueInput = document.getElementById('masterValueInput');
        
        if (masterSOKey && masterHeaderLabel && masterValueInput) {
            masterSOKey.textContent = '';
            masterHeaderLabel.textContent = '';
            masterValueInput.value = '';
            masterValueInput.style.display = 'none'; // Hide the input box completely
        }
        activeInputTarget = null; // Clear active cell tracking reference smoothly
    }
});

// --- CLEAR EVERYTHING LOGIC MODULE ---
document.getElementById('systemClearAllBtn').addEventListener('click', async () => {
    // Safety Double-Confirmation Prompts
    const confirmFirst = confirm("⚠️ WARNING: You are about to completely wipe the system. This will permanently delete ALL orders from your Supabase database. Do you want to proceed?");
    if (!confirmFirst) return;

    const confirmSecond = confirm("Are you absolutely sure? This action CANNOT be undone.");
    if (!confirmSecond) return;

    // 1. Delete all rows from the live Supabase 'orders' table
    // Passing .neq('so', '0') tells the database to delete everything where the SO is not '0' (which means every row).
    const { error } = await supabaseClient
        .from('orders')
        .delete()
        .neq('so', '0');

    if (error) {
        alert("Failed to clear database: " + error.message);
        return;
    }

    // 2. Clear out our application memory grid configurations
    databaseOrders = [];
    editedOrders = {};

    // 3. Redraw the clean, blank grid layout on the screen
    renderTableStructure();

    // 4. Wipe out any trailing strings left behind inside the lower tracking box
    const masterSOKey = document.getElementById('masterSOKey');
    const masterHeaderLabel = document.getElementById('masterHeaderLabel');
    const masterValueInput = document.getElementById('masterValueInput');
    if (masterSOKey && masterHeaderLabel && masterValueInput) {
        masterSOKey.textContent = '';
        masterHeaderLabel.textContent = '';
        masterValueInput.value = '';
        masterValueInput.style.display = 'none';
    }

    alert("Database and table successfully emptied!");
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
    editedMonitorRows = {};

    calculateStatusMetrics();
}

function calculateStatusMetrics() {
    const metricsList = document.getElementById('statusMetricsList');
    metricsList.innerHTML = '';

    // Initialize metrics collector array object
    let counts = { "All Orders": databaseOrders.length };

    // Group matching names dynamically from database payload
    databaseOrders.forEach(row => {
        let statusName = row.status ? row.status.trim() : 'Unknown';
        if (statusName === '') statusName = 'Unknown';
        counts[statusName] = (counts[statusName] || 0) + 1;
    });

    // Create selection entries under the sidebar panel
    for (const [statusName, totalCount] of Object.entries(counts)) {
        const li = document.createElement('li');
        li.innerHTML = `<span>${statusName}</span> <span style="background: var(--border-color); padding: 2px 8px; border-radius: 10px; font-size: 12px;">${totalCount}</span>`;
        
        li.addEventListener('click', () => {
            renderSelectedStatusTable(statusName);
        });
        metricsList.appendChild(li);
    }
}

function renderSelectedStatusTable(targetStatus) {
    document.getElementById('activeMonitorStatusHeader').textContent = `Status View: ${targetStatus}`;
    document.getElementById('monitorTableArea').style.display = 'block';
    document.getElementById('monitorSubmitBtn').style.display = 'inline-block';

    // Filter list to target scope
    const rowsToRender = targetStatus === "All Orders" 
        ? databaseOrders 
        : databaseOrders.filter(r => (r.status || 'Unknown').trim() === targetStatus || (targetStatus === 'Unknown' && !r.status));

    const tbody = document.getElementById('monitorTableBody');
    tbody.innerHTML = '';

    rowsToRender.forEach(order => {
        const tr = document.createElement('tr');
        const currentSO = order.so;

        // Cross-reference data row from monitor tracking array by shared primary key 'so'
        const trackingMatch = monitorTrackingRows.find(t => String(t.so) === String(currentSO)) || {};

        // Define column structure array layout sequence mapping
        const columnsConfig = [
            { key: 'so', editable: false, source: 'main' },
            { key: 'status', editable: false, source: 'main' },
            { key: 'days', editable: false, source: 'main' },
            { key: 'rout', editable: false, source: 'main' },
            { key: 'assigned_tech', editable: true, source: 'track' },
            { key: 'end_tech', editable: true, source: 'track' },
            { key: 'end_coord', editable: true, source: 'track' },
            { key: 'collected', editable: true, source: 'track' },
            { key: 'history', editable: false, source: 'main' }
        ];

        columnsConfig.forEach(cfg => {
            const td = document.createElement('td');
            
            // Resolve base values dynamically matching their source origin pointers
            let baseValue = '';
            if (cfg.source === 'main') {
                baseValue = order[cfg.key] || '';
            } else {
                // If it has been edited in this session, show the edited value, otherwise show database value
                baseValue = (editedMonitorRows[currentSO] && editedMonitorRows[currentSO][cfg.key] !== undefined)
                    ? editedMonitorRows[currentSO][cfg.key]
                    : (trackingMatch[cfg.key] || '');
            }

            if (cfg.editable) {
                const input = document.createElement('input');
                input.value = baseValue;
                input.style.width = "100%";
                input.style.boxSizing = "border-box";
                
                input.addEventListener('input', (e) => {
                    if (!editedMonitorRows[currentSO]) {
                        editedMonitorRows[currentSO] = { 
                            so: currentSO,
                            assigned_tech: trackingMatch.assigned_tech || '',
                            end_tech: trackingMatch.end_tech || '',
                            end_coord: trackingMatch.end_coord || '',
                            collected: trackingMatch.collected || ''
                        };
                    }
                    editedMonitorRows[currentSO][cfg.key] = e.target.value;
                });
                td.appendChild(input);
            } else {
                td.textContent = baseValue;
                td.style.padding = "10px";
            }
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}

// Handle Submitting tracking changes back to Supabase
document.getElementById('monitorSubmitBtn').addEventListener('click', async () => {
    const payloadsToSync = Object.values(editedMonitorRows);
    if (payloadsToSync.length === 0) {
        alert("No monitoring tracking adjustments were discovered to update.");
        return;
    }

    const { error } = await supabaseClient
        .from(MONITOR_TABLE_NAME)
        .upsert(payloadsToSync, { onConflict: 'so' });

    if (error) {
        alert("Failed to sync tracking data adjustments: " + error.message);
    } else {
        alert("Logistical tracking adjustments successfully stored!");
        loadMonitorDataEngine(); // Reload everything clean
    }
});


// --- ASSIGNATION ENGINE ---

document.getElementById('btnFetchBatchSo').addEventListener('click', () => {
    const rawText = document.getElementById('batchSoInput').value;
    // Split by comma or newline and clean up spaces
    const soList = rawText.split(/[\n,]+/).map(s => s.trim()).filter(s => s);
    fetchOrdersForAssignation(soList);
});

document.getElementById('btnFetchSingleSo').addEventListener('click', () => {
    const singleSo = document.getElementById('singleSoInput').value.trim();
    if (singleSo) fetchOrdersForAssignation([singleSo]);
});

async function fetchOrdersForAssignation(soArray) {
    if (soArray.length === 0) return;

    // 1. Fetch main order details from the 'orders' table
    const { data: ordersData, error: ordersError } = await supabaseClient
        .from('orders')
        .select('*')
        .in('so', soArray);

    if (ordersError) {
        alert("Error fetching orders: " + ordersError.message);
        return;
    }

    // 2. Fetch today's assignments from the 'repair_log' table
    const todayDate = new Date().toISOString().split('T')[0];
    const { data: logData, error: logError } = await supabaseClient
        .from('repair_log')
        .select('so, assigned_tech')
        .in('so', soArray)
        .eq('assign_date', todayDate);

    // 3. Build a quick lookup dictionary for today's assigned techs
    const assignedTechsToday = {};
    if (logData && !logError) {
        logData.forEach(log => {
            // Clean up the word 'EMPTY' if it accidentally got saved to the database
            assignedTechsToday[log.so] = (log.assigned_tech === 'EMPTY' ? '' : log.assigned_tech);
        });
    }

    // 4. Prepare data: Force status change visually and inject the found technicians
    ordersData.forEach(order => {
        order.status = "Technician"; // Force visual update
        
        // Check if we found a technician in the database for today, otherwise leave blank
        const existingTech = assignedTechsToday[order.so] || '';

        if (!editedAssignations[order.so]) {
            editedAssignations[order.so] = { ...order, assigned_tech: existingTech };
        } else {
             editedAssignations[order.so].status = "Technician";
             // If a fresh fetch finds a tech, inject it if the user hasn't typed anything yet
             if(!editedAssignations[order.so].assigned_tech) {
                 editedAssignations[order.so].assigned_tech = existingTech;
             }
        }
    });

    // 5. Merge new fetches with existing ones in the view
    const newSOs = ordersData.map(d => d.so);
    assignationOrders = [...assignationOrders.filter(o => !newSOs.includes(o.so)), ...ordersData];
    
    renderAssignationTable();
    document.getElementById('batchSoInput').value = '';
    document.getElementById('singleSoInput').value = '';
}

let assignationSortDir = {};

function renderAssignationTable(dataToRender = assignationOrders) {
    const headerRow = document.getElementById('assignHeaderRow');
    const filterRow = document.getElementById('assignFilterRow');
    const tbody = document.getElementById('assignTableBody');
    
    // BUG FIX: Only build the headers and filter inputs if they are empty!
    // This stops the input box from being destroyed while you are actively typing in it.
    if (headerRow.children.length === 0) {
        ASSIGN_COLUMNS.forEach(colKey => {
            // 1. Header with Sorting capability
            const th = document.createElement('th');
            const displayName = colKey === 'so' ? 'SO' : colKey;
            th.innerHTML = `<span class="sort-header" style="cursor:pointer;">${displayName}</span>`;
            
            th.querySelector('.sort-header').addEventListener('click', () => {
                sortAssignationColumn(colKey);
            });
            headerRow.appendChild(th);

            // 2. Filter Input Box
            const filterTd = document.createElement('th');
            const filterInput = document.createElement('input');
            filterInput.placeholder = `Filter...`;
            filterInput.dataset.column = colKey;
            filterInput.addEventListener('input', runAssignationFilters);
            filterTd.appendChild(filterInput);
            filterRow.appendChild(filterTd);
        });
    }

    // Only wipe the body, leaving the headers intact
    tbody.innerHTML = '';

    // Build Rows
    dataToRender.forEach(row => {
        const tr = document.createElement('tr');
        const currentSO = row.so;

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

            td.appendChild(input);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

// --- FILTERING FOR ASSIGNATION PAGE ---
function runAssignationFilters() {
    const filterInputs = document.querySelectorAll('#assignFilterRow input');
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


// --- CLEAR FILTERS AND SORTING ---
document.getElementById('assignClearFiltersBtn').addEventListener('click', () => {
    // 1. Wipe the text from all filter input boxes
    const filterInputs = document.querySelectorAll('#assignFilterRow input');
    filterInputs.forEach(input => {
        input.value = '';
    });
    
    // 2. Reset the sorting dictionary memory
    assignationSortDir = {};
    
    // 3. Redraw the table using the original, un-filtered fetched data
    renderAssignationTable(assignationOrders);
});

// --- CLEAR ALL TECHNICIANS : no orders will be assigned to anyone---
document.getElementById('assignClearTechsBtn').addEventListener('click', () => {
    if (!confirm("Are you sure you want to clear all assigned technicians from this list?")) {
        return;
    }

    // Loop through all currently fetched orders
    assignationOrders.forEach(row => {
        const currentSO = row.so;
        
        // Ensure the order exists in our edit tracking object
        if (!editedAssignations[currentSO]) {
            editedAssignations[currentSO] = { ...row };
        }
        
        // Wipe the assigned tech data
        editedAssignations[currentSO].assigned_tech = '';
    });

    // Redraw the table so the inputs show up as blank
    renderAssignationTable();
});

// --- ASSIGNATION SUBMISSION LOGIC ---
document.getElementById('assignSubmitBtn').addEventListener('click', async () => {
    const recordsToProcess = Object.values(editedAssignations);
    if (recordsToProcess.length === 0) {
        alert("No assignations to submit.");
        return;
    }

    const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
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

    // 2. Prepare payload for 'repair_log' table
    const repairLogPayload = recordsToProcess.map(record => ({
        so: record.so,
        assigned_tech: record.assigned_tech || '',
        assigned_by: currentUser ? currentUser.username : 'Unknown',
        assign_date: todayDate
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
    // Notice the updated onConflict targeting the composite constraint
    const { error: logErr } = await supabaseClient
        .from('repair_log')
        .upsert(repairLogPayload, { onConflict: 'so, assign_date' });

    if (logErr) {
        alert("Orders updated, but failed to sync repair log: " + logErr.message);
    } else {
        alert("Assignations successfully submitted to your technicians!");
        assignationOrders = [];
        editedAssignations = {};
        renderAssignationTable(); // Clear view
    }
});