// ==========================================
// --- FLEET LOGISTICS & SCHEDULING ENGINE ---
// ==========================================

let fleetDrivers = [];
let fleetTechs = [];

// Format Date to YYYY-MM-DD for HTML Calendar Inputs
function getTomorrowHtmlDate() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
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

    // 1. Fetch Users from Profiles
    const { data: profiles, error } = await supabaseClient
        .from('profiles')
        .select('username, role');

    if (error) {
        if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
        alert("Error loading users: " + error.message);
        return;
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

    // 4. Reset Table and Add One Default Row
    const tbody = document.getElementById('fleetScheduleBody');
    if (tbody) {
        tbody.innerHTML = '';
        addFleetRow();
    }

    if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
}

// Dynamic Row Generator
function addFleetRow() {
    const tbody = document.getElementById('fleetScheduleBody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    
    tr.innerHTML = `
        <td><input type="date" class="fleet-date-input" value="${getTomorrowHtmlDate()}" style="padding: 6px; width: 100%; box-sizing: border-box; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); border-radius: 4px;"></td>
        <td><input type="text" class="fleet-driver-input" list="fleetDriverList" placeholder="Driver..." style="padding: 6px; width: 100%; box-sizing: border-box; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); border-radius: 4px;"></td>
        <td><input type="text" class="fleet-tech-input" list="fleetTechList" placeholder="Tech..." style="padding: 6px; width: 100%; box-sizing: border-box; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); border-radius: 4px;"></td>
        <td><input type="text" class="fleet-route-input" list="fleetRouteList" placeholder="Route..." style="padding: 6px; width: 100%; box-sizing: border-box; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); border-radius: 4px;"></td>
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

        if (!htmlDate || !driver || !tech) {
            hasErrors = true;
            tr.style.backgroundColor = 'rgba(211, 47, 47, 0.1)'; // Highlight missing data
        } else {
            tr.style.backgroundColor = '';
            payload.push({
                date: formatToDbDate(htmlDate), // Forces the required 'dd-mm-yyyy' format
                driver_username: driver,
                tech_username: tech,
                rout: rout
            });
        }
    });

    if (hasErrors) {
        alert("Please ensure Date, Driver, and Technician are populated for all rows.");
        return;
    }

    if (typeof showGlobalLoader === 'function') showGlobalLoader("Saving Fleet Schedule...");

    const btnSave = document.getElementById('btnSaveFleetSchedule');
    btnSave.disabled = true;

    // Use standard insert. The composite unique constraint we added to the DB handles duplicates.
    const { error } = await supabaseClient.from('fleet_pairing').insert(payload);

    btnSave.disabled = false;
    if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

    if (error) {
        // Postgres Code 23505 = Unique Violation
        if (error.code === '23505') {
            alert("Database Error: One or more of these pairings already exist for the selected date. Duplicates were rejected to prevent overlapping routes.");
        } else {
            alert("Failed to save schedule: " + error.message);
        }
    } else {
        alert("Fleet Schedule successfully saved!");
        const tbody = document.getElementById('fleetScheduleBody');
        if (tbody) {
            tbody.innerHTML = '';
            addFleetRow(); // Reset UI with a fresh row
        }
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