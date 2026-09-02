// --- MISSING DOM DECLARATIONS FOR NAVIGATION ---
const monitorPage = document.getElementById('monitorPage');


// NEW TRACKING DATASETS FOR MONITOR SPLIT
let monitorTrackingRows = []; 
let editedMonitorRows = {};  
const MONITOR_TABLE_NAME = 'repair_log'; // Your secondary table name in Supabase
let currentFilteredMonitorRows = [];

// --- LEADERBOARD & SORTING MEMORY ---
let globalUserProfiles = {}; // Caches roles so we know who is a tech vs coord
let techLeaderboardData = []; // Holds the active tech data for sorting
let coordLeaderboardData = []; // Holds the active coord data for sorting
let monitorSortConfig = { table: '', col: '', dir: 'desc' }; // Remembers what column you clicked

// --- PHASE 1: INTRA-DAY RESOLUTION ENGINE ---
window.resolvedDailyAssignments = {}; // Exposed globally for Phase 2 (Modal & Badges)

function executeIntraDayResolution(dataPool) {
    let techStats = {};
    let coordStats = {};
    window.resolvedDailyAssignments = {}; 
    
    // Step 1: Group logs by SO and Date
    let dailyLogs = {};
    dataPool.forEach(row => {
        const dateStr = row.assign_date || 'UnknownDate';
        const key = row.so + '_' + dateStr;
        if (!dailyLogs[key]) dailyLogs[key] = [];
        dailyLogs[key].push(row);
    });

    // Step 2: Time-sort to find the true final assignee for each day
    Object.keys(dailyLogs).forEach(key => {
        dailyLogs[key].sort((a, b) => (a.assign_time || '00:00').localeCompare(b.assign_time || '00:00'));
        const lastLog = dailyLogs[key][dailyLogs[key].length - 1];
        let finalTech = (lastLog.assigned_tech || '').trim();
        if (finalTech === '') finalTech = (lastLog.end_tech || '').trim(); // Fallback if marked complete
        window.resolvedDailyAssignments[key] = finalTech;
    });

    // Step 3: Tally Metrics Securely
    const initTech = (name) => {
        if (name && !techStats[name]) techStats[name] = { name: name, assigned: new Set(), acted: new Set(), finished: 0, collected: 0 };
    };

    dataPool.forEach(row => {
        const dateStr = row.assign_date || 'UnknownDate';
        const dailyKey = row.so + '_' + dateStr;

        let actedTech = (row.assigned_by || '').trim();
        let endTech = (row.end_tech || '').trim();
        let agreeCoord = (row.agree_coord || '').trim();
        let completeCoord = (row.complete_coord || '').trim();

        initTech(actedTech);
        initTech(endTech);

        // Tally Coordinators
        if (agreeCoord) {
            if (!coordStats[agreeCoord]) coordStats[agreeCoord] = { name: agreeCoord, agree: 0, complete: 0 };
            coordStats[agreeCoord].agree++;
        }
        if (completeCoord) {
            if (!coordStats[completeCoord]) coordStats[completeCoord] = { name: completeCoord, agree: 0, complete: 0 };
            coordStats[completeCoord].complete++;
        }

        // Tally Tech Actions (Always credited to the actor)
        if (actedTech) {
            techStats[actedTech].acted.add(dailyKey);
            techStats[actedTech].collected += Number(row.collected) || 0;
        }
        if (endTech) techStats[endTech].finished++;
    });

    // Apply strictly resolved daily assignments
    Object.keys(window.resolvedDailyAssignments).forEach(dailyKey => {
        const finalTech = window.resolvedDailyAssignments[dailyKey];
        if (finalTech) {
            initTech(finalTech);
            techStats[finalTech].assigned.add(dailyKey);
        }
    });

    // Step 4: Calculate Pending strictly based on overlapping daily actions
    let techArr = [];
    Object.values(techStats).forEach(stats => {
        let role = globalUserProfiles[stats.name] || 'technician';
        if (!role.includes('coordinator')) {
            let overlapCount = 0;
            stats.assigned.forEach(dailyKey => { if (stats.acted.has(dailyKey)) overlapCount++; });
            
            techArr.push({
                name: stats.name,
                assigned: stats.assigned.size,
                acted: stats.acted.size,
                pending: stats.assigned.size - overlapCount,
                finished: stats.finished,
                collected: stats.collected
            });
        }
    });

    return { techData: techArr, coordData: Object.values(coordStats) };
}

// --- NEW LEADERBOARD ENGINE (MIGRATED TO MONITOR.JS) ---
function renderMonitorLeaderboard(dataPool = currentFilteredMonitorRows) {
    const headerEl = document.getElementById('activeMonitorStatusHeader');
    const tableArea = document.getElementById('monitorTableArea');
    const badgesArea = document.getElementById('technicianBadges');
    
    if (headerEl) headerEl.textContent = 'Performance Leaderboard (Split by Role)';
    tableArea.style.display = 'block';
    document.getElementById('techTableTitle').style.display = 'block';
    document.getElementById('coordTableContainer').style.display = 'block';
    if(badgesArea) badgesArea.style.display = 'none';

    // 1. RUN INTRA-DAY RESOLUTION
    const resolvedMetrics = executeIntraDayResolution(dataPool);
    
    techLeaderboardData = resolvedMetrics.techData;
    coordLeaderboardData = resolvedMetrics.coordData;
    monitorSortConfig = { table: '', col: '', dir: 'desc' }; 

    // 2. DRAW TABLES
    if (typeof drawTechLeaderboard === 'function') drawTechLeaderboard();
    if (typeof drawCoordLeaderboard === 'function') drawCoordLeaderboard();
}


// Open Monitor Page from HUB Menu
document.getElementById('btnMonitor').addEventListener('click', () => {
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

    // Call the engine once. It will automatically read the default "This Month" dates we just set!
    //loadMonitorDataEngine(); //this line is cmmmented to prevent the page from loading the table when it is opened 
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

// --- 12. MONITOR ENGINE AND DATA INTERSECTION LOGIC ---
async function loadMonitorDataEngine() {
    
    const headerEl = document.getElementById('activeMonitorStatusHeader');
    if (headerEl) headerEl.textContent = 'Fetching specific date records... Please wait.';

    // 1. Get the dates from the screen first
    const startDateVal = document.getElementById('monitorStartDate').value;
    const endDateVal = document.getElementById('monitorEndDate').value;

    if (!startDateVal || !endDateVal) {
        alert("Please select both a start and end date.");
        if (headerEl) headerEl.textContent = 'Select a Status or Technician from the Left';
        return;
    }
    showGlobalLoader("Analyzing Monitor Logs..."); // Trigger Loader

    // 2. Generate the exact list of DD-MM-YYYY text strings to look for
    const start = new Date(startDateVal);
    const end = new Date(endDateVal);
    let dateStringsToFetch = [];
    
    let currentDay = new Date(start);
    while (currentDay <= end) {
        const dd = String(currentDay.getDate()).padStart(2, '0');
        const mm = String(currentDay.getMonth() + 1).padStart(2, '0');
        const yyyy = currentDay.getFullYear();
        dateStringsToFetch.push(`${dd}-${mm}-${yyyy}`);
        currentDay.setDate(currentDay.getDate() + 1); // Move loop to the next day
    }

    // 3. SERVER-SIDE FILTER: Only download logs that occurred on these specific dates
    const trackRows = await fetchAllRecords(MONITOR_TABLE_NAME, 'assign_date', dateStringsToFetch);
    
    // 4. Extract the unique SO numbers from the logs we just downloaded
    const uniqueSOs = [...new Set(trackRows.map(log => log.so))];

    // 5. SERVER-SIDE FILTER: Only download the specific orders tied to those SO numbers
    let mainOrders = [];
    if (uniqueSOs.length > 0) {
        mainOrders = await fetchAllRecords('orders', 'so', uniqueSOs);
    }
    
    // (Inside loadMonitorDataEngine)
    // Store in our master variables
    databaseOrders = mainOrders || [];
    monitorTrackingRows = trackRows || [];
    currentFilteredMonitorRows = monitorTrackingRows; 

    // --- NEW: FETCH ROLES TO SPLIT THE LEADERBOARD ---
    // If we haven't loaded the roles yet, ask the profiles table
    if (Object.keys(globalUserProfiles).length === 0) {
        const { data: profs } = await supabaseClient.from('profiles').select('username, role');
        if (profs) {
            profs.forEach(p => globalUserProfiles[p.username.trim()] = p.role.toLowerCase());
        }
    }

    
    calculateStatusMetrics();
    renderMonitorLeaderboard(currentFilteredMonitorRows); 
    
    hideGlobalLoader(); // Hide when finished rendering
}

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

    // --- FIXED: UTF-8 BOM added safely without duplicate declarations ---
    const blob = new Blob(['\uFEFF' + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Monitor_Export_${new Date().getTime()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// ---LIGHTWEIGHT EXCEL-STYLE MONITOR FILTER ---
function filterMonitorTable() {
    const trs = document.getElementById('monitorTableBody').getElementsByTagName('tr');
    const inputs = document.getElementById('monitorHeaderRow').getElementsByTagName('input');
    
    for (let i = 0; i < trs.length; i++) {
        let showRow = true;
        const tds = trs[i].getElementsByTagName('td');
        
        for (let j = 0; j < inputs.length; j++) {
            const filterText = inputs[j].value.toLowerCase();
            
            if (filterText !== '') {
                if (tds[j]) {
                    const cellText = tds[j].textContent.toLowerCase();
                    if (cellText.indexOf(filterText) === -1) {
                        showRow = false; 
                        break; 
                    }
                }
            }
        }
        trs[i].style.display = showRow ? '' : 'none';
    }
}
// -------------------------------------------

// --- METRIC LIST MODAL ENGINE (MIGRATED & ENHANCED) ---
window.openMetricDetails = function(context, user, type, extraArg = null) {
    const dataPool = context === 'monitor' ? currentFilteredMonitorRows : bonusesTrackingRows;
    const safeUser = user.trim().toLowerCase();
    
    // We map by dailyKey to perfectly sync with the Leaderboard's daily event counting
    let assignedMap = new Map();
    let actedMap = new Map();
    let finalResults = new Map();

    // 1. Data Aggregation
    dataPool.forEach((row, index) => {
        const so = row.so;
        const assignedTech = (row.assigned_tech || '').trim().toLowerCase();
        const assignedBy = (row.assigned_by || '').trim().toLowerCase();
        const endTech = (row.end_tech || '').trim().toLowerCase();
        const agreeCoord = (row.agree_coord || '').trim().toLowerCase();
        const completeCoord = (row.complete_coord || '').trim().toLowerCase();

        // --- PHASE 2 ENGINE SYNCHRONIZATION ---
        const dateStr = row.assign_date || 'UnknownDate';
        const dailyKey = row.so + '_' + dateStr;
        
        // Fetch true resolved assignee. We explicitly check against undefined so empty strings don't trigger the fallback!
        const resolved = window.resolvedDailyAssignments ? window.resolvedDailyAssignments[dailyKey] : undefined;
        const trueAssignee = (resolved !== undefined) ? resolved.toLowerCase() : assignedTech;

        // Baseline mapping for Left Out math & Carry-Over Validation
        if (trueAssignee === safeUser) assignedMap.set(dailyKey, row);
        if (assignedBy === safeUser) actedMap.set(dailyKey, row);

        let isMatch = false;
        
        if (context === 'bonuses') {
            if (type === 'acted' && assignedBy === safeUser) isMatch = true;
            if (type === 'agreed' && agreeCoord === safeUser) isMatch = true;
            if (type === 'completed' && completeCoord === safeUser) isMatch = true;
            if (type === 'finished' && endTech === safeUser) isMatch = true;
            if (type === 'hass' && String(row.hass || '').trim().toLowerCase() === 'yes') isMatch = true;
            if (type === 'smart_things' && String(row.smart_things || '').trim().toLowerCase() === 'yes') isMatch = true;
            if (type === 'collected' && assignedBy === safeUser && Number(row.collected) > 0) isMatch = true;
            if (type === 'reason' && assignedBy === safeUser && (row.collected_reason || '').trim() === extraArg) isMatch = true;
        } else {
            // Strictly match using the true resolved assignee for Monitor context
            if (type === 'assigned' && trueAssignee === safeUser) isMatch = true;
            if (type === 'acted' && assignedBy === safeUser) isMatch = true;
            if (type === 'finished' && endTech === safeUser) isMatch = true;
            if (type === 'collected' && assignedBy === safeUser && Number(row.collected) > 0) isMatch = true;
            if (type === 'agreed' && agreeCoord === safeUser) isMatch = true;
            if (type === 'completed' && completeCoord === safeUser) isMatch = true;
            if (type === 'reason' && assignedBy === safeUser && (row.collected_reason || '').trim() === extraArg) isMatch = true;
        }

        if (isMatch) {
            // Deduplicate Set-based metrics (Assigned/Acted) by dailyKey to match Leaderboard. 
            // Preserve all rows for count-based metrics by adding the index to the key.
            const mapKey = (context === 'monitor' && (type === 'assigned' || type === 'acted')) ? dailyKey : (dailyKey + '_' + index);
            finalResults.set(mapKey, row);
        }
    });

    // 2. Left Out Math (Strictly mirroring the Leaderboard's Set subtraction)
    if (type === 'pending') {
        finalResults.clear();
        assignedMap.forEach((row, dailyKey) => {
            if (!actedMap.has(dailyKey)) finalResults.set(dailyKey, row);
        });
    }

    // 3. UI Generation
    const listContainer = document.getElementById('metricModalList');
    listContainer.innerHTML = '';
    
    document.getElementById('metricModalTitle').textContent = `Details: ${type.toUpperCase()}`;
    const subtitle = context === 'bonuses' ? "Showing your personal entries for the selected date range." : `Displaying records for: ${user}`;
    document.getElementById('metricModalSubtitle').textContent = subtitle;

    if (finalResults.size === 0) {
        listContainer.innerHTML = '<p style="opacity: 0.7;">No details found for this record.</p>';
    } else {
        // --- PHASE 2: INDEX COUNTER INJECTION ---
        let indexCounter = 1;
        
        finalResults.forEach((row) => {
            const so = row.so;
            const rowDateStr = row.assign_date || 'UnknownDate';
            const rowDailyKey = so + '_' + rowDateStr;
            
            let detailString = '';
            if (type === 'assigned' || type === 'pending') {
                detailString = `Assigned Date: ${row.assign_date || 'N/A'} at ${row.assign_time || 'N/A'}`;
            } else if (type === 'acted') {
                detailString = `Action Date: ${row.assign_date || 'N/A'} at ${row.assign_time || 'N/A'} <br><strong>Comment:</strong> ${row.comment || 'None'}`;
            } else if (type === 'finished') {
                detailString = `Completed Date: ${row.assign_date || 'N/A'} at ${row.assign_time || 'N/A'} <br><strong>End Coord:</strong> ${row.complete_coord || 'N/A'}`;
            } else if (type === 'collected') {
                detailString = `Collection Date: ${row.assign_date || 'N/A'} at ${row.assign_time || 'N/A'} <br><strong>Amount:</strong> ${row.collected || 0}`;
            } else {
                detailString = `Recorded Date: ${row.assign_date || 'N/A'} at ${row.assign_time || 'N/A'}`;
            }

            // --- BRIDGE SOLUTION: CARRY-OVER DETECTION ---
            let carryOverBadge = '';
            if ((type === 'acted' || type === 'pending') && !assignedMap.has(rowDailyKey)) {
                carryOverBadge = `<span style="background-color: #fbc02d; color: black; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-left: 10px; border: 1px solid #f9a825;" title="Assigned prior to the selected date range">⚠️ Carry-over</span>`;
            }

            const card = document.createElement('div');
            card.className = 'metric-card';
            // --- INDEX NUMBER RENDERED BEFORE THE SO ---
            card.innerHTML = `
                <div class="metric-so-link" style="display: flex; align-items: center; justify-content: space-between;">
                    <div><span style="color: #1976d2; font-weight: bold; margin-right: 5px;">#${indexCounter}</span> SO: ${so} ${carryOverBadge}</div>
                </div>
                <div>${detailString}</div>
            `;
            
            card.querySelector('.metric-so-link').addEventListener('click', () => {
                const mainOrder = databaseOrders.find(o => String(o.so) === String(so)) || row;
                if (typeof openViewOnlyModal === 'function') openViewOnlyModal(mainOrder);
            });

            listContainer.appendChild(card);
            indexCounter++;
        });
    }

    document.getElementById('metricDetailsModal').style.display = 'flex';
};