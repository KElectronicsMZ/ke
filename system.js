let activeInputTarget = null; // Tracks the currently selected table cell input
let sortDirection = {}; // Tracks if column is sorting 'asc' or 'desc'

// --- 1. SYSTEM MENU ENTRY ---
document.getElementById('btnSystem').addEventListener('click', () => {
    menuPage.classList.remove('active');
    systemPage.classList.add('active');
    
    const now = new Date();
    const past30 = new Date();
    past30.setDate(now.getDate() - 30);
    
    const formatInputDate = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const startDateInput = document.getElementById('systemStartDate');
    const endDateInput = document.getElementById('systemEndDate');
    
    if (startDateInput && !startDateInput.value) startDateInput.value = formatInputDate(past30);
    if (endDateInput && !endDateInput.value) endDateInput.value = formatInputDate(now);
});

// --- 2. SYSTEM MENU EXIT (CANCEL) ---
document.getElementById('systemCancelBtn').addEventListener('click', () => {
    if (Object.keys(window.editedOrders).length > 0) {
        if (!confirm("You have unsaved inline changes. Are you sure you want to discard them?")) {
            return;
        }
    }
    window.editedOrders = {};
    systemPage.classList.remove('active');
    menuPage.classList.add('active');
});

// --- 3. SYSTEM MENU EXIT (HUB) ---
document.getElementById('systemHubBtn').addEventListener('click', () => {
    if (Object.keys(window.editedOrders).length > 0) {
        if (!confirm("You have unsaved inline changes. Are you sure you want to leave for the HUB?")) {
            return;
        }
    }
    
    window.editedOrders = {};
    window.databaseOrders = [];
    
    const tableBody = document.getElementById('tableBody');
    if (tableBody) tableBody.innerHTML = '';
    
    systemPage.classList.remove('active');
    menuPage.classList.add('active');
});

// --- 6. DATA VISUALIZATION ENGINE (DYNAMIC TABLE) ---
async function loadDatabaseData() {
    showGlobalLoader("Fetching System Records..."); 
    
    const startInput = document.getElementById('systemStartDate').value;
    const endInput = document.getElementById('systemEndDate').value;
    
    let data = [];
    
    if (startInput && endInput) {
        const start = new Date(startInput);
        const end = new Date(endInput);
        
        let dateStringsToFetch = [];
        let currentDay = new Date(start);
        
        // Loop through every day in the selected range
        while (currentDay <= end) {
            const dd = String(currentDay.getDate()).padStart(2, '0');
            const mm = String(currentDay.getMonth() + 1).padStart(2, '0');
            const yyyy = currentDay.getFullYear();
            
            // Build the string formats that match your database entries exactly
            dateStringsToFetch.push(`${mm}.${dd}.${yyyy}`); // Example: 07.28.2026
            dateStringsToFetch.push(`${mm}/${dd}/${yyyy}`); // Example: 07/28/2026
            dateStringsToFetch.push(`${dd}.${mm}.${yyyy}`); // Fallback
            dateStringsToFetch.push(`${dd}/${mm}/${yyyy}`); // Fallback
            
            // Move to the next day in the loop
            currentDay.setDate(currentDay.getDate() + 1);
        }
        
        // Use the pagination engine to ask Supabase ONLY for these specific text dates
        data = await fetchAllRecords('orders', 'date', dateStringsToFetch);
    } else {
        // Fallback: If the dates are empty, fetch everything
        data = await fetchAllRecords('orders');
    }
    
    if (!data) {
        hideGlobalLoader(); 
        alert("Error loading data from database. Please check your connection.");
        return;
    }
    
    window.databaseOrders = data || [];
    window.editedOrders = {};
    renderTableStructure();
    
    hideGlobalLoader(); 
}

// Hook up the Apply Range button
const applySystemDateBtn = document.getElementById('btnApplySystemDate');
if (applySystemDateBtn) {
    applySystemDateBtn.addEventListener('click', () => {
        loadDatabaseData(); 
    });
}

// --- GET A LIST (BATCH FETCH) LOGIC FOR SYSTEM PAGE ---

// 1. Toggle the hidden text area
const btnToggleGetList = document.getElementById('btnToggleGetList');
const systemGetListContainer = document.getElementById('systemGetListContainer');

if (btnToggleGetList && systemGetListContainer) {
    btnToggleGetList.addEventListener('click', () => {
        if (systemGetListContainer.style.display === 'none') {
            systemGetListContainer.style.display = 'flex';
        } else {
            systemGetListContainer.style.display = 'none';
        }
    });
}

// 2. Fetch the specific orders and draw the table
const btnFetchSystemList = document.getElementById('btnFetchSystemList');
const systemBatchSoInput = document.getElementById('systemBatchSoInput');

if (btnFetchSystemList && systemBatchSoInput) {
    btnFetchSystemList.addEventListener('click', async () => {
        const rawText = systemBatchSoInput.value;
        // Split by comma or newline and clean up spaces
        const soList = rawText.split(/[\n,]+/).map(s => s.trim()).filter(s => s);

        if (soList.length === 0) {
            alert("Please paste at least one SO number.");
            return;
        }

        showGlobalLoader("Fetching specific orders...");

        // Use the pagination engine to ask Supabase ONLY for these specific SOs
        const data = await fetchAllRecords('orders', 'so', soList);

        hideGlobalLoader();

        if (!data) {
            alert("Error loading data from database. Please check your connection.");
            return;
        }

        // Check for missing orders
        const foundSOs = data.map(d => String(d.so));
        const missingSOs = soList.filter(so => !foundSOs.includes(String(so)));

        if (missingSOs.length > 0) {
            alert(`Fetched ${data.length} orders.\n\n⚠️ Could not find ${missingSOs.length} order(s) in the system: \n${missingSOs.join(', ')}`);
        } else {
            alert(`Success! Fetched all ${data.length} orders.`);
        }

        // Wipe the existing table memory and replace it with ONLY the new data
        window.databaseOrders = data || [];
        window.editedOrders = {}; // Wipe unsaved edits to prevent ghost data from showing up
        
        // Force the table to redraw with the new limited dataset
        renderTableStructure();
        
        // Clean up the UI
        systemBatchSoInput.value = '';
        systemGetListContainer.style.display = 'none';
    });

    // Allow 'Enter' key to fetch, and 'Shift+Enter' for new line
    systemBatchSoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            btnFetchSystemList.click();
        }
    });
}
// --- END GET A LIST LOGIC ---



function renderTableStructure() {
    const headerRow = document.getElementById('headerRow');
    const filterRow = document.getElementById('filterRow');
    
    headerRow.innerHTML = '';
    filterRow.innerHTML = '';

    // --- Inject Row Number Header ---
    const indexHeader = document.createElement('th');
    indexHeader.textContent = "#";
    indexHeader.style.width = "40px"; 
    headerRow.appendChild(indexHeader);
    
    const indexFilter = document.createElement('th');
    filterRow.appendChild(indexFilter);

    // --- Add empty header cells for the checkbox column ---
        const checkHeader = document.createElement('th');
        
        // NEW: "Select All" checkbox embedded in the header
        checkHeader.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center;"><input type="checkbox" id="selectAllSystemCheckbox" style="margin-bottom: 2px; width: auto;"><span style="font-size: 11px;">Select All</span></div>`;
        headerRow.appendChild(checkHeader);

        // Attach Select All logic (targets ALL loaded database orders)
        checkHeader.querySelector('#selectAllSystemCheckbox').addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            window.databaseOrders.forEach(row => {
                if (isChecked) {
                    window.selectedSystemOrders.add(row.so);
                } else {
                    window.selectedSystemOrders.delete(row.so);
                }
            });
            // Safely redraw the table via the filter engine to preserve any active search views
            runFilters(); 
        });
    
    const checkFilter = document.createElement('th');
    filterRow.appendChild(checkFilter);
    // -------end of Add empty header cells for the checkbox colum------

    window.activeColumns.forEach(colKey => {
        const th = document.createElement('th');
        const displayName = colKey === 'so' ? 'SO' : colKey;
        
        // Wrap the name in a clickable span for sorting
        th.innerHTML = `
            <div class="header-wrapper" style="display: flex; justify-content: center; align-items: center; width: 100%;">
                <span class="sort-header" style="cursor:pointer; font-weight: bold;">${displayName}</span> 
            </div>
        `;
        
        // --- ADD MISSING SORT CLICK EVENT ---
        th.querySelector('.sort-header').addEventListener('click', () => {
            sortColumn(colKey);
        });
        // ------------------------------------
        
        headerRow.appendChild(th);

        // --- NEW EXCEL-STYLE DROPDOWN FILTER ---
        const filterTd = document.createElement('th');
        
        // 1. Create the text input for typing
        const textFilter = document.createElement('input');
        textFilter.type = 'text';
        textFilter.placeholder = 'Search...';
        textFilter.dataset.column = colKey;
        textFilter.style.width = '100%';
        textFilter.style.boxSizing = 'border-box';
        textFilter.style.marginBottom = '2px';
        textFilter.addEventListener('input', runFilters);
        filterTd.appendChild(textFilter);

        // 2. Create the dropdown select
        const filterSelect = document.createElement('select');
        filterSelect.dataset.column = colKey;

        // Add these 3 styling lines:
        filterSelect.style.width = '100%';
        filterSelect.style.boxSizing = 'border-box';
        filterSelect.style.display = 'block';
                
        // Add the default option and Blank option at the top
        filterSelect.innerHTML = `
            <option value="">-- All --</option>
            <option value="[BLANK]">-- Blank --</option>
        `;
        
        // Extract unique values from the database for this specific column
        const uniqueValues = new Set();
        window.databaseOrders.forEach(row => {
            let val = (window.editedOrders[row.so] && window.editedOrders[row.so][colKey] !== undefined) 
                ? window.editedOrders[row.so][colKey] 
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

    populateTableRows(window.databaseOrders);
    // Fire resizer
    applyResizableColumns('dataTable', 'sys_cols');

    attachClickMoveLogic('headerRow', window.activeColumns, 'sys_order', renderTableStructure);
}

function populateTableRows(dataToDisplay) {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    dataToDisplay.forEach((row, index) => { 
        const tr = document.createElement('tr');
        const currentSO = row.so;

        // --- PHASE 2: EXTRACT SLA FLAG ---
        const returnVal = (window.editedOrders[currentSO] && window.editedOrders[currentSO]['return'] !== undefined) 
            ? window.editedOrders[currentSO]['return'] 
            : (row['return'] || '');
        const returnValStr = returnVal ? String(returnVal).toLowerCase() : '';
        // ---------------------------------

        // --- Inject Row Number Cell ---
        const indexTd = document.createElement('td');
        indexTd.textContent = index + 1; // +1 so it starts at 1 instead of 0
        indexTd.style.textAlign = 'center';
        indexTd.style.fontWeight = 'bold';
        tr.appendChild(indexTd);


        // --- Inject the Checkbox Cell ---
        const checkTd = document.createElement('td');
        checkTd.style.textAlign = 'center';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.width = 'auto'; // Prevent it from stretching
        checkbox.checked = window.selectedSystemOrders.has(currentSO);
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                window.selectedSystemOrders.add(currentSO);
            } else {
                window.selectedSystemOrders.delete(currentSO);
            }
        });
        
        checkTd.appendChild(checkbox);
        tr.appendChild(checkTd);
        // --- end of Inject the Checkbox Cell --

        window.activeColumns.forEach(colKey => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            
            const currentValue = (window.editedOrders[currentSO] && window.editedOrders[currentSO][colKey] !== undefined) 
                ? window.editedOrders[currentSO][colKey] 
                : (row[colKey] || '');

            input.value = currentValue;

            // --- MAKE SO CLICKABLE & READ-ONLY ---
            if (colKey === 'so') {
                input.readOnly = true; // Protects the primary key from accidental typing
                input.style.cursor = 'pointer';
                input.style.color = 'var(--text-color)'; 
                input.style.textDecoration = 'none';
                input.style.fontWeight = '900';

                // --- PHASE 2: CELL-LEVEL SLA STYLING ---
                if (returnValStr.startsWith('return')) {
                    input.style.backgroundColor = 'rgba(211, 47, 47, 0.2)'; // Light Red
                } else if (returnValStr.startsWith('redo')) {
                    input.style.backgroundColor = 'rgba(245, 124, 0, 0.2)'; // Light Yellowish/Orange
                }
                // ---------------------------------------
                
                input.addEventListener('click', () => {
                    openViewOnlyModal(row); // Opens the ticket!
                });
            } else {
                // Normal typing allowed for all other columns
                input.addEventListener('input', (e) => {
                    if (!window.editedOrders[currentSO]) {
                        window.editedOrders[currentSO] = { ...row };
                    }
                    window.editedOrders[currentSO][colKey] = e.target.value;
                });
            }
            // -------------------------------------


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
                    
                    // Show buttons and attach the current SO to the container's memory
                    if (actionButtons) {
                        actionButtons.style.display = 'flex';
                        actionButtons.dataset.activeSo = currentSO; 
                    }
                }
            });

            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

// --- 7. FILTERING SYSTEM ---
function runFilters() {
    const filterSelects = document.querySelectorAll('#filterRow select');
    const filterInputs = document.querySelectorAll('#filterRow input[type="text"]');
    let filteredData = [...window.databaseOrders];

    // Apply Dropdown Filters First
    filterSelects.forEach(select => {
        const val = select.value;
        const colKey = select.dataset.column;

        if (val === "[BLANK]") {
            filteredData = filteredData.filter(row => {
                const cellValue = (window.editedOrders[row.so] && window.editedOrders[row.so][colKey] !== undefined)
                    ? String(window.editedOrders[row.so][colKey]).trim()
                    : String(row[colKey] || '').trim();
                return cellValue === '';
            });
        } else if (val !== "") {
            filteredData = filteredData.filter(row => {
                const cellValue = (window.editedOrders[row.so] && window.editedOrders[row.so][colKey] !== undefined)
                    ? String(window.editedOrders[row.so][colKey])
                    : String(row[colKey] || '');
                return cellValue === val; // Exact match for dropdowns
            });
        }
    });

    // Apply Text Input Filters Second
    filterInputs.forEach(input => {
        const val = input.value.toLowerCase();
        const colKey = input.dataset.column;

        if (val) {
            filteredData = filteredData.filter(row => {
                const cellValue = (window.editedOrders[row.so] && window.editedOrders[row.so][colKey] !== undefined)
                    ? String(window.editedOrders[row.so][colKey])
                    : String(row[colKey] || '');
                return cellValue.toLowerCase().includes(val);
            });
        }
    });

    populateTableRows(filteredData);
}

// --- CALCULATE DAYS DIFFERENCE ---
document.getElementById('btnUpdateDays').addEventListener('click', () => {
    // 1. Get today's exact date (set time to midnight so the math is perfectly clean)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let updateCount = 0;

    // 2. Loop through all the orders currently loaded on the screen
    window.databaseOrders.forEach(order => {
        const so = order.so;
        
        // Grab the date (check if the user already edited it inline first, otherwise use the database value)
        const dateStr = (window.editedOrders[so] && window.editedOrders[so].date !== undefined) ? window.editedOrders[so].date : order.date;
        
        if (dateStr && String(dateStr).trim() !== '') {
            // Split the string by either a period (.) or a slash (/)
            const parts = String(dateStr).split(/[\.\/]/); 
            
            if (parts.length === 3) {
                const month = parseInt(parts[0], 10) - 1; // JavaScript months start at 0 (January = 0)
                const day = parseInt(parts[1], 10);
                let year = parseInt(parts[2], 10);
                
                // Safety catch: If someone typed "26" instead of "2026", convert it
                if (year < 100) year += 2000; 
                
                const orderDate = new Date(year, month, day);
                
                // 3. Do the math: Subtract order date from today, then convert milliseconds to days
                const timeDiff = today.getTime() - orderDate.getTime();
                const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
                
                // 4. Save it into the staging memory exactly as if the user typed it
                if (!window.editedOrders[so]) {
                    window.editedOrders[so] = { ...order };
                }
                window.editedOrders[so].days = daysDiff;
                updateCount++;
            }
        }
    });
    
    if (updateCount > 0) {
        alert(`Successfully calculated days for ${updateCount} orders! Click 'Submit' to permanently save these changes to the database.`);
        // 5. Force the table to erase itself and redraw with the new numbers
        renderTableStructure();
    } else {
        alert("No valid dates were found to update.");
    }
});

// --- 9. INLINE CHANGES SUBMISSION ---
document.getElementById('systemSubmitBtn').addEventListener('click', async () => {
    const recordsToUpdate = Object.values(window.editedOrders).map(record => {
        let cleanRecord = { ...record };
        // Sanitize integer columns to prevent PostgreSQL 400 Bad Request on inline edits
        if (cleanRecord.visit_sequence === "") cleanRecord.visit_sequence = null;
        return cleanRecord;
    });

    if (recordsToUpdate.length === 0) {
        alert("No changes detected to submit.");
        return;
    }

    // CHANGED: onConflict uses lowercase 'so'
    const { error } = await window.supabaseClient
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
    if (!window.currentUser || !allowedRoles.includes(window.currentUser.role)) {
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
    const { error: logError } = await window.supabaseClient
        .from('repair_log')
        .delete()
        .neq('so', '0'); // Dummy filter required by Supabase to allow mass deletion

    if (logError) {
        alert("Failed to wipe repair_log table: " + logError.message);
        return; // Stop here so we don't try to delete orders if logs failed
    }

    // Step B: Wipe orders
    const { error: ordersError } = await window.supabaseClient
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
            let newSOsForCC = []; 
            
            data.forEach(csvRow => {
                let rowObj = {};
                
                for (const [csvHeader, csvValue] of Object.entries(csvRow)) {
                    // Clean invisible characters from the CSV header
                    const cleanHeader = csvHeader.replace(/["\r]/g, '').trim();
                    
                    // If the CSV column matches one of our active columns, keep it
                    if (window.ALL_COLUMNS.includes(cleanHeader)) {
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
                    // Check if it's completely new to the system
                    const existingOrder = window.databaseOrders.find(o => String(o.so) === String(rowObj.so));
                    if (!existingOrder && !window.editedOrders[rowObj.so]) {
                        newSOsForCC.push(rowObj.so);
                    }

                    if (!window.editedOrders[rowObj.so]) window.editedOrders[rowObj.so] = {};
                    window.editedOrders[rowObj.so] = { ...window.editedOrders[rowObj.so], ...rowObj };
                }
            });

            // TRIGGER CALL CENTER if it's a new order and the settings allow it (check settings page)
            if (newSOsForCC.length > 0 && typeof window.pushToCCQueue === 'function') {
                window.pushToCCQueue(newSOsForCC, 'new_order');
            }

            alert("CSV uploaded successfully! Click 'Submit' to sync these orders to the database.");
            renderTableStructure();
            document.getElementById('csvFileInput').value = '';
        },
        error: function(err) {
            alert("Error reading CSV file: " + err.message);
        }
    });
}

// ==============================================================
// BUTTON 1: THE RESTORE ENGINE (Force Overwrites Corrupted Data)
// ==============================================================
document.getElementById('btnRestoreTxt').addEventListener('click', () => {
    document.getElementById('restoreTxtFileInput').click();
});

document.getElementById('restoreTxtFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;

        Papa.parse(text, {
            header: false,
            delimiter: "\t",
            skipEmptyLines: true,
            complete: function(results) {
                const data = results.data;
                let addedCount = 0;

                data.forEach(rowArray => {
                    let rowObj = {};
                    
                    // Maps strictly to the Master Database Schema, bypassing the translator
                    rowArray.forEach((val, index) => {
                        if (window.ALL_COLUMNS[index]) {
                            rowObj[window.ALL_COLUMNS[index]] = val ? String(val).trim() : '';
                        }
                    });

                    if (rowObj.so) {
                        // ⚠️ NO GUARD HERE: We want this to intentionally overwrite the database!
                        if (!window.editedOrders[rowObj.so]) window.editedOrders[rowObj.so] = {};
                        window.editedOrders[rowObj.so] = { ...window.editedOrders[rowObj.so], ...rowObj };
                        addedCount++;
                        
                        const existingIndex = window.databaseOrders.findIndex(o => String(o.so) === String(rowObj.so));
                        if (existingIndex === -1) window.databaseOrders.unshift(rowObj);
                        else window.databaseOrders[existingIndex] = { ...window.databaseOrders[existingIndex], ...rowObj };
                    }
                });

                if (addedCount > 0) {
                    alert(`${addedCount} order(s) staged from System Backup! Click 'Submit' to force overwrite the database.`);
                    renderTableStructure();
                }
                document.getElementById('restoreTxtFileInput').value = '';
            }
        });
    };
    reader.readAsText(file);
});

// ==============================================================
// BUTTON 2: THE SAMSUNG UPLOAD ENGINE (Protects Live Statuses)
// ==============================================================
document.getElementById('txtUploadBtn').addEventListener('click', () => {
    document.getElementById('txtFileInput').click();
});

document.getElementById('txtFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;

        Papa.parse(text, {
            header: false,
            delimiter: "\t",
            skipEmptyLines: true,
            complete: async function(results) { 
                const data = results.data;
                let addedCount = 0;

                // --- PHASE 1: GATHER ALL INCOMING SO NUMBERS ---
                const incomingSOs = [];
                data.forEach(rowArray => {
                    const soIndex = window.IMPORT_COLUMNS.indexOf('so');
                    if (soIndex !== -1 && rowArray[soIndex]) {
                        incomingSOs.push(String(rowArray[soIndex]).trim());
                    }
                });

                // --- PHASE 2: QUERY LIVE SUPABASE DATABASE ---
                let liveDbOrders = [];
                if (incomingSOs.length > 0) {
                    showGlobalLoader("Checking live database to protect statuses...");
                    liveDbOrders = await fetchAllRecords('orders', 'so', incomingSOs);
                    hideGlobalLoader();
                }

                // --- PHASE 3: MAP AND PROTECT DATA ---
                data.forEach(rowArray => {
                    let rowObj = {};
                    
                    rowArray.forEach((val, index) => {
                        if (window.IMPORT_COLUMNS[index] && window.IMPORT_COLUMNS[index] !== "") {
                            let finalValue = val ? String(val).trim() : '';
                            if (finalValue.startsWith("'")) finalValue = finalValue.substring(1);
                            rowObj[window.IMPORT_COLUMNS[index]] = finalValue;
                        }
                    });

                    if (rowObj.so) {
                        // LIVE STATUS & ROUTE PROTECTION: Consult Supabase, not the screen
                        const liveMatch = liveDbOrders.find(o => String(o.so) === String(rowObj.so)) || {};

                        if (liveMatch.status && String(liveMatch.status).trim() !== '') {
                            // Keep the existing live status instead of deleting it
                            rowObj.status = liveMatch.status; 
                        }
                        if (liveMatch.rout && String(liveMatch.rout).trim() !== '') {
                            // Keep the existing live route instead of deleting it
                            rowObj.rout = liveMatch.rout; 
                        }
                        if (liveMatch.assigned_tech && String(liveMatch.assigned_tech).trim() !== '') {
                            // Keep the existing assigned technician instead of deleting it
                            rowObj.assigned_tech = liveMatch.assigned_tech; 
                        }
                        
                        // Prevents blank TXT cells from wiping historical links in the Order entity
                        const mediaFields = ['img1', 'calls', 'location_link', 'vid1', 'arrived_at', 'left_at'];
                        mediaFields.forEach(field => {
                            if (liveMatch[field] && String(liveMatch[field]).trim() !== '') {
                                rowObj[field] = liveMatch[field];
                            }
                        });
                        // ------------------------------------

                        if (!window.editedOrders[rowObj.so]) window.editedOrders[rowObj.so] = {};
                        window.editedOrders[rowObj.so] = { ...window.editedOrders[rowObj.so], ...rowObj };
                        addedCount++;
                        
                        const existingIndex = window.databaseOrders.findIndex(o => String(o.so) === String(rowObj.so));
                        if (existingIndex === -1) window.databaseOrders.unshift(rowObj);
                        else window.databaseOrders[existingIndex] = { ...window.databaseOrders[existingIndex], ...rowObj };
                    }
                });

                if (addedCount > 0) {
                    alert(`${addedCount} order(s) staged from Samsung file! Click 'Submit' to safely update.`);
                    renderTableStructure(); 
                }
                
                document.getElementById('txtFileInput').value = '';
            },
            error: function(err) {
                alert("Error parsing TXT file: " + err.message);
            }
        });
    };
    reader.readAsText(file);
});

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
                    
                    // Map the raw clipboard values to your strict window.IMPORT_COLUMNS sequence
                    rowArray.forEach((val, index) => {
                        if (window.IMPORT_COLUMNS[index]) {
                            rowObj[window.IMPORT_COLUMNS[index]] = val ? String(val).trim() : '';
                        }
                    });

                    // Ensure the row has an 'so' before adding it
                    if (rowObj.so) {
                        // Stage it in memory so the Submit button sees it as a new edit
                        if (!window.editedOrders[rowObj.so]) {
                            window.editedOrders[rowObj.so] = {};
                        }
                        window.editedOrders[rowObj.so] = { ...window.editedOrders[rowObj.so], ...rowObj };
                        addedCount++;
                        
                        // Push it visually to the top of the table
                        const existingIndex = window.databaseOrders.findIndex(o => String(o.so) === String(rowObj.so));
                        if (existingIndex === -1) {
                            window.databaseOrders.unshift(rowObj); 
                        } else {
                            // If it exists, update the visual data
                            window.databaseOrders[existingIndex] = { ...window.databaseOrders[existingIndex], ...rowObj };
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
    const existingOrder = window.databaseOrders.find(o => String(o.so) === cleanSO);
    if (existingOrder || window.editedOrders[cleanSO]) {
        alert(`Error: SO "${cleanSO}" already exists in the system. Primary keys must be unique.`);
        return;
    }

    // 3. Generate a completely blank row mapped to your exact columns
    const blankOrder = { so: cleanSO };
    
    window.ALL_COLUMNS.forEach(col => {
        if (col !== 'so') {
            // Strictly assign null to known integer columns to protect Supabase schema
            blankOrder[col] = (col === 'visit_sequence') ? null : '';
        }
    });

    // 4. Stage it in memory for the final database submission
    window.editedOrders[cleanSO] = { ...blankOrder };
    
    // 5. Inject it at the very top of the visual table
    window.databaseOrders.unshift(blankOrder);
    
    // 6. Redraw the UI
    renderTableStructure();
});

function sortColumn(colKey) {
    // Toggle sort direction between ascending and descending
    const currentDir = sortDirection[colKey] === 'asc' ? 'desc' : 'asc';
    sortDirection = { [colKey]: currentDir }; // Reset other tracking, prioritize this one

    window.databaseOrders.sort((a, b) => {
        let valA = (window.editedOrders[a.so] && window.editedOrders[a.so][colKey] !== undefined) ? window.editedOrders[a.so][colKey] : (a[colKey] || '');
        let valB = (window.editedOrders[b.so] && window.editedOrders[b.so][colKey] !== undefined) ? window.editedOrders[b.so][colKey] : (b[colKey] || '');

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

    populateTableRows(window.databaseOrders);
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

// --- SEARCH ORDER LOGIC ---
document.getElementById('btnSearchOrder').addEventListener('click', async () => {
    const searchInput = document.getElementById('systemSearchSoInput').value.trim();
    if (!searchInput) {
        alert("Please enter an SO number to search.");
        return;
    }

    showGlobalLoader("Locating Order...");

    // 1. Try to find the order in the live edits or main memory first
    let foundOrder = null;
    if (typeof window.editedOrders !== 'undefined' && window.editedOrders[searchInput]) {
        foundOrder = window.editedOrders[searchInput];
    } else if (typeof window.databaseOrders !== 'undefined' && window.databaseOrders.length > 0) {
        foundOrder = window.databaseOrders.find(o => String(o.so) === searchInput);
    }

    // 2. If it's not in memory, ask the database directly
    if (!foundOrder) {
        const { data, error } = await window.supabaseClient
            .from('orders')
            .select('*')
            .eq('so', searchInput)
            .single();
        
        if (data && !error) {
            foundOrder = data;
        }
    }

    hideGlobalLoader();

    if (foundOrder) {
        openViewOnlyModal(foundOrder);
    } else {
        alert(`Order with SO: ${searchInput} does not exist in the system.`);
    }
});

// Action 1: Agree (Coord)
document.getElementById('btnAgreeCoord').addEventListener('click', async () => {
    const activeSo = document.getElementById('systemSearchSoInput').value.trim();
    if (!activeSo) {
        alert("Please enter an SO number in the search box first.");
        return;
    }
    
    // VERIFY DIRECTLY WITH DATABASE
    showGlobalLoader("Verifying Order...");
    const { data: foundOrder, error: fetchErr } = await window.supabaseClient
        .from('orders')
        .select('so, agree_coord, status, assigned_tech') // <-- FETCH REQUIRED STATUSES
        .eq('so', activeSo)
        .single();
    hideGlobalLoader();

    if (fetchErr || !foundOrder) {
        alert(`Cannot apply action: Order SO ${activeSo} not found in the database.`);
        return;
    }

    // --- CHECK IF ALREADY AGREED ---
    if (foundOrder.agree_coord && foundOrder.agree_coord.trim() !== '') {
        alert(`Action blocked: This order was already agreed by ${foundOrder.agree_coord}.`);
        return; // Stops the function here so nothing gets written to the database
    }
    // ------------------------------------

    const { date, time } = getCurrentDateTime();
    window.currentUsername = window.currentUser ? window.currentUser.username : 'Unknown';

    // 1. Prepare history log payload
    const payload = {
        so: activeSo,
        status: foundOrder.status || 'Unknown',
        assigned_by: window.currentUsername,
        agree_coord: window.currentUsername,
        assign_date: date,
        assign_time: time,
        assigned_tech: foundOrder.assigned_tech || '' 
    };

    // 2. Execute history log
    const { error: logError } = await window.supabaseClient.from('repair_log').insert(payload);

    if (logError) {
        alert("Error saving record to log: " + logError.message);
        return;
    }

    // 3. Execute main orders table update!
    const { error: orderError } = await window.supabaseClient.from('orders')
        .update({ agree_coord: window.currentUsername })
        .eq('so', activeSo);

    if (orderError) {
        alert("Log was saved, but error updating main order table: " + orderError.message);
    } else {
        alert(`Sucess : Coordination agreement logged and order updated for SO: ${activeSo}`);
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

    // 1. Gather visible SOs from DOM (Bulletproof Method)
    const visibleSOs = Array.from(tableBody.querySelectorAll('tr')).map(tr => {
        // Automatically hunt for the input field that is Read-Only and Bolded (The SO cell)
        const soInput = Array.from(tr.querySelectorAll('input')).find(inp => inp.readOnly === true && inp.style.fontWeight === '900');
        if(soInput) return soInput.value;
        return null;
    }).filter(val => val !== null);

    // 2. Organize data into groupings by Technician
    const groupedData = {};

    visibleSOs.forEach(so => {
        const rowData = memoryMap[so] || window.databaseOrders.find(o => String(o.so) === String(so)) || {};
        
        let tech = (rowData.assigned_tech || '').trim();
        let currentStatus = (rowData.status || '').trim();
        
        // Group under the tech's name ONLY if the status is exactly "Technician"
        if (tech === '' || tech.toUpperCase() === 'EMPTY' || currentStatus !== 'Technician') {
            tech = 'Unassigned';
        }

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

// ==========================================
// --- COLUMN MANAGER ENGINE (DRAG & DROP) ---
// ==========================================
const columnManagerModal = document.getElementById('columnManagerModal');
const columnManagerList = document.getElementById('columnManagerList');
let draggedItem = null;

const btnManageColumns = document.getElementById('btnManageColumns');
if (btnManageColumns) {
    btnManageColumns.addEventListener('click', () => {
        if (!columnManagerList || !columnManagerModal) return;
        columnManagerList.innerHTML = '';
        
        // Combine active and hidden columns to show the full list
        const currentOrder = [...window.activeColumns, ...window.hiddenColumns];
        
        currentOrder.forEach(col => {
            const isSO = col === 'so'; // Protect the primary key!
            
            const li = document.createElement('li');
            li.className = 'col-drag-item';
            li.draggable = true;
            li.dataset.column = col;
            
            const isChecked = window.activeColumns.includes(col) ? 'checked' : '';
            const disableCheck = isSO ? 'disabled title="Cannot hide primary key"' : '';
            
            li.innerHTML = `
                <span class="col-drag-handle">☰</span>
                <input type="checkbox" class="col-visibility-check" style="margin-right: 12px; transform: scale(1.3); cursor: pointer;" ${isChecked} ${disableCheck}>
                <span style="font-weight: bold; cursor: default;">${isSO ? 'SO (Required Database Key)' : col}</span>
            `;
            
            // --- HTML5 Drag & Drop Listeners ---
            li.addEventListener('dragstart', function(e) {
                draggedItem = this;
                setTimeout(() => this.classList.add('dragging'), 0);
            });
            
            li.addEventListener('dragend', function() {
                draggedItem = null;
                this.classList.remove('dragging');
            });
            
            li.addEventListener('dragover', function(e) {
                e.preventDefault(); // Required to allow dropping
                const draggingNode = document.querySelector('.dragging');
                if (!draggingNode) return;
                
                // Find where we are hovering to insert the item
                const siblings = [...columnManagerList.querySelectorAll('.col-drag-item:not(.dragging)')];
                const nextSibling = siblings.find(sibling => {
                    return e.clientY <= sibling.getBoundingClientRect().top + sibling.offsetHeight / 2;
                });
                columnManagerList.insertBefore(draggingNode, nextSibling);
            });

            columnManagerList.appendChild(li);
        });
        
        columnManagerModal.style.display = 'flex';
    });
}

const closeColumnManagerBtn = document.getElementById('closeColumnManagerBtn');
if (closeColumnManagerBtn) {
    closeColumnManagerBtn.addEventListener('click', () => {
        if (columnManagerModal) columnManagerModal.style.display = 'none';
    });
}

// Save and Apply Logic
const saveColumnsBtn = document.getElementById('saveColumnsBtn');
if (saveColumnsBtn) {
    saveColumnsBtn.addEventListener('click', () => {
        const userKey = window.currentUser ? window.currentUser.username : 'guest';
        const newActive = [];
        const newHidden = [];
        
        // Read the physical DOM order from top to bottom
        document.querySelectorAll('.col-drag-item').forEach(li => {
            const colKey = li.dataset.column;
            const isChecked = li.querySelector('.col-visibility-check').checked;
            
            // Force 'so' to always remain active just in case
            if (isChecked || colKey === 'so') {
                newActive.push(colKey);
            } else {
                newHidden.push(colKey);
            }
        });
        
        // Update live memory variables
        window.activeColumns = newActive;
        window.hiddenColumns = newHidden;
        
        // Save to LocalStorage so it remembers on next login
        localStorage.setItem('sys_order_' + userKey, JSON.stringify(window.activeColumns));
        localStorage.setItem('window.hiddenColumns_' + userKey, JSON.stringify(window.hiddenColumns));
        
        // Redraw table and close modal
        renderTableStructure();
        if (columnManagerModal) columnManagerModal.style.display = 'none';
    });
}

// Reset Default Logic
const resetColumnsBtn = document.getElementById('resetColumnsBtn');
if (resetColumnsBtn) {
    resetColumnsBtn.addEventListener('click', () => {
        const userKey = window.currentUser ? window.currentUser.username : 'guest';
        
        // Restore exact factory variables
        window.activeColumns = [...window.ALL_COLUMNS];
        window.hiddenColumns = [];
        
        // Wipe customized storage
        localStorage.setItem('sys_order_' + userKey, JSON.stringify(window.activeColumns));
        localStorage.removeItem('window.hiddenColumns_' + userKey);
        localStorage.removeItem('sys_cols_' + userKey); // Clears customized column widths
        
        renderTableStructure();
        if (columnManagerModal) columnManagerModal.style.display = 'none';
        alert("Layout and columns reset to factory defaults.");
    });
}