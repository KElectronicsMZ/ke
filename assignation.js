// --- ASSIGNATION PAGE: RESET LAYOUT ---
document.getElementById('assignResetLayoutBtn').addEventListener('click', () => {
    const userKey = currentUser ? currentUser.username : 'guest';
    
    // 1. Wipe saved memory for this page
    localStorage.removeItem('assign_cols_' + userKey);
    localStorage.removeItem('assign_order_' + userKey);
    
    // 2. Restore factory defaults
    ASSIGN_COLUMNS.length = 0;
    ASSIGN_COLUMNS.push("so", "date", "days", "status", "service_type", "address", "rout", "assigned_tech", "model", "remark", "status_comment", "part_1", "qty_1", "part_2", "qty_2", "part_3", "qty_3", "part_4", "qty_4", "part_5", "qty_5");
    
    // 3. Redraw table
    renderAssignationTable();
    alert("Assignation layout has been reset to defaults.");
});




const assignationPage = document.getElementById('assignationPage');


// --- NEW: TOMORROW'S SCHEDULE STAGING COUNTER ---
async function updateStagingCount() {
    const countBadge = document.getElementById('pendingTomorrowCount');
    const stagedSection = document.getElementById('stagedOrdersSection');
    if (!countBadge) return;
    
    // Upgrade: Fetch the actual data instead of just the count
    const { data, error } = await supabaseClient
        .from('tomorrow_schedule')
        .select('*');
        
    if (!error && data) {
        countBadge.textContent = data.length || 0;
        
        if (data.length > 0) {
            stagedSection.style.display = 'block';
            stagedOrders = data;
            editedStagedOrders = {}; // clear old edits
            renderStagedTable();
        } else {
            stagedSection.style.display = 'none';
        }
    }
}

document.getElementById('btnAssignation').addEventListener('click', async () => {
    menuPage.classList.remove('active');
    assignationPage.classList.add('active');
    
    // FETCH UPDATE: Expanded to include both technicians and supervisors
    const { data, error } = await supabaseClient  
        .from('profiles')  
        .select('username')  
        .or('role.ilike.%technician%,role.ilike.%supervisor%');
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

    // --- NEW: RESET CHECKBOXES & SELECTIONS ON PAGE OPEN ---
    selectedAssignationOrders.clear();
    
    // Uncheck the "Select All" box visually if it was left checked
    const selectAllBox = document.getElementById('selectAllAssignCheckbox');
    if (selectAllBox) {
        selectAllBox.checked = false;
    }
    // -------------------------------------------------------

    // --- 1. SET UP USER KEYS FIRST ---
    const userKey = currentUser ? currentUser.username : 'guest';
    const savedAssignOrder = localStorage.getItem('assign_order_' + userKey);
    

    // --- 2. LAYOUT FIX: LOAD SAVED COLUMN ORDER ---
    if (savedAssignOrder) {
        // Empty the default array and fill it with their saved custom order
        const parsedOrder = JSON.parse(savedAssignOrder);
        ASSIGN_COLUMNS.length = 0;
        ASSIGN_COLUMNS.push(...parsedOrder);
    }

    // --- 3. FORCE THE SCREEN TO CLEAR OLD DATA ---
    renderAssignationTable(); 
    document.getElementById('batchSoInput').value = '';
    
    // --- 4. UPDATE STAGING BADGE ---
    updateStagingCount();

    // --- 5. SHOW RESTORE BUTTON ---
    document.getElementById('assignRestoreLocalBtn').style.display = 'inline-block';
});


// --- LOCAL PROGRESS SAVING ENGINE in the daily assignation page  ---

document.getElementById('assignSaveLocalBtn').addEventListener('click', () => {
    if (assignationOrders.length === 0 && Object.keys(editedAssignations).length === 0) {
        alert("No orders to save!");
        return;
    }

    const backupData = {
        orders: assignationOrders,
        edits: editedAssignations
    };

    // 1. Create a JSON file from the data
    const blob = new Blob([JSON.stringify(backupData)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    
    // 2. Generate a clean filename with the current date
    const dateStr = new Date().toISOString().split('T')[0];
    link.download = `Assignation_Progress_${dateStr}.json`;
    
    // 3. Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    alert("💾 Progress downloaded successfully! Keep this file safe to restore your work later.");
});

document.getElementById('assignRestoreLocalBtn').addEventListener('click', () => {
    // Force click the hidden file input
    document.getElementById('assignRestoreFileInput').click();
});

document.getElementById('assignRestoreFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const backup = JSON.parse(evt.target.result);
            assignationOrders = backup.orders || [];
            editedAssignations = backup.edits || {};

            renderAssignationTable();
            alert("🔄 Progress successfully restored from file!");
        } catch (err) {
            alert("Error reading backup file. Make sure it is a valid JSON file generated by this system.");
        }
        
        // Reset the input so they can upload the exact same file again if they make a mistake
        e.target.value = '';
    };
    reader.readAsText(file);
});


document.getElementById('assignHubBtn').addEventListener('click', () => {
    if (Object.keys(editedAssignations).length > 0) {
        if (!confirm("Discard unsaved assignations?")) return;
    }
    assignationPage.classList.remove('active');
    menuPage.classList.add('active');
});

// --- ASSIGNATION ENGINE ---

document.getElementById('btnFetchBatchSo').addEventListener('click', () => {
    const rawText = document.getElementById('batchSoInput').value;
    // Split by comma or newline and clean up spaces
    const soList = rawText.split(/[\n,]+/).map(s => s.trim()).filter(s => s);
    fetchOrdersForAssignation(soList);
});

// --- ALLOW 'ENTER' KEY TO FETCH ORDERS and Shift+Enter = new line---

// Listen to the large text area box for key presses
document.getElementById('batchSoInput').addEventListener('keydown', (e) => {
    // Check if the key pressed is 'Enter' AND they are NOT holding the 'Shift' key
    if (e.key === 'Enter' && !e.shiftKey) {
        // Stop the text box from creating a normal new line
        e.preventDefault(); 
        // Force the code to "click" the Fetch button automatically
        document.getElementById('btnFetchBatchSo').click();
    }
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
    // We force everything to be a String so the computer compares them perfectly
    const newSOs = ordersData.map(d => String(d.so));
    assignationOrders = [...assignationOrders.filter(o => !newSOs.includes(String(o.so))), ...ordersData];
    
    renderAssignationTable();
    document.getElementById('batchSoInput').value = '';

    // 4. Check for missing orders and copy to clipboard
    const missingSOs = soArray.filter(so => !newSOs.includes(String(so)));
    
    if (missingSOs.length > 0) {
        // Join the missing orders with a new line so they stack neatly when pasted
        const missingText = missingSOs.join('\n');
        
        navigator.clipboard.writeText(missingText).then(() => {
            alert(`Fetched ${ordersData.length} orders.\n\n⚠️ Could not find ${missingSOs.length} order(s) in the system. The missing SO numbers have been automatically copied to your clipboard so you can add them!`);
        }).catch(err => {
            alert(`Fetched ${ordersData.length} orders. Missing ${missingSOs.length} orders, but your browser blocked the clipboard copy action.`);
        });
    } else {
        // If everything was found, just show a standard success message
        alert(`Success! Fetched all ${ordersData.length} orders.`);
    }
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
        checkHeader.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center;"><input type="checkbox" id="selectAllAssignCheckbox" style="margin-bottom: 2px; width: auto;"><span style="font-size: 11px;">Select All</span></div>`;
        headerRow.appendChild(checkHeader);

        // Attach Select All logic (Fixed: Forces actual memory update)
        checkHeader.querySelector('#selectAllAssignCheckbox').addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            // Target only the visible checkboxes currently loaded in the table body
            const rowCheckboxes = document.querySelectorAll('#assignTableBody input[type="checkbox"]');
            
            rowCheckboxes.forEach(box => {
                // Only update if it actually needs to change
                if (box.checked !== isChecked) {
                    box.checked = isChecked;
                    // This command forces the individual checkbox to save its specific SO to memory!
                    box.dispatchEvent(new Event('change')); 
                }
            });
        });
        const checkFilter = document.createElement('th');
        filterRow.appendChild(checkFilter);
        // --- end of Add empty header cells for the checkbox column ---


        ASSIGN_COLUMNS.forEach(colKey => {
            // 1. Header with Sorting capability
            const th = document.createElement('th');
            const displayName = colKey === 'so' ? 'SO' : colKey;
            th.innerHTML = `
                <div class="header-wrapper" style="display: flex; justify-content: center; align-items: center; width: 100%;">
                    <span class="sort-header" style="cursor:pointer; font-weight: bold;">${displayName}</span>
                </div>
            `;
            
            th.querySelector('.sort-header').addEventListener('click', () => {
                sortAssignationColumn(colKey);
            });
            headerRow.appendChild(th);

            // 2. Filter Input Box (Creates text input and dropdown)
            const filterTd = document.createElement('th');
            
            const textFilter = document.createElement('input');
            textFilter.type = 'text';
            textFilter.placeholder = 'Search...';
            textFilter.dataset.column = colKey;
            textFilter.style.width = '100%';
            textFilter.style.boxSizing = 'border-box';
            textFilter.style.marginBottom = '2px';
            textFilter.addEventListener('input', runAssignationFilters);
            filterTd.appendChild(textFilter);

            const filterSelect = document.createElement('select');
            filterSelect.dataset.column = colKey;

            // Add these 3 styling lines:
            filterSelect.style.width = '100%';
            filterSelect.style.boxSizing = 'border-box';
            filterSelect.style.display = 'block';

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

        select.innerHTML = `
            <option value="">-- All --</option>
            <option value="[BLANK]">-- Blank --</option>
        `;
        
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
    dataToRender.forEach((row, index) => { // <-- Added 'index' here
        const tr = document.createElement('tr');
        const currentSO = row.so;

        // --- PHASE 2.1: EXTRACT SLA FLAG ---
        const returnVal = (editedAssignations[currentSO] && editedAssignations[currentSO]['return'] !== undefined) 
            ? editedAssignations[currentSO]['return'] 
            : (row['return'] || '');
        const returnValStr = returnVal ? String(returnVal).toLowerCase() : '';
        // -----------------------------------

        // --- Inject Row Number Cell ---
        const indexTd = document.createElement('td');
        indexTd.textContent = index + 1;
        indexTd.style.textAlign = 'center';
        indexTd.style.fontWeight = 'bold';
        tr.appendChild(indexTd);

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

            // --- MAKE SO CLICKABLE & READ-ONLY ---
            if (colKey === 'so') {
                input.readOnly = true; 
                input.style.cursor = 'pointer';
                input.style.color = 'var(--text-color)'; 
                input.style.textDecoration = 'none';
                input.style.fontWeight = '900'; 
                
                // --- PHASE 2.1: CELL-LEVEL SLA STYLING ---
                if (returnValStr.startsWith('return')) {
                    input.style.backgroundColor = 'rgba(211, 47, 47, 0.2)'; // Light Red
                } else if (returnValStr.startsWith('redo')) {
                    input.style.backgroundColor = 'rgba(245, 124, 0, 0.2)'; // Light Yellowish/Orange
                }
                // -----------------------------------------

                input.addEventListener('click', () => {
                    openViewOnlyModal(row); // Opens the ticket!
                });
            }
            // -------------------------------------


            // Datalist Hookup for Technician
            if (colKey === 'assigned_tech') {
                input.setAttribute('list', 'technicianList');
                input.setAttribute('autocomplete', 'off'); 
                input.placeholder = "Select/Type Tech...";
                
                input.addEventListener('change', (e) => {
                    // Trim spaces before and after
                    const val = e.target.value.trim();
                    const lowerTechs = availableTechnicians.map(t => t.toLowerCase());
                    
                    if (val && !lowerTechs.includes(val.toLowerCase())) {
                        alert(`Error: '${val}' is not a recognized technician. Please select a valid name from the list.`);
                        e.target.value = ''; // Wipe the visual cell
                        
                        // Wipe it from memory so it doesn't accidentally save
                        if (!editedAssignations[currentSO]) {
                            editedAssignations[currentSO] = { ...row };
                        }
                        editedAssignations[currentSO][colKey] = '';
                    } else {
                        // If valid, ensure the trimmed version is saved visually and in memory
                        e.target.value = val;
                        if (!editedAssignations[currentSO]) {
                            editedAssignations[currentSO] = { ...row };
                        }
                        editedAssignations[currentSO][colKey] = val;
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
    const filterSelects = document.querySelectorAll('#assignFilterRow select');
    const filterInputs = document.querySelectorAll('#assignFilterRow input[type="text"]');
    let filteredData = [...assignationOrders];

    filterSelects.forEach(select => {
        const val = select.value;
        const colKey = select.dataset.column;

        if (val === "[BLANK]") {
            filteredData = filteredData.filter(row => {
                const cellValue = (editedAssignations[row.so] && editedAssignations[row.so][colKey] !== undefined)
                    ? String(editedAssignations[row.so][colKey]).trim()
                    : String(row[colKey] || '').trim();
                return cellValue === '';
            });
        } else if (val !== "") {
            filteredData = filteredData.filter(row => {
                const cellValue = (editedAssignations[row.so] && editedAssignations[row.so][colKey] !== undefined)
                    ? String(editedAssignations[row.so][colKey])
                    : String(row[colKey] || '');
                return cellValue === val;
            });
        }
    });

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

function renderStagedTable(dataToRender = stagedOrders) {
    const headerRow = document.getElementById('stagedHeaderRow');
    const filterRow = document.getElementById('stagedFilterRow');
    const tbody = document.getElementById('stagedTableBody');

    // Build headers and filters if empty
    if (headerRow.children.length === 0) {

        // --- Inject Row Number Header ---
        const indexHeader = document.createElement('th');
        indexHeader.textContent = "#";
        indexHeader.style.width = "40px";
        headerRow.appendChild(indexHeader);

        const indexFilter = document.createElement('th');
        filterRow.appendChild(indexFilter);

        STAGED_COLUMNS.forEach(colKey => {
            const th = document.createElement('th');
            th.innerHTML = `<span style="font-weight:bold;">${colKey === 'so' ? 'SO' : colKey}</span>`;
            headerRow.appendChild(th);

            const filterTd = document.createElement('th');
            const filterSelect = document.createElement('select');
            filterSelect.dataset.column = colKey;
            filterSelect.style.width = '100%';
            filterSelect.style.boxSizing = 'border-box';
            filterSelect.addEventListener('change', runStagedFilters);
            filterTd.appendChild(filterSelect);
            filterRow.appendChild(filterTd);
        });
    }

    // Refresh dropdown options
    document.querySelectorAll('#stagedFilterRow select').forEach(select => {
        const colKey = select.dataset.column;
        const currentSelection = select.value;
        select.innerHTML = `<option value="">-- All --</option><option value="[BLANK]">-- Blank --</option>`;
        
        const uniqueValues = new Set();
        stagedOrders.forEach(row => {
            let val = (editedStagedOrders[row.so] && editedStagedOrders[row.so][colKey] !== undefined) 
                ? editedStagedOrders[row.so][colKey] : row[colKey];
            if (val && String(val).trim() !== '') uniqueValues.add(String(val).trim());
        });

        Array.from(uniqueValues).sort().forEach(val => select.appendChild(new Option(val, val)));
        select.value = currentSelection;
    });

    tbody.innerHTML = '';

    // Build Rows
    dataToRender.forEach((row, index) => { // <-- Added 'index' here
        const tr = document.createElement('tr');
        const currentSO = row.so;

        // --- PHASE 2.1: EXTRACT SLA FLAG ---
        const returnVal = (editedStagedOrders[currentSO] && editedStagedOrders[currentSO]['return'] !== undefined) 
            ? editedStagedOrders[currentSO]['return'] 
            : (row['return'] || '');
        const returnValStr = returnVal ? String(returnVal).toLowerCase() : '';
        // -----------------------------------

        // --- Inject Row Number Cell ---
        const indexTd = document.createElement('td');
        indexTd.textContent = index + 1;
        indexTd.style.textAlign = 'center';
        indexTd.style.fontWeight = 'bold';
        tr.appendChild(indexTd);

        STAGED_COLUMNS.forEach(colKey => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            
            let currentValue = (editedStagedOrders[currentSO] && editedStagedOrders[currentSO][colKey] !== undefined) 
                ? editedStagedOrders[currentSO][colKey] : (row[colKey] || '');

            input.value = currentValue;

            if (colKey === 'so') {
                input.readOnly = true; 
                input.style.cursor = 'pointer';
                input.style.color = 'var(--text-color)'; 
                input.style.fontWeight = '900'; 

                // --- PHASE 2.1: CELL-LEVEL SLA STYLING ---
                if (returnValStr.startsWith('return')) {
                    input.style.backgroundColor = 'rgba(211, 47, 47, 0.2)'; // Light Red
                } else if (returnValStr.startsWith('redo')) {
                    input.style.backgroundColor = 'rgba(245, 124, 0, 0.2)'; // Light Yellowish/Orange
                }
                // -----------------------------------------
                
                input.addEventListener('click', async () => {
                    // Try to find the order in memory, or fetch it live to view the ticket
                    let fullOrder = databaseOrders.find(o => String(o.so) === String(currentSO)) || assignationOrders.find(o => String(o.so) === String(currentSO));
                    if (!fullOrder) {
                        const { data } = await supabaseClient.from('orders').select('*').eq('so', currentSO).single();
                        fullOrder = data;
                    }
                    if (fullOrder) openViewOnlyModal(fullOrder);
                });
            } else if (colKey === 'assigned_tech') {
                input.setAttribute('list', 'technicianList');
                input.setAttribute('autocomplete', 'off'); 
            } else if (colKey === 'rout') {
                input.setAttribute('list', 'routList');
                input.setAttribute('autocomplete', 'off'); 
            }

            input.addEventListener('input', (e) => {
                if (!editedStagedOrders[currentSO]) editedStagedOrders[currentSO] = { ...row };
                editedStagedOrders[currentSO][colKey] = e.target.value;
            });

            td.appendChild(input);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function runStagedFilters() {
    const filterSelects = document.querySelectorAll('#stagedFilterRow select');
    let filteredData = [...stagedOrders];

    filterSelects.forEach(select => {
        const val = select.value;
        const colKey = select.dataset.column;

        if (val === "[BLANK]") {
            filteredData = filteredData.filter(row => {
                const cellValue = (editedStagedOrders[row.so] && editedStagedOrders[row.so][colKey] !== undefined)
                    ? String(editedStagedOrders[row.so][colKey]).trim() : String(row[colKey] || '').trim();
                return cellValue === '';
            });
        } else if (val !== "") {
            filteredData = filteredData.filter(row => {
                const cellValue = (editedStagedOrders[row.so] && editedStagedOrders[row.so][colKey] !== undefined)
                    ? String(editedStagedOrders[row.so][colKey]) : String(row[colKey] || '');
                return cellValue === val;
            });
        }
    });
    renderStagedTable(filteredData);
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

// --- STEP 1: STAGE TOMORROW'S ORDERS ---
document.getElementById('stageTomorrowBtn').addEventListener('click', async () => {
    const recordsToProcess = Object.values(editedAssignations);
    if (recordsToProcess.length === 0) {
        alert("No assignations to stage. Please edit some orders first.");
        return;
    }

    // Prepare payload matching the exact columns in your new table
    const stagingPayload = recordsToProcess.map(record => ({
        so: record.so,
        assigned_tech: record.assigned_tech || '',
        rout: record.rout || '',
        remark: record.remark || '',
        status_comment: record.status_comment || '',
        part_1: record.part_1 || '',
        qty_1: record.qty_1 || '',
        part_2: record.part_2 || '',
        qty_2: record.qty_2 || '',
        part_3: record.part_3 || '',
        qty_3: record.qty_3 || '',
        part_4: record.part_4 || '',
        qty_4: record.qty_4 || '',
        part_5: record.part_5 || '',
        qty_5: record.qty_5 || ''
    }));

    // Upsert into tomorrow_schedule (Safely overwrites if the SO is already staged)
    const { error } = await supabaseClient
        .from('tomorrow_schedule')
        .upsert(stagingPayload, { onConflict: 'so' });

    if (error) {
        alert("Failed to stage orders: " + error.message);
    } else {
        alert("Orders successfully staged for tomorrow!");
        // Clear the screen so it's ready for the next batch
        localStorage.removeItem('assign_backup_' + (currentUser ? currentUser.username : 'guest'));
        document.getElementById('assignRestoreLocalBtn').style.display = 'none';
        assignationOrders = [];
        editedAssignations = {};
        renderAssignationTable(); 
        updateStagingCount(); 
    }
});

// --- STEP 3: ASSIGN NOW (INSTANT LIVE PUSH) ---
document.getElementById('assignNowInstantBtn').addEventListener('click', async () => {
    const recordsToProcess = Object.values(editedAssignations);
    
    if (recordsToProcess.length === 0) {
        alert("No assignations to push. Please edit some orders first.");
        return;
    }

    if (!confirm(`⚡ WARNING: You are about to instantly push ${recordsToProcess.length} order(s) live to the technicians' phones right now. Proceed?`)) {
        return;
    }

    const instantBtn = document.getElementById('assignNowInstantBtn');
    instantBtn.disabled = true;
    instantBtn.textContent = 'Pushing...';

    // Grab current time for the history log
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const targetDate = `${dd}-${mm}-${yyyy}`;
    const targetTime = `${hh}:${min}`;

    // 1. Safely update the main 'orders' table directly
    const updatePromises = recordsToProcess.map(record => {
        let orderUpdate = {
            assigned_tech: record.assigned_tech || '',
            rout: record.rout || '',
            remark: record.remark || '',
            status_comment: record.status_comment || '',
            part_1: record.part_1 || '',
            qty_1: record.qty_1 || '',
            part_2: record.part_2 || '',
            qty_2: record.qty_2 || '',
            part_3: record.part_3 || '',
            qty_3: record.qty_3 || '',
            part_4: record.part_4 || '',
            qty_4: record.qty_4 || '',
            part_5: record.part_5 || '',
            qty_5: record.qty_5 || ''
        };
        
        // Force the ticket to hit their active queue
        if (record.assigned_tech && record.assigned_tech.trim() !== '') {
            orderUpdate.status = 'Technician';
        }
        
        return supabaseClient.from('orders').update(orderUpdate).eq('so', record.so);
    });

    const updateResults = await Promise.all(updatePromises);
    const failedUpdate = updateResults.find(res => res.error);
    
    if (failedUpdate) {
        alert("Failed to instantly assign orders: " + failedUpdate.error.message);
        instantBtn.disabled = false;
        instantBtn.textContent = '⚡ Assign Now (Instant)';
        return;
    }

    // 2. Prepare payload for the 'repair_log' table
    const repairLogPayload = recordsToProcess.map(record => ({
        so: record.so,
        assigned_tech: record.assigned_tech || '',
        assigned_by: currentUser ? currentUser.username : 'Unknown',
        assign_date: targetDate,
        assign_time: targetTime,
        status: "Technician" 
    }));

    // 3. Execute Log Updates
    const { error: logErr } = await supabaseClient.from('repair_log').insert(repairLogPayload);

    if (logErr) {
        alert("Orders assigned, but failed to log history: " + logErr.message);
    } else {

        // TRIGGER CALL CENTER (if settings page allow it)
        const dispatchedSOs = recordsToProcess.map(r => r.so);
        if (typeof window.pushToCCQueue === 'function') {
            window.pushToCCQueue(dispatchedSOs, 'dispatch_live');
        }

        alert("⚡ Success! Orders instantly dispatched to the technicians!");
        
        // Clear the screen ready for the next batch
        localStorage.removeItem('assign_backup_' + (currentUser ? currentUser.username : 'guest'));
        document.getElementById('assignRestoreLocalBtn').style.display = 'none';
        assignationOrders = [];
        editedAssignations = {};
        renderAssignationTable();
    }

    instantBtn.disabled = false;
    instantBtn.textContent = '⚡ Assign Now (Instant)';
});


// --- STEP 2: PUSH STAGED ORDERS LIVE ---
document.getElementById('pushLiveBtn').addEventListener('click', async () => {
    
    // 1. Fetch all staged orders from the holding area
    const { data: stagedOrders, error: fetchErr } = await supabaseClient
        .from('tomorrow_schedule')
        .select('*');
        
    if (fetchErr) {
        alert("Error checking staging area: " + fetchErr.message);
        return;
    }
    
    if (!stagedOrders || stagedOrders.length === 0) {
        alert("There are no orders in the staging area to push live.");
        return;
    }

    // 2. Strict Confirmation
    if (!confirm(`Are you sure you want to push ${stagedOrders.length} staged orders live to the technicians now?`)) {
        return;
    }

    // Lock the button to prevent double clicks
    const pushBtn = document.getElementById('pushLiveBtn');
    pushBtn.disabled = true;
    pushBtn.textContent = 'Processing...';

    // Grab the exact current moment
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const targetDate = `${dd}-${mm}-${yyyy}`;
    const targetTime = `${hh}:${min}`;
    // ---STATUS CHECKER FOR BACK_OFFICE ---
    
    // 1. Extract just the SO numbers from the orders we want to push
    const stagedSoNumbers = stagedOrders.map(record => record.so);

    // 2. Ask the main 'orders' database table what the current status is for these SOs
    const { data: currentOrdersDb, error: currentDbErr } = await supabaseClient
        .from('orders')
        .select('so, status')
        .in('so', stagedSoNumbers);

    if (currentDbErr) {
        alert("Failed to verify current order statuses: " + currentDbErr.message);
        pushBtn.disabled = false;
        pushBtn.textContent = '🚀 Push Live Now';
        return; // Stop the push if the check fails
    }

    // 3. Create two empty lists to sort the orders into
    const allowedToPush = [];
    const blockedBackOfficeSOs = []; // Tracks only the SO numbers that get blocked

    // 4. Sort the orders
    stagedOrders.forEach(stagedOrder => {
        // Find the matching current record from the database list we just downloaded
        const match = currentOrdersDb.find(o => String(o.so) === String(stagedOrder.so));
        
        // If it exists in the database AND its status is 'back_office' OR 'Tracking'
        if (match && (match.status === 'back_office' || match.status === 'Tracking')) {
            // Add it to the blocked list (we will skip pushing this)
            blockedBackOfficeSOs.push(stagedOrder.so);
        } else {
            // Otherwise, it is safe to push to the technicians!
            allowedToPush.push(stagedOrder);
        }
    });

    // If absolutely ALL orders were blocked, stop here
    if (allowedToPush.length === 0) {
        alert(`Process stopped. All ${blockedBackOfficeSOs.length} staged order(s) are currently in 'back_office' or 'Tracking' status and cannot be pushed.`);
        // Clean up the staging table anyway since these are dead orders
        await supabaseClient.from('tomorrow_schedule').delete().neq('so', '0');
        updateStagingCount();
        pushBtn.disabled = false;
        pushBtn.textContent = '🚀 Push Live Now';
        return;
    }
    // --- END NEW STATUS CHECKER ---


    // 5. Safely update the main 'orders' table using ONLY the allowed orders
    // NOTICE: We changed stagedOrders to allowedToPush here!
    const updatePromises = allowedToPush.map(record => {
        let orderUpdate = {
            assigned_tech: record.assigned_tech || '',
            rout: record.rout || '',
            remark: record.remark || '',
            status_comment: record.status_comment || '',
            part_1: record.part_1 || '',
            qty_1: record.qty_1 || '',
            part_2: record.part_2 || '',
            qty_2: record.qty_2 || '',
            part_3: record.part_3 || '',
            qty_3: record.qty_3 || '',
            part_4: record.part_4 || '',
            qty_4: record.qty_4 || '',
            part_5: record.part_5 || '',
            qty_5: record.qty_5 || ''
        };
        
        // Auto-update status so it hits the technicians' screens
        if (record.assigned_tech && record.assigned_tech.trim() !== '') {
            orderUpdate.status = 'Technician';
        }
        
        return supabaseClient.from('orders').update(orderUpdate).eq('so', record.so);
    });

    const updateResults = await Promise.all(updatePromises);
    const failedUpdate = updateResults.find(res => res.error);
    
    if (failedUpdate) {
        alert("Failed to update live orders: " + failedUpdate.error.message);
        pushBtn.disabled = false;
        pushBtn.textContent = '🚀 Push Live Now';
        return;
    }

   // 6. Prepare payload for the 'repair_log' table using ONLY allowed orders
    const repairLogPayload = allowedToPush.map(record => ({
        so: record.so,
        assigned_tech: record.assigned_tech || '',
        assigned_by: currentUser ? currentUser.username : 'Unknown',
        assign_date: targetDate,
        assign_time: targetTime,
        status: "Technician" 
    }));

    // 7. Execute Log Updates
    const { error: logErr } = await supabaseClient.from('repair_log').insert(repairLogPayload);

    if (logErr) {
        alert("Orders updated, but failed to sync repair log: " + logErr.message);
        pushBtn.disabled = false;
        pushBtn.textContent = '🚀 Push Live Now';
        return;
    }

    // TRIGGER CALL CENTER
    const pushedSOs = allowedToPush.map(r => r.so);
    if (typeof window.pushToCCQueue === 'function') {
        window.pushToCCQueue(pushedSOs, 'dispatch_live');
    }

    // 8. Final Cleanup: Wipe the entire staging table completely clean
    const { error: deleteErr } = await supabaseClient.from('tomorrow_schedule').delete().neq('so', '0');

    // 9. NEW: Custom Alert Message showing successes and skips
    let finalMessage = `🚀 Success! ${allowedToPush.length} order(s) successfully pushed to technicians.`;
    
    // If any orders were skipped because they were back_office, add them to the message
    if (blockedBackOfficeSOs.length > 0) {
        finalMessage += `\n\n⚠️ ${blockedBackOfficeSOs.length} order(s) were skipped because they are in 'back_office' or 'Tracking' status:\n`;
        // Join the skipped SOs together with commas
        finalMessage += blockedBackOfficeSOs.join(', ');
    }

    if (deleteErr) {
        alert(finalMessage + "\n\n(Note: Failed to clear the staging table. Please manually clear it.)");
    } else {
        alert(finalMessage);
    }
    
    updateStagingCount();
    pushBtn.disabled = false;
    pushBtn.textContent = '🚀 Push Live Now';
});

document.getElementById('updateStagedBtn').addEventListener('click', async () => {
    const recordsToUpdate = Object.values(editedStagedOrders);
    
    if (recordsToUpdate.length === 0) {
        alert("No changes detected to update.");
        return;
    }

    // Push changes directly to the staging table
    const { error } = await supabaseClient
        .from('tomorrow_schedule')
        .upsert(recordsToUpdate, { onConflict: 'so' });

    if (error) {
        alert("Failed to update staged orders: " + error.message);
    } else {
        alert("Staged orders successfully updated!");
        // Refresh the counter and redraw the table with fresh data
        updateStagingCount(); 
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