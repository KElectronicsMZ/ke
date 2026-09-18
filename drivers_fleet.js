// ==========================================
// --- FLEET LOGISTICS & SCHEDULING ENGINE ---
// ==========================================

let fleetDrivers = [];
let fleetTechs = [];
let currentFleetPerms = {}; // Tracks logged-in user's fleet field-level permissions

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

    // 4. Hydrate Table with Today's Active Pairings
    const tbody = document.getElementById('fleetScheduleBody');
    if (tbody) {
        tbody.innerHTML = '';
        
        // Align temporal formats (HTML Date to Database DD-MM-YYYY)
        const todayHtml = getTodayHtmlDate();
        const todayDb = formatToDbDate(todayHtml);

        const { data: activePairings, error: pairError } = await supabaseClient
            .from('fleet_pairing')
            .select('*')
            .eq('date', todayDb);

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
    const dateVal = rowData && rowData.date ? rowData.date.split('-').reverse().join('-') : getTodayHtmlDate();
    const driverVal = rowData && rowData.driver_username ? rowData.driver_username : '';
    const techVal = rowData && rowData.tech_username ? rowData.tech_username : '';
    const routVal = rowData && rowData.rout ? rowData.rout : '';
    const commentVal = rowData && rowData.comments ? rowData.comments : '';

    const tr = document.createElement('tr');
    
    // Evaluate ACL matrix for the current user
    const d_state = currentFleetPerms['driver_username'] ? '' : 'disabled';
    const t_state = currentFleetPerms['tech_username'] ? '' : 'disabled';
    const r_state = currentFleetPerms['rout'] ? '' : 'disabled';
    const c_state = currentFleetPerms['comments'] ? '' : 'disabled';
    
    // UI Style Generator for locked fields
    const getStyle = (state) => state === 'disabled' 
        ? 'padding: 6px; width: 100%; box-sizing: border-box; border: 1px dashed var(--border-color); background: rgba(0,0,0,0.1); color: var(--text-color); border-radius: 4px; cursor: not-allowed; opacity: 0.7;'
        : 'padding: 6px; width: 100%; box-sizing: border-box; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); border-radius: 4px;';
    
    tr.innerHTML = `
        <td><input type="date" class="fleet-date-input" value="${dateVal}" disabled style="${getStyle('disabled')}"></td>
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
    if (btnAdd) btnAdd.addEventListener('click', addFleetRow);

    const btnSave = document.getElementById('btnSaveFleetSchedule');
    if (btnSave) btnSave.addEventListener('click', saveFleetSchedule);
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

            // A. Log Historical Audit Trail
            const logPayload = {
                so: ticket.so,
                status: ticket.status || 'Technician',
                assigned_by: currentUser.username,
                assigned_tech: ticket.assigned_tech || '',
                assign_date: dateStr,
                assign_time: timeStr,
                comment: "Driver Arrived at Location",
                location_link: mapsUrl,
                arrived_at: dateTimeStr // <-- UPDATED
            };
            await supabaseClient.from('repair_log').insert(logPayload);

            // B. Update Live Master Order
            await supabaseClient.from('orders')
                .update({ location_link: mapsUrl, arrived_at: dateTimeStr }) // <-- UPDATED
                .eq('so', ticket.so);

            // C. Persist UI State & Memory
            btnElement.innerHTML = `🟢 Arrived ${dateTimeStr} 📍`; // <-- UPDATED
            btnElement.disabled = false;
            ticket.arrived_at = dateTimeStr; // <-- UPDATED
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

        // A. Log Historical Audit Trail (No GPS required for leaving)
        const logPayload = {
            so: ticket.so,
            status: ticket.status || 'Technician',
            assigned_by: currentUser.username,
            assigned_tech: ticket.assigned_tech || '',
            assign_date: dateStr,
            assign_time: timeStr,
            comment: "Driver Left Location",
            left_at: dateTimeStr // <-- UPDATED
        };
        await supabaseClient.from('repair_log').insert(logPayload);

        // B. Update Live Master Order
        await supabaseClient.from('orders')
            .update({ left_at: dateTimeStr }) // <-- UPDATED
            .eq('so', ticket.so);

        // C. Persist UI State & Memory
        btnElement.innerHTML = `🔴 Left ${dateTimeStr}`; // <-- UPDATED
        btnElement.disabled = false;
        ticket.left_at = dateTimeStr; // <-- UPDATED
    }
}