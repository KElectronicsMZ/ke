// ==========================================
// --- FLEET LOGISTICS & SCHEDULING ENGINE ---
// ==========================================

let fleetDrivers = [];
let fleetTechs = [];
let currentFleetPerms = {}; // Tracks logged-in user's fleet field-level permissions
let activeFleetDate = null; // Tracks the currently viewed schedule date

// Format Date to YYYY-MM-DD for HTML Calendar Inputs
function getTodayHtmlDate() {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Convert HTML Calendar (YYYY-MM-DD) to Database Target (DD-MM-YYYY)
function formatToDbDate(htmlDate) {
    if (!htmlDate) return "";
    const parts = htmlDate.split('-');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    return htmlDate;
}

// Initialize Page: Fetch Users & Setup Defaults
async function initializeFleetManager() {
    if (typeof showGlobalLoader === 'function') showGlobalLoader("Loading Fleet Data...");

    // 1. Fetch Users from Profiles (Now capturing JSONB fleet_permissions)
    const { data: profiles, error } = await supabaseClient
        .from('profiles')
        .select('username, role, fleet_permissions');

    if (error) {
        if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
        alert("Error loading users: " + error.message);
        return;
    }

    // Extract field-level permissions for the currently logged-in user
    if (typeof currentUser !== 'undefined' && currentUser) {
        const myProfile = profiles.find(p => p.username === currentUser.username);
        currentFleetPerms = myProfile?.fleet_permissions || {};
    }

    // 2. Separate into specific role lists (Case-insensitive check)
    fleetDrivers = profiles.filter(p => p.role && p.role.toLowerCase().includes('driver')).map(p => p.username);
    fleetTechs = profiles.filter(p => p.role && (p.role.toLowerCase().includes('technician') || p.role.toLowerCase().includes('supervisor'))).map(p => p.username);

    // 3. Populate DOM Datalists
    const driverList = document.getElementById('fleetDriverList');
    const techList = document.getElementById('fleetTechList');
    
    if (driverList) {
        driverList.innerHTML = '';
        fleetDrivers.forEach(u => driverList.appendChild(new Option(u)));
    }
    
    if (techList) {
        techList.innerHTML = '';
        fleetTechs.forEach(u => techList.appendChild(new Option(u)));
    }

    // 4. Hydrate Table with Active Pairings
    const tbody = document.getElementById('fleetScheduleBody');
    if (tbody) {
        tbody.innerHTML = '';
        
        // Setup Date Tracker
        if (!activeFleetDate) activeFleetDate = getTodayHtmlDate();
        const activeDbDate = formatToDbDate(activeFleetDate);
        
        // Update UI Header
        const dateLabel = document.getElementById('fleetActiveDateLabel');
        if (dateLabel) dateLabel.textContent = `(${activeDbDate})`;

        const { data: activePairings, error: pairError } = await supabaseClient
            .from('fleet_pairing')
            .select('*')
            .eq('date', activeDbDate);

        if (pairError) {
            console.error("Database Error: Failed to fetch active pairings.", pairError);
            addFleetRow(); // Fallback to blank row
        } else if (activePairings && activePairings.length > 0) {
            // Render existing backend records
            activePairings.forEach(row => addFleetRow(row));
        } else {
            // Empty schedule, provide blank template
            addFleetRow(); 
        }
    }

    if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
}

// Dynamic Row Generator
function addFleetRow(rowData = null) {
    const tbody = document.getElementById('fleetScheduleBody');
    if (!tbody) return;

    // Standardize input mappings for new rows vs pre-hydrated database rows
    const dateVal = rowData && rowData.date ? rowData.date.split('-').reverse().join('-') : activeFleetDate;
    const driverVal = rowData && rowData.driver_username ? rowData.driver_username : '';
    const techVal = rowData && rowData.tech_username ? rowData.tech_username : '';
    const routVal = rowData && rowData.rout ? rowData.rout : '';
    const commentVal = rowData && rowData.comments ? rowData.comments : '';

    const tr = document.createElement('tr');
    
    // Evaluate ACL matrix for the current user
    const date_state = currentFleetPerms['date'] ? '' : 'disabled';
    const d_state = currentFleetPerms['driver_username'] ? '' : 'disabled';
    const t_state = currentFleetPerms['tech_username'] ? '' : 'disabled';
    const r_state = currentFleetPerms['rout'] ? '' : 'disabled';
    const c_state = currentFleetPerms['comments'] ? '' : 'disabled';
    
    // UI Style Generator for locked fields
    const getStyle = (state) => state === 'disabled' 
        ? 'padding: 6px; width: 100%; box-sizing: border-box; border: 1px dashed var(--border-color); background: rgba(0,0,0,0.1); color: var(--text-color); border-radius: 4px; cursor: not-allowed; opacity: 0.7;'
        : 'padding: 6px; width: 100%; box-sizing: border-box; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); border-radius: 4px;';
    
    tr.innerHTML = `
        <td><input type="date" class="fleet-date-input" value="${dateVal}" ${date_state} style="${getStyle(date_state)}"></td>
        <td><input type="text" class="fleet-driver-input" list="fleetDriverList" placeholder="Driver..." value="${driverVal}" ${d_state} style="${getStyle(d_state)}"></td>
        <td><input type="text" class="fleet-tech-input" list="fleetTechList" placeholder="Tech..." value="${techVal}" ${t_state} style="${getStyle(t_state)}"></td>
        <td><input type="text" class="fleet-route-input" list="fleetRouteList" placeholder="Route..." value="${routVal}" ${r_state} style="${getStyle(r_state)}"></td>
        <td><input type="text" class="fleet-comment-input" placeholder="Comments..." value="${commentVal}" ${c_state} style="${getStyle(c_state)}"></td>
        <td style="text-align: center;"><button class="secondary-btn btn-remove-fleet-row" style="background-color: #d32f2f; color: white; border: none; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-weight: bold;">X</button></td>
    `;

    // Row Removal Event
    tr.querySelector('.btn-remove-fleet-row').addEventListener('click', () => {
        tr.remove();
    });

    tbody.appendChild(tr);
}

// Attach Static DOM Listeners
document.addEventListener('DOMContentLoaded', () => {
    const btnAdd = document.getElementById('btnAddFleetRow');
    if (btnAdd) btnAdd.addEventListener('click', () => addFleetRow());

    const btnSave = document.getElementById('btnSaveFleetSchedule');
    if (btnSave) btnSave.addEventListener('click', saveFleetSchedule);
    
    const btnLoadTomorrow = document.getElementById('btnLoadTomorrowFleet');
    if (btnLoadTomorrow) btnLoadTomorrow.addEventListener('click', function() {
        if (this.innerHTML.includes('Tomorrow')) {
            const tmrw = new Date();
            tmrw.setDate(tmrw.getDate() + 1);
            const y = tmrw.getFullYear();
            const m = String(tmrw.getMonth() + 1).padStart(2, '0');
            const d = String(tmrw.getDate()).padStart(2, '0');
            activeFleetDate = `${y}-${m}-${d}`;
            this.innerHTML = '⏮️ Load Today';
        } else {
            activeFleetDate = getTodayHtmlDate();
            this.innerHTML = '⏭️ Load Tomorrow';
        }
        initializeFleetManager();
    });
});

// Primary Save Execution
async function saveFleetSchedule() {
    const rows = document.querySelectorAll('#fleetScheduleBody tr');
    if (rows.length === 0) {
        alert("No rows to save.");
        return;
    }

    const payload = [];
    let hasErrors = false;

    rows.forEach((tr) => {
        const htmlDate = tr.querySelector('.fleet-date-input').value;
        const driver = tr.querySelector('.fleet-driver-input').value.trim();
        const tech = tr.querySelector('.fleet-tech-input').value.trim();
        const rout = tr.querySelector('.fleet-route-input').value.trim();
        
        // Safely extract the comment (optional field)
        const commentInput = tr.querySelector('.fleet-comment-input');
        const comments = commentInput ? commentInput.value.trim() : '';

        if (!htmlDate) {
            hasErrors = true;
            tr.style.backgroundColor = 'rgba(211, 47, 47, 0.1)'; // Highlight missing data
        } else {
            tr.style.backgroundColor = '';
            payload.push({
                date: formatToDbDate(htmlDate), // Forces the required 'dd-mm-yyyy' format
                driver_username: driver,
                tech_username: tech,
                rout: rout,
                comments: comments
            });
        }
    });

    if (hasErrors) {
        alert("Please ensure a valid Date is selected for all rows.");
        return;
    }

    if (typeof showGlobalLoader === 'function') showGlobalLoader("Saving Fleet Schedule...");

    const btnSave = document.getElementById('btnSaveFleetSchedule');
    btnSave.disabled = true;

    // 1. Extract unique dates to perform a clean sync for the targeted days
    const uniqueDates = [...new Set(payload.map(p => p.date))];
    if (uniqueDates.length > 0) {
        await supabaseClient.from('fleet_pairing').delete().in('date', uniqueDates);
    }

    // 2. Insert the fresh payload reflecting the exact UI state
    const { error } = await supabaseClient.from('fleet_pairing').insert(payload);

    btnSave.disabled = false;
    if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

    if (error) {
        alert("Failed to save schedule: " + error.message);
    } else {
        alert("Fleet Schedule successfully saved!");
        // UI retention: We intentionally leave the DOM intact so the user does not lose their active view.
    }
}

// ==========================================
// --- HISTORICAL SCHEDULES ENGINE ---
// ==========================================

// Helper: Generate array of strictly formatted dd-mm-yyyy strings for Supabase querying
function generateDateRangeStrings(startDateStr, endDateStr) {
    let dateStrings = [];
    let currentDay = new Date(startDateStr);
    const endDay = new Date(endDateStr);

    while (currentDay <= endDay) {
        const dd = String(currentDay.getDate()).padStart(2, '0');
        const mm = String(currentDay.getMonth() + 1).padStart(2, '0');
        const yyyy = currentDay.getFullYear();
        dateStrings.push(`${dd}-${mm}-${yyyy}`);
        currentDay.setDate(currentDay.getDate() + 1); // Increment by 1 day
    }
    return dateStrings;
}

// Attach listener to the new orange button
document.addEventListener('DOMContentLoaded', () => {
    const btnFetchHistory = document.getElementById('btnFetchFleetHistory');
    if (btnFetchHistory) btnFetchHistory.addEventListener('click', fetchFleetHistory);
});

async function fetchFleetHistory() {
    const startInput = document.getElementById('fleetHistStartDate').value;
    const endInput = document.getElementById('fleetHistEndDate').value;

    if (!startInput || !endInput) {
        alert("Please select both a Start Date and an End Date.");
        return;
    }

    if (typeof showGlobalLoader === 'function') showGlobalLoader("Fetching Historical Schedules...");

    // 1. Generate array of all dates in range to bypass PostgREST text-date > < limitations
    const targetDates = generateDateRangeStrings(startInput, endInput);
    
    // 2. Fetch using the universal pagination engine from app.js
    const historyData = await fetchAllRecords('fleet_pairing', 'date', targetDates);

    if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

    if (!historyData || historyData.length === 0) {
        alert("No schedules found for the selected date range.");
        return;
    }

    renderFleetHistory(historyData);
}

function renderFleetHistory(data) {
    const container = document.getElementById('fleetHistoryContainer');
    if (!container) return;

    // Clear and unhide the container
    container.innerHTML = '';
    container.style.display = 'flex'; 

    // 1. Group the flat data array by Date
    const groupedData = {};
    data.forEach(row => {
        if (!groupedData[row.date]) groupedData[row.date] = [];
        groupedData[row.date].push(row);
    });

    // 2. Sort the dates descending (Newest first)
    const sortedDates = Object.keys(groupedData).sort((a, b) => {
        const dateA = new Date(a.split('-').reverse().join('-'));
        const dateB = new Date(b.split('-').reverse().join('-'));
        return dateB - dateA;
    });

    // 3. Render a distinct table for each day
    sortedDates.forEach(dateLabel => {
        const rows = groupedData[dateLabel];
        
        const dateBlock = document.createElement('div');
        dateBlock.style.cssText = "background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;";
        
        let tableHTML = `
            <h3 style="margin-top: 0; color: #f57c00; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">📅 Schedule for: ${dateLabel}</h3>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Driver سائق</th>
                            <th>Technician مهندس</th>
                            <th>Rout خط سير</th>
                            <th>Comments تعليقات</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        rows.forEach(row => {
            tableHTML += `
                <tr>
                    <td style="font-weight: bold; color: var(--text-color);">${row.driver_username || 'N/A'}</td>
                    <td style="font-weight: bold; color: #1976d2;">${row.tech_username || 'N/A'}</td>
                    <td>${row.rout || 'N/A'}</td>
                    <td>${row.comments || ''}</td>
                </tr>
            `;
        });

        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;
        
        dateBlock.innerHTML = tableHTML;
        container.appendChild(dateBlock);
    });
}

// ==========================================
// --- DRIVER GEOLOCATION & ACTION ENGINE ---
// ==========================================

// --- ARCHITECT MOD: DRIVER SHIFT TELEMETRY ENGINE ---
document.getElementById('btnDriverStart')?.addEventListener('click', function() {
    executeDriverShiftAction('start', this);
});

document.getElementById('btnDriverSignOff')?.addEventListener('click', function() {
    executeDriverShiftAction('end', this);
});

// --- ARCHITECT MOD: PERSISTENT UI SHIFT STATE ---
async function checkDriverShiftState() {
    const btnStart = document.getElementById('btnDriverStart');
    const btnSignOff = document.getElementById('btnDriverSignOff');
    if (!btnStart || !btnSignOff || !navigator.onLine || typeof currentUser === 'undefined' || !currentUser) return;

    const now = new Date();
    const dateStr = String(now.getDate()).padStart(2, '0') + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + now.getFullYear();

    btnStart.innerHTML = '⏳ Checking...';
    btnSignOff.innerHTML = '⏳ Checking...';

    const { data: existingShifts, error } = await supabaseClient
        .from('drivers_log')
        .select('action_type, action_time')
        .eq('driver_username', currentUser.username)
        .in('action_type', ['shift_start', 'shift_end'])
        .eq('action_date', dateStr);

    if (!error && existingShifts) {
        const startLog = existingShifts.find(s => s.action_type === 'shift_start');
        const endLog = existingShifts.find(s => s.action_type === 'shift_end');
        
        btnStart.innerHTML = startLog ? `✅ Day Started at ${startLog.action_time}` : '🟢 Start Day';
        btnSignOff.innerHTML = endLog ? `✅ Signed Off at ${endLog.action_time}` : '🔴 Sign Off';
    } else {
        btnStart.innerHTML = '🟢 Start Day';
        btnSignOff.innerHTML = '🔴 Sign Off';
    }
}

// --- ARCHITECT MOD: FIXED LOCATION TELEMETRY ---
document.getElementById('btnDriverLocationArrive')?.addEventListener('click', function() {
    const locSelect = document.getElementById('driverLocationSelect');
    const locationName = locSelect.value;
    if (!locationName) {
        alert("Please select a location from the dropdown first.");
        return;
    }
    logFixedLocationVisit(locationName, this);
});

async function logFixedLocationVisit(locationName, btnElement) {
    if (!navigator.onLine) {
        alert("An active internet connection is required to log location visits.");
        return;
    }

    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`; 

    btnElement.disabled = true;
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = '📍 Locating...';

    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        btnElement.disabled = false;
        btnElement.innerHTML = originalText;
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

        btnElement.innerHTML = '⏳ Saving...';

        // Storing the branch name in the 'so' column
        const payload = {
            driver_username: currentUser.username,
            action_type: 'branch_visit',
            action_date: dateStr,
            action_time: timeStr,
            location_link: mapsUrl,
            so: locationName 
        };

        const { error } = await supabaseClient.from('drivers_log').insert(payload);

        if (error) {
            alert("Failed to log visit: " + error.message);
            btnElement.disabled = false;
            btnElement.innerHTML = originalText;
        } else {
            alert(`Successfully logged arrival at ${locationName}!`);
            btnElement.innerHTML = '✅ Saved';
            
            setTimeout(() => {
                btnElement.disabled = false;
                btnElement.innerHTML = originalText;
                document.getElementById('driverLocationSelect').value = ''; // Reset dropdown
            }, 3000);
        }

    }, (error) => {
        alert("Failed to acquire location. Ensure GPS is enabled. Error: " + error.message);
        btnElement.disabled = false;
        btnElement.innerHTML = originalText;
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}
// ------------------------------------------------

async function executeDriverShiftAction(actionType, btnElement) {
    if (!navigator.onLine) {
        alert("An active internet connection is required to log your shift.");
        return;
    }

    // 1. Generate precise timestamps (Strictly dd-mm-yyyy for repair_log)
    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`; 

    // 2. Lock UI to prevent double-firing
    btnElement.disabled = true;
    const originalText = btnElement.innerHTML;
    
    // --- ARCHITECT MOD: FRONT-END PRE-FLIGHT CHECK ---
    btnElement.innerHTML = '⏳ Checking...';
    const targetAction = actionType === 'start' ? 'shift_start' : 'shift_end';
    
    const { data: existingShift, error: checkError } = await supabaseClient
        .from('drivers_log')
        .select('id')
        .eq('driver_username', currentUser.username)
        .eq('action_type', targetAction)
        .eq('action_date', dateStr)
        .limit(1);

    if (existingShift && existingShift.length > 0) {
        alert(`Your shift ${actionType === 'start' ? 'start' : 'sign off'} has already been recorded for today.`);
        btnElement.innerHTML = actionType === 'start' ? '✅ Day Started' : '✅ Signed Off';
        return; // Execution halts here; button remains disabled to prevent spamming
    }
    // -------------------------------------------------

    btnElement.innerHTML = '📍 Locating...';

    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser or device.");
        btnElement.disabled = false;
        btnElement.innerHTML = originalText;
        return;
    }

    // 3. Trigger GPS API
    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

        btnElement.innerHTML = '⏳ Saving...';

        // A. Construct Dedicated drivers_log Payload
        const payload = {
            driver_username: currentUser.username,
            action_type: actionType === 'start' ? 'shift_start' : 'shift_end',
            action_date: dateStr,
            action_time: timeStr,
            location_link: mapsUrl,
            so: null // Shifts are not tied to specific orders
        };

        // B. Inject into NEW drivers_log table
        const { error } = await supabaseClient.from('drivers_log').insert(payload);

        if (error) {
            alert("Failed to log shift: " + error.message);
            btnElement.disabled = false;
            btnElement.innerHTML = originalText;
        } else {
            alert(`Shift ${actionType === 'start' ? 'Started' : 'Signed Off'} Successfully!`);
            btnElement.innerHTML = actionType === 'start' ? `✅ Day Started at ${timeStr}` : `✅ Signed Off at ${timeStr}`;
            
            setTimeout(() => {
                btnElement.disabled = false;
            }, 1000);
        }

    }, (error) => {
        alert("Failed to acquire location. Ensure GPS is enabled and permissions are granted. Error: " + error.message);
        btnElement.disabled = false;
        btnElement.innerHTML = originalText;
    }, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
    });
}
// ---------------------------------------------------

async function handleDriverAction(ticket, actionType, btnElement) {
    if (!navigator.onLine) {
        alert("An active internet connection is required for real-time fleet tracking.");
        return;
    }

    // 1. Generate precise timestamps
    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`;
    const dateTimeStr = `${dateStr} ${timeStr}`;

    // 2. Lock UI to prevent double-firing
    btnElement.disabled = true;
    const originalText = btnElement.innerHTML;

    if (actionType === 'arrive') {
        btnElement.innerHTML = '📍 Locating...';

        if (!navigator.geolocation) {
            alert("Geolocation is not supported by your browser or device.");
            btnElement.disabled = false;
            btnElement.innerHTML = originalText;
            return;
        }

        // Trigger GPS API
        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

            btnElement.innerHTML = '⏳ Saving...';

            // A. Log Historical Audit Trail to NEW drivers_log
            const logPayload = {
                so: ticket.so,
                driver_username: currentUser.username,
                action_type: 'arrive',
                action_date: dateStr,
                action_time: timeStr,
                location_link: mapsUrl
            };
            await supabaseClient.from('drivers_log').insert(logPayload);

            // B. Update Live Master Order (Required for UI persistence)
            await supabaseClient.from('orders')
                .update({ location_link: mapsUrl, arrived_at: dateTimeStr }) 
                .eq('so', ticket.so);

            // C. Persist UI State & Memory
            btnElement.innerHTML = `🟢 Arrived ${timeStr} 📍`; 
            btnElement.disabled = false;
            ticket.arrived_at = dateTimeStr; 
            ticket.location_link = mapsUrl;

        }, (error) => {
            alert("Failed to acquire location. Ensure GPS is enabled and permissions are granted. Error: " + error.message);
            btnElement.disabled = false;
            btnElement.innerHTML = originalText;
        }, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        });

    } else if (actionType === 'leave') {
        btnElement.innerHTML = '⏳ Saving...';

        // A. Log Historical Audit Trail to NEW drivers_log
        const logPayload = {
            so: ticket.so,
            driver_username: currentUser.username,
            action_type: 'leave',
            action_date: dateStr,
            action_time: timeStr
        };
        await supabaseClient.from('drivers_log').insert(logPayload);

        // B. Update Live Master Order (Required to drop it from the Driver's active queue)
        await supabaseClient.from('orders')
            .update({ left_at: dateTimeStr }) 
            .eq('so', ticket.so);

        // C. Persist UI State & Memory
        btnElement.innerHTML = `🔴 Left ${timeStr}`; 
        btnElement.disabled = false;
        ticket.left_at = dateTimeStr; 
    }
}

// ==========================================
// --- APP.JS EXTRACTED DRIVER LOGIC ---
// ==========================================

// Fetches all technicians paired with a driver for the current day
async function getFleetPairedTechsForDriver(driverName) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const todayStr = `${dd}-${mm}-${yyyy}`; 

    const { data: pairData, error: pairErr } = await supabaseClient
        .from('fleet_pairing')
        .select('tech_username')
        .ilike('driver_username', driverName)
        .eq('date', todayStr);

    if (pairErr || !pairData || pairData.length === 0) return [];
    return pairData.map(p => p.tech_username);
}

// Generates the customized Driver Ticket Card HTML
function getDriverTicketHtml(ticket) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const todayStr = `${dd}-${mm}-${now.getFullYear()}`;

    let arrivedText = '🟢 Arrive وصلت';
    if (ticket.arrived_at && ticket.arrived_at.includes(todayStr)) {
        const timeOnly = ticket.arrived_at.split(' ')[1] || '';
        arrivedText = `🟢 Arrived ${timeOnly} ${ticket.location_link ? '📍' : ''}`;
    }

    let leftText = '🔴 Leave تحركت';
    if (ticket.left_at && ticket.left_at.includes(todayStr)) {
        const timeOnly = ticket.left_at.split(' ')[1] || '';
        leftText = `🔴 Left ${timeOnly}`;
    }
    
    const actionButtonsHtml = `
        <div style="display: flex; gap: 10px; margin-top: 10px;">
            <button class="btn-driver-arrive" style="flex: 1; background-color: #1976d2; color: white; border: none; padding: 10px; border-radius: 4px; font-weight: bold; cursor: pointer;">${arrivedText}</button>
            <button class="btn-driver-leave" style="flex: 1; background-color: #1976d2; color: white; border: none; padding: 10px; border-radius: 4px; font-weight: bold; cursor: pointer;">${leftText}</button>
        </div>
    `;

    return `
        <div class="ticket-header">
            <span>SO: ${ticket.so}</span>
        </div>
        <div class="ticket-row"><span>Name: ${ticket.name || 'N/A'}</span></div>
        <div class="ticket-row"><span>Date: ${ticket.date || 'N/A'}</span></div>
        <div class="ticket-row" style="margin-top: 5px;"><strong>Address:</strong> ${ticket.address || 'N/A'}</div>
        ${actionButtonsHtml}
    `;
}

// Attaches the Driver Arrive/Leave events to the newly generated HTML
function bindDriverTicketEvents(card, ticket) {
    card.querySelector('.btn-driver-arrive').addEventListener('click', function() {
        if (typeof handleDriverAction === 'function') handleDriverAction(ticket, 'arrive', this);
    });
    card.querySelector('.btn-driver-leave').addEventListener('click', function() {
        if (typeof handleDriverAction === 'function') handleDriverAction(ticket, 'leave', this);
    });
}