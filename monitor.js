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
let driverLeaderboardData = []; // Holds the active driver data for sorting
let monitorDriverRows = []; // Holds the raw telemetry from drivers_log
let monitorSortConfig = { table: '', col: '', dir: 'desc' }; // Remembers what column you clicked

// --- PHASE 1: INTRA-DAY RESOLUTION ENGINE ---

// --- PHASE 1: INTRA-DAY RESOLUTION ENGINE ---
window.resolvedDailyAssignments = {}; // Exposed globally for Phase 2 (Modal & Badges)

function executeIntraDayResolution(dataPool, driverPool = monitorDriverRows) {
    let techStats = {};
    let coordStats = {};
    let driverStats = {};
    window.resolvedDailyAssignments = {}; // Preserved to prevent errors in legacy integrations

    const initTech = (name) => {
        if (name && !techStats[name]) {
            // Keying Sets by SO ensures an order is only counted once per technician in this date range
            techStats[name] = { name: name, assigned: new Set(), acted: new Set(), finished: new Set(), collectedMap: new Map() };
        }
    };

    dataPool.forEach(row => {
        const so = row.so;
        let actedTech = (row.assigned_by || '').trim();
        let assignedTech = (row.assigned_tech || '').trim();
        let endTech = (row.end_tech || '').trim();
        let agreeCoord = (row.agree_coord || '').trim();
        let completeCoord = (row.complete_coord || '').trim();

        initTech(actedTech);
        initTech(assignedTech);
        initTech(endTech);

        // Tally Coordinators (Deduplicated by SO)
        if (agreeCoord) {
            if (!coordStats[agreeCoord]) coordStats[agreeCoord] = { name: agreeCoord, agree: new Set(), complete: new Set() };
            coordStats[agreeCoord].agree.add(so);
        }
        if (completeCoord) {
            if (!coordStats[completeCoord]) coordStats[completeCoord] = { name: completeCoord, agree: new Set(), complete: new Set() };
            coordStats[completeCoord].complete.add(so);
        }

        // Tally Tech Metrics (Deduplicated by SO)
        if (assignedTech) techStats[assignedTech].assigned.add(so);
        
        if (actedTech) {
            techStats[actedTech].acted.add(so);
            
            // Deduplicate Collected Money: Retain the max value for this SO to prevent double counting
            const currentCollected = Number(row.collected) || 0;
            const existingCollected = techStats[actedTech].collectedMap.get(so) || 0;
            if (currentCollected > existingCollected) {
                techStats[actedTech].collectedMap.set(so, currentCollected);
            }
        }
        if (endTech) techStats[endTech].finished.add(so);
    });

    // Step 4: Calculate Pending based on overlapping unique SOs
    let techArr = [];
    Object.values(techStats).forEach(stats => {
        let role = globalUserProfiles[stats.name] || 'technician';
        if (!role.includes('coordinator')) {
            let overlapCount = 0;
            stats.assigned.forEach(so => { if (stats.acted.has(so)) overlapCount++; });
            
            let totalCollected = 0;
            stats.collectedMap.forEach(amount => totalCollected += amount);
            
            techArr.push({
                name: stats.name,
                assigned: stats.assigned.size,
                acted: stats.acted.size,
                pending: stats.assigned.size - overlapCount,
                finished: stats.finished.size,
                collected: totalCollected
            });
        }
    });

    let formattedCoordData = Object.values(coordStats).map(coord => ({
        name: coord.name,
        agree: coord.agree.size,
        complete: coord.complete.size
    }));

    // Calculate Driver Metrics
    const initDriver = (name) => {
        if (name && !driverStats[name]) {
            driverStats[name] = { name: name, orderVisits: new Set(), totalBranchVisits: 0, branchNames: new Set() };
        }
    };

    driverPool.forEach(log => {
        const driver = log.driver_username;
        if (!driver) return;
        initDriver(driver);

        if (log.action_type === 'arrive' || log.action_type === 'leave') {
            driverStats[driver].orderVisits.add(log.so);
        } else if (log.action_type === 'branch_visit') {
            driverStats[driver].totalBranchVisits++;
            driverStats[driver].branchNames.add(log.so);
        }
    });

    let formattedDriverData = Object.values(driverStats).map(d => ({
        name: d.name,
        orderVisits: d.orderVisits.size,
        branchVisits: d.totalBranchVisits,
        branches: Array.from(d.branchNames).join(' | ') || 'None'
    }));

    return { techData: techArr, coordData: formattedCoordData, driverData: formattedDriverData };
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
    document.getElementById('driverTableContainer').style.display = 'block';
    if(badgesArea) badgesArea.style.display = 'none';

    // 1. RUN INTRA-DAY RESOLUTION
    const resolvedMetrics = executeIntraDayResolution(dataPool, monitorDriverRows);
    
    techLeaderboardData = resolvedMetrics.techData;
    coordLeaderboardData = resolvedMetrics.coordData;
    driverLeaderboardData = resolvedMetrics.driverData;
    monitorSortConfig = { table: '', col: '', dir: 'desc' }; 

    // 2. DRAW TABLES
    if (typeof drawTechLeaderboard === 'function') drawTechLeaderboard();
    if (typeof drawCoordLeaderboard === 'function') drawCoordLeaderboard();
    if (typeof drawDriverLeaderboard === 'function') drawDriverLeaderboard();
}

// --- FAST DATE BUTTONS ---
const formatHtmlDate = (dateObj) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

document.getElementById('btnMonitorToday').addEventListener('click', () => {
    const now = new Date();
    document.getElementById('monitorStartDate').value = formatHtmlDate(now);
    document.getElementById('monitorEndDate').value = formatHtmlDate(now);
});

document.getElementById('btnMonitorThisMonth').addEventListener('click', () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    document.getElementById('monitorStartDate').value = formatHtmlDate(firstDay);
    document.getElementById('monitorEndDate').value = formatHtmlDate(now);
});

document.getElementById('monitorFilterDateBtn').addEventListener('click', () => {
    // Only run the engine. The engine now triggers the leaderboard automatically!
    loadMonitorDataEngine();
});

// UPDATED: Calculates counts and populates the Top Dropdowns
function calculateStatusMetrics(dataToProcess = monitorTrackingRows) {
    const statusSelect = document.getElementById('monitorStatusSelect');
    const techSelect = document.getElementById('monitorTechSelect');
    
    // Clear dropdowns completely, but keep the default placeholder options
    statusSelect.innerHTML = '<option value="">-- Select Status --</option>';
    techSelect.innerHTML = '<option value="">-- Select Technician --</option>';

    let statusCounts = { "All Tracking Logs": dataToProcess.length };
    let techCounts = {};

   // Tally the data
    dataToProcess.forEach(row => {
        // 1. Tally Statuses
        let statusName = row.status ? row.status.trim() : 'Unknown';
        if (statusName === '') statusName = 'Unknown';
        statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;

        // 2. Tally Technicians (Checking BOTH columns, STRICT CASE)
        let namesForThisRow = new Set(); 
        
        if (row.assigned_tech && row.assigned_tech.trim()) {
            namesForThisRow.add(row.assigned_tech.trim());
        }
        if (row.assigned_by && row.assigned_by.trim()) {
            namesForThisRow.add(row.assigned_by.trim());
        }

        namesForThisRow.forEach(name => {
            techCounts[name] = (techCounts[name] || 0) + 1;
        });
    });

    // Populate Status Dropdown
    for (const [statusName, totalCount] of Object.entries(statusCounts)) {
        const opt = document.createElement('option');
        opt.value = statusName; 
        opt.textContent = `${statusName} (${totalCount})`; 
        statusSelect.appendChild(opt);
    }

    // Populate Technician Dropdown (Alphabetized for easy searching)
    Object.keys(techCounts).sort().forEach(techName => {
        const totalCount = techCounts[techName];
        const opt = document.createElement('option');
        opt.value = techName;
        opt.textContent = `${techName} (${totalCount})`;
        techSelect.appendChild(opt);
    });
}

// --- MUTUALLY EXCLUSIVE DROPDOWN LISTENERS ---
document.getElementById('monitorStatusSelect').addEventListener('change', (e) => {
    const selectedVal = e.target.value;
    document.getElementById('monitorTechSelect').value = ''; 
    
    const poolToUse = currentFilteredMonitorRows.length > 0 ? currentFilteredMonitorRows : monitorTrackingRows;
    if (selectedVal) {
        renderMonitorTable('status', selectedVal, poolToUse);
    } else {
        renderMonitorLeaderboard(poolToUse); // Go back to leaderboard
    }
});

document.getElementById('monitorTechSelect').addEventListener('change', (e) => {
    const selectedVal = e.target.value;
    document.getElementById('monitorStatusSelect').value = ''; 
    
    const poolToUse = currentFilteredMonitorRows.length > 0 ? currentFilteredMonitorRows : monitorTrackingRows;
    if (selectedVal) {
        renderMonitorTable('technician', selectedVal, poolToUse);
    } else {
        renderMonitorLeaderboard(poolToUse); // Go back to leaderboard
    }
});

// --- TABLE DRAWING FUNCTIONS WITH CLICKABLE HEADERS ---
function drawTechLeaderboard() {
    const tbody = document.getElementById('monitorTableBody');
    const theadRow = document.getElementById('monitorHeaderRow');
    tbody.innerHTML = '';
    theadRow.innerHTML = '';

    // --- Inject Row Number Header ---
    const indexHeader = document.createElement('th');
    indexHeader.innerHTML = `<div style="padding: 5px;"><span class="sort-header" style="text-decoration: none; font-weight: bold; color: var(--text-color);">#</span></div>`;
    theadRow.appendChild(indexHeader);

    const cols = [
        { label: 'Technician', key: 'name' },
        { label: 'Assigned Orders', key: 'assigned' },
        { label: 'Actions Submitted', key: 'acted' },
        { label: 'Pending (Left Out)', key: 'pending' },
        { label: 'Finished', key: 'finished' },
        { label: 'Total Collected', key: 'collected' }
    ];

    cols.forEach(col => {
        const th = document.createElement('th');
        let arrow = monitorSortConfig.col === col.key ? (monitorSortConfig.dir === 'asc' ? ' 🔼' : ' 🔽') : '';
        th.innerHTML = `<div style="padding: 5px; cursor: pointer;" title="Click to sort">
            <span class="sort-header" style="text-decoration: none; font-weight: bold; color: var(--text-color);">${col.label}</span>${arrow}
        </div>`;
        th.addEventListener('click', () => triggerMonitorSort('tech', col.key));
        theadRow.appendChild(th);
    });

    techLeaderboardData.forEach((stats,index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
        <td style="padding: 10px; font-weight: bold; text-align: center;">${index + 1}</td>
            <td style="padding: 10px; font-weight: bold;">${stats.name}</td>
            <td style="padding: 10px;"><span class="metric-clickable" onclick="openMetricDetails('monitor', '${stats.name}', 'assigned')">${stats.assigned}</span></td>
            <td style="padding: 10px; color: #2e7d32;"><span class="metric-clickable" onclick="openMetricDetails('monitor', '${stats.name}', 'acted')">${stats.acted}</span></td>
            <td style="padding: 10px; color: #d32f2f;"><span class="metric-clickable" onclick="openMetricDetails('monitor', '${stats.name}', 'pending')">${stats.pending}</span></td>
            <td style="padding: 10px;"><span class="metric-clickable" onclick="openMetricDetails('monitor', '${stats.name}', 'finished')">${stats.finished}</span></td>
            <td style="padding: 10px; color: #1976d2;"><span class="metric-clickable" onclick="openMetricDetails('monitor', '${stats.name}', 'collected')">${stats.collected}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function drawCoordLeaderboard() {
    const tbody = document.getElementById('coordTableBody');
    const theadRow = document.getElementById('coordHeaderRow');
    tbody.innerHTML = '';
    theadRow.innerHTML = '';

    const indexHeader = document.createElement('th');
    indexHeader.innerHTML = `<div style="padding: 5px;"><span class="sort-header" style="text-decoration: none; font-weight: bold; color: var(--text-color);">#</span></div>`;
    theadRow.appendChild(indexHeader);

    const cols = [
        { label: 'Coordinator', key: 'name' },
        { label: 'Agreed Orders', key: 'agree' },
        { label: 'Completed Orders', key: 'complete' }
    ];

    cols.forEach(col => {
        const th = document.createElement('th');
        let arrow = monitorSortConfig.col === col.key ? (monitorSortConfig.dir === 'asc' ? ' 🔼' : ' 🔽') : '';
        th.innerHTML = `<div style="padding: 5px; cursor: pointer;" title="Click to sort">
            <span class="sort-header" style="text-decoration: none; font-weight: bold; color: var(--text-color);">${col.label}</span>${arrow}
        </div>`;
        th.addEventListener('click', () => triggerMonitorSort('coord', col.key));
        theadRow.appendChild(th);
    });

    coordLeaderboardData.forEach((stats, index) => { 
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 10px; font-weight: bold; text-align: center;">${index + 1}</td>
            <td style="padding: 10px; font-weight: bold;">${stats.name}</td>
            <td style="padding: 10px; color: #f57c00;"><span class="metric-clickable" onclick="openMetricDetails('monitor', '${stats.name}', 'agreed')">${stats.agree}</span></td>
            <td style="padding: 10px; color: #2e7d32;"><span class="metric-clickable" onclick="openMetricDetails('monitor', '${stats.name}', 'completed')">${stats.complete}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// --- THE ACTUAL SORTING LOGIC ---
function triggerMonitorSort(tableType, colKey) {
    if (monitorSortConfig.col === colKey) {
        monitorSortConfig.dir = monitorSortConfig.dir === 'asc' ? 'desc' : 'asc';
    } else {
        monitorSortConfig.col = colKey;
        monitorSortConfig.dir = 'desc'; 
    }

    let dataArray;
    if (tableType === 'tech') dataArray = techLeaderboardData;
    else if (tableType === 'coord') dataArray = coordLeaderboardData;
    else if (tableType === 'driver') dataArray = driverLeaderboardData;

    dataArray.sort((a, b) => {
        let valA = a[colKey];
        let valB = b[colKey];
        
        if (typeof valA === 'string') {
            return monitorSortConfig.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return monitorSortConfig.dir === 'asc' ? valA - valB : valB - valA;
    });

    if (tableType === 'tech') drawTechLeaderboard();
    if (tableType === 'coord') drawCoordLeaderboard();
    if (tableType === 'driver') drawDriverLeaderboard();
}

function drawDriverLeaderboard() {
    const tbody = document.getElementById('driverTableBody');
    const theadRow = document.getElementById('driverHeaderRow');
    tbody.innerHTML = '';
    theadRow.innerHTML = '';

    const indexHeader = document.createElement('th');
    indexHeader.innerHTML = `<div style="padding: 5px;"><span class="sort-header" style="text-decoration: none; font-weight: bold; color: var(--text-color);">#</span></div>`;
    theadRow.appendChild(indexHeader);

    const cols = [
        { label: 'Driver', key: 'name' },
        { label: 'Unique Orders Visited', key: 'orderVisits' },
        { label: 'Total Branch Visits', key: 'branchVisits' },
        { label: 'Branches Visited', key: 'branches' }
    ];

    cols.forEach(col => {
        const th = document.createElement('th');
        let arrow = monitorSortConfig.col === col.key ? (monitorSortConfig.dir === 'asc' ? ' 🔼' : ' 🔽') : '';
        th.innerHTML = `<div style="padding: 5px; cursor: pointer;" title="Click to sort">
            <span class="sort-header" style="text-decoration: none; font-weight: bold; color: var(--text-color);">${col.label}</span>${arrow}
        </div>`;
        th.addEventListener('click', () => triggerMonitorSort('driver', col.key));
        theadRow.appendChild(th);
    });

    driverLeaderboardData.forEach((stats, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 10px; font-weight: bold; text-align: center;">${index + 1}</td>
            <td style="padding: 10px; font-weight: bold;">${stats.name}</td>
            <td style="padding: 10px; color: #1976d2;"><span class="metric-clickable" onclick="openMetricDetails('driver', '${stats.name}', 'orderVisits')">${stats.orderVisits}</span></td>
            <td style="padding: 10px; color: #f57c00;"><span class="metric-clickable" onclick="openMetricDetails('driver', '${stats.name}', 'branchVisits')">${stats.branchVisits}</span></td>
            <td style="padding: 10px; font-size: 13px; opacity: 0.9;">${stats.branches}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderMonitorTable(viewType, targetValue, dataPool = monitorTrackingRows) {
    const headerEl = document.getElementById('activeMonitorStatusHeader');
    const tableArea = document.getElementById('monitorTableArea');
    const badgesArea = document.getElementById('technicianBadges');
    const tbody = document.getElementById('monitorTableBody');
    const theadRow = document.getElementById('monitorHeaderRow');
    
    tableArea.style.display = 'block';
    document.getElementById('techTableTitle').style.display = 'none';
    document.getElementById('coordTableContainer').style.display = 'none';
    document.getElementById('driverTableContainer').style.display = 'none';
    badgesArea.style.display = 'none'; 
    tbody.innerHTML = '';
    theadRow.innerHTML = '';

    let rowsToRender = [];

    if (viewType === 'status') {
        headerEl.textContent = `Status View: ${targetValue}`;
        rowsToRender = targetValue === "All Tracking Logs" 
            ? dataPool 
            : dataPool.filter(r => (r.status || 'Unknown').trim() === targetValue || (targetValue === 'Unknown' && !r.status));
            
    } else if (viewType === 'technician') {
        headerEl.textContent = `Technician View: ${targetValue}`;
        rowsToRender = dataPool.filter(r => 
            (r.assigned_by && r.assigned_by.trim() === targetValue) || 
            (r.assigned_tech && r.assigned_tech.trim() === targetValue)
        );
    }

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
        { key: 'collected_reason', label: 'Reason', source: 'track' }, 
        { key: 'comment', label: 'Comment', source: 'track' }
    ];

    const indexHeader = document.createElement('th');
    indexHeader.innerHTML = `<div>#</div><input type="text" disabled style="width: 100%; box-sizing: border-box; margin-top: 5px; padding: 4px; border: 1px solid transparent; background: transparent; visibility: hidden;">`; 
    theadRow.appendChild(indexHeader);

    columnsConfig.forEach((cfg) => {
        const th = document.createElement('th');
        const labelDiv = document.createElement('div');
        labelDiv.textContent = cfg.label;
        th.appendChild(labelDiv);
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search...';
        searchInput.style.width = '100%';
        searchInput.style.boxSizing = 'border-box';
        searchInput.style.marginTop = '5px';
        searchInput.style.padding = '4px';
        searchInput.style.fontSize = '11px';
        searchInput.style.border = '1px solid var(--border-color)';
        searchInput.style.borderRadius = '3px';
        searchInput.style.background = 'var(--bg-color)';
        searchInput.style.color = 'var(--text-color)';
        
        searchInput.addEventListener('keyup', filterMonitorTable);
        th.appendChild(searchInput);
        theadRow.appendChild(th);
    });

    let totalCollected = 0;
    let countHass = 0;
    let countSmartThings = 0;
    let countFinished = 0;
    let totalWithReason = 0;
    let reasonBreakdown = {};

    let assignedSOs = new Set();
    let actedSOs = new Set();

    rowsToRender.forEach((trackingMatch, index) => { 
        const tr = document.createElement('tr');
        const currentSO = trackingMatch.so;
        const orderMatch = databaseOrders.find(o => String(o.so) === String(currentSO)) || {};

        const indexTd = document.createElement('td');
        indexTd.textContent = index + 1;
        indexTd.style.textAlign = 'center';
        indexTd.style.fontWeight = 'bold';
        indexTd.style.padding = "10px";
        tr.appendChild(indexTd);

        columnsConfig.forEach(cfg => {
            const td = document.createElement('td');
            let val = cfg.source === 'main' ? orderMatch[cfg.key] : trackingMatch[cfg.key];
            td.textContent = val || '';
            td.style.padding = "10px";
            tr.appendChild(td);
        });
        tbody.appendChild(tr);

        if (viewType === 'technician') {
            if (trackingMatch.assigned_tech && trackingMatch.assigned_tech.trim() === targetValue) {
                assignedSOs.add(currentSO);
            }
            if (trackingMatch.assigned_by && trackingMatch.assigned_by.trim() === targetValue) {
                actedSOs.add(currentSO);
                totalCollected += (Number(trackingMatch.collected) || 0);
                const reason = (trackingMatch.collected_reason || '').trim();
                if (reason) {
                    totalWithReason++;
                    reasonBreakdown[reason] = (reasonBreakdown[reason] || 0) + 1;
                }
            }
            if (trackingMatch.hass && String(trackingMatch.hass).trim() !== '') countHass++;
            if (trackingMatch.smart_things && String(trackingMatch.smart_things).toLowerCase() === 'yes') countSmartThings++;
            if (trackingMatch.end_tech && trackingMatch.end_tech.trim() === targetValue) countFinished++;
        }
    });

    if (viewType === 'technician') {
        badgesArea.style.display = 'flex';
        const totalAssignedOrders = assignedSOs.size;
        const totalActionsSubmitted = actedSOs.size; 
        let overlapCount = 0;
        assignedSOs.forEach(so => {
            if (actedSOs.has(so)) overlapCount++;
        });
        const leftOutCount = totalAssignedOrders - overlapCount;

        let reasonsHtml = '';
        if (totalWithReason > 0) {
            Object.keys(reasonBreakdown).sort().forEach(reason => {
                reasonsHtml += `<div style="margin-top: 5px; font-size: 12px; color: var(--text-color); border-bottom: 1px dashed var(--border-color); padding-bottom: 3px;">
                    ${reason}: <strong>${reasonBreakdown[reason]}</strong>
                </div>`;
            });
        } else {
            reasonsHtml = '<div style="margin-top: 5px; font-size: 12px; opacity: 0.6;">No reasons logged.</div>';
        }

        badgesArea.innerHTML = `
            <div style="background: var(--btn-bg); padding: 10px 15px; border-radius: 5px; border: 1px solid var(--border-color); flex: 1; min-width: 250px;">
                📌 Unique Assigned: <span class="metric-clickable" onclick="openMetricDetails('monitor', '${targetValue}', 'assigned')">${totalAssignedOrders}</span>
                <div style="margin-top: 10px; background: var(--bg-color); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 13px;">
                    ▶ Actions: <span style="color: #2e7d32;" class="metric-clickable" onclick="openMetricDetails('monitor', '${targetValue}', 'acted')">${totalActionsSubmitted}</span><br>
                    ▶ Pending: <span style="color: #d32f2f;" class="metric-clickable" onclick="openMetricDetails('monitor', '${targetValue}', 'pending')">${leftOutCount}</span><br>
                </div>
            </div>
            <div style="background: var(--btn-bg); padding: 10px 15px; border-radius: 5px; border: 1px solid var(--border-color); flex: 1; min-width: 250px;">
                📋 Logged w/ Reason: <span style="font-weight: 900;">${totalWithReason}</span>
                <div style="margin-top: 10px; background: var(--bg-color); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                    ${Object.keys(reasonBreakdown).sort().map(r => `<div style="margin-top: 5px; font-size: 12px; border-bottom: 1px dashed var(--border-color); padding-bottom: 3px;">${r}: <strong class="metric-clickable" onclick="openMetricDetails('monitor', '${targetValue}', 'reason', '${r}')">${reasonBreakdown[r]}</strong></div>`).join('')}
                </div>
            </div>
            <div style="background: var(--btn-bg); padding: 10px 15px; border-radius: 5px; border: 1px solid var(--border-color); flex: 1; min-width: 150px;">
                ✅ Finished: <span class="metric-clickable" onclick="openMetricDetails('monitor', '${targetValue}', 'finished')">${countFinished}</span><br><br>
                💰 Collected: <span class="metric-clickable" onclick="openMetricDetails('monitor', '${targetValue}', 'collected')">${totalCollected}</span>
            </div>
        `;
    }

    if (typeof applyResizableColumns === 'function') {
        applyResizableColumns('monitorDataTable', 'mon_cols');
    }
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

// --- RETURN TO HUB FROM MONITOR PAGE ---
document.getElementById('monitorHubBtn').addEventListener('click', () => {
    // Hide the monitor page and restore the global menu page
    monitorPage.classList.remove('active');
    window.menuPage.classList.add('active');
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
    const driverRows = await fetchAllRecords('drivers_log', 'action_date', dateStringsToFetch);
    
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
    monitorDriverRows = driverRows || [];
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
    let dataPool;
    if (context === 'monitor') dataPool = currentFilteredMonitorRows;
    else if (context === 'driver') dataPool = monitorDriverRows;
    else dataPool = bonusesTrackingRows;

    const safeUser = user.trim().toLowerCase();
    
    let assignedMap = new Map();
    let actedMap = new Map();
    let finalResults = new Map();

    // 1. Data Aggregation (Mapped by SO)
    dataPool.forEach((row, index) => {
        const so = row.so;
        const assignedTech = (row.assigned_tech || '').trim().toLowerCase();
        const assignedBy = (row.assigned_by || '').trim().toLowerCase();
        const endTech = (row.end_tech || '').trim().toLowerCase();
        const agreeCoord = (row.agree_coord || '').trim().toLowerCase();
        const completeCoord = (row.complete_coord || '').trim().toLowerCase();

        // Baseline mapping for Left Out math
        if (assignedTech === safeUser) assignedMap.set(so, row);
        if (assignedBy === safeUser) actedMap.set(so, row);

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
        } else if (context === 'driver') {
            const rowDriver = (row.driver_username || '').trim().toLowerCase();
            if (rowDriver === safeUser) {
                if (type === 'orderVisits' && (row.action_type === 'arrive' || row.action_type === 'leave')) isMatch = true;
                if (type === 'branchVisits' && row.action_type === 'branch_visit') isMatch = true;
            }
        } else {
            // Strictly match using raw columns for Monitor context
            if (type === 'assigned' && assignedTech === safeUser) isMatch = true;
            if (type === 'acted' && assignedBy === safeUser) isMatch = true;
            if (type === 'finished' && endTech === safeUser) isMatch = true;
            if (type === 'collected' && assignedBy === safeUser && Number(row.collected) > 0) isMatch = true;
            if (type === 'agreed' && agreeCoord === safeUser) isMatch = true;
            if (type === 'completed' && completeCoord === safeUser) isMatch = true;
            if (type === 'reason' && assignedBy === safeUser && (row.collected_reason || '').trim() === extraArg) isMatch = true;
        }

        if (isMatch) {
            // Deduplicate Set-based metrics by SO to match Leaderboard. 
            // Preserve all rows for specific count-based metrics (like reasons) by modifying the key.
            let mapKey = so + '_' + index; // Default to listing every single row
            if (context === 'monitor' && ['assigned', 'acted', 'finished', 'agreed', 'completed'].includes(type)) mapKey = so;
            if (context === 'driver' && type === 'orderVisits') mapKey = so; // Deduplicate orders so the count matches exactly
            
            finalResults.set(mapKey, row);
        }
    });

    // 2. Left Out Math (Unique Assigned SOs lacking an Action)
    if (type === 'pending') {
        finalResults.clear();
        assignedMap.forEach((row, so) => {
            if (!actedMap.has(so)) finalResults.set(so, row);
        });
    }

    // 3. UI Generation
    const listContainer = document.getElementById('metricModalList');
    listContainer.innerHTML = '';
    
    let titleType = type.toUpperCase();
    if (context === 'driver') titleType = type === 'orderVisits' ? 'Unique Orders Visited' : 'Fixed Branches Visited';
    
    document.getElementById('metricModalTitle').textContent = `Details: ${titleType}`;
    const subtitle = context === 'bonuses' ? "Showing your personal entries for the selected date range." : `Displaying records for: ${user}`;
    document.getElementById('metricModalSubtitle').textContent = subtitle;

    if (finalResults.size === 0) {
        listContainer.innerHTML = '<p style="opacity: 0.7;">No details found for this record.</p>';
    } else {
        let indexCounter = 1;
        
        finalResults.forEach((row, mapKey) => {
            const so = row.so;
            
            let detailString = '';
            if (context === 'driver') {
                detailString = `Logged At: ${row.action_date || 'N/A'} at ${row.action_time || 'N/A'}`;
            } else if (type === 'assigned' || type === 'pending') {
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

            // --- INJECT "NOT ASSIGNED PERIOD" BADGE LOGIC ---
            let unassignedBadge = '';
            if (type === 'acted' && !assignedMap.has(so)) {
                unassignedBadge = `<span style="background-color: #d32f2f; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-left: 10px; border: 1px solid #b71c1c;" title="Action taken on an order not explicitly assigned to this technician in this period.">⚠️ Not assigned period</span>`;
            }

            const card = document.createElement('div');
            card.className = 'metric-card';
            const labelText = (context === 'driver' && type === 'branchVisits') ? 'Branch: ' : 'SO: ';
            
            card.innerHTML = `
                <div class="metric-so-link" style="display: flex; align-items: center; justify-content: space-between;">
                    <div><span style="color: #1976d2; font-weight: bold; margin-right: 5px;">#${indexCounter}</span> ${labelText} ${so} ${unassignedBadge}</div>
                </div>
                <div>${detailString}</div>
            `;
            
            // Only make actual Orders clickable
            if (type !== 'branchVisits') {
                card.querySelector('.metric-so-link').style.cursor = 'pointer';
                card.querySelector('.metric-so-link').addEventListener('click', () => {
                    const mainOrder = databaseOrders.find(o => String(o.so) === String(so)) || row;
                    if (typeof openViewOnlyModal === 'function') openViewOnlyModal(mainOrder);
                });
            } else {
                card.querySelector('.metric-so-link').style.cursor = 'default';
            }

            listContainer.appendChild(card);
            indexCounter++;
        });
    }

    document.getElementById('metricDetailsModal').style.display = 'flex';
};