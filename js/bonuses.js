
// ==========================================
// --- BONUSES / PERFORMANCE TRACKING PAGE ---
// ==========================================

const bonusesPage = document.getElementById('bonusesPage');

// Global Tracking Variables for Sorting & Filtering
let bonusesTrackingRows = [];
let bonusesSortDir = {};

// NEW: Defined Columns (Now including Reason!)
const BONUSES_COLUMNS = [
    { key: 'so', label: 'SO' },
    { key: 'assign_date', label: 'Assign Date' },
    { key: 'assign_time', label: 'Assign Time' },
    { key: 'status', label: 'Status' },
    { key: 'assigned_by', label: 'Assigned By' },
    { key: 'agree_coord', label: 'Agree Coord' },
    { key: 'complete_coord', label: 'Complete Coord' },
    { key: 'assigned_tech', label: 'Assigned Tech' },
    { key: 'end_tech', label: 'End Tech' },
    { key: 'hass', label: 'Hass' },
    { key: 'smart_things', label: 'Smart Things' },
    { key: 'comment', label: 'Comment' },
    { key: 'collected_reason', label: 'Reason' }, // Added to table!
    { key: 'collected', label: 'Collected' }
];

// Helper to format HTML Dates
const formatBonusesHtmlDate = (dateObj) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// Set Default Dates to First of Current Month and Today
function setBonusesDefaultDates() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    document.getElementById('bonusesStartDate').value = formatBonusesHtmlDate(firstDay);
    document.getElementById('bonusesEndDate').value = formatBonusesHtmlDate(now);
}

// Navigation Listeners
document.getElementById('btnBonuses').addEventListener('click', () => {
    menuPage.classList.remove('active');
    bonusesPage.classList.add('active');
    setBonusesDefaultDates();
    loadBonusesData(); 
});

document.getElementById('bonusesHubBtn').addEventListener('click', () => {

    // ---Garbage (unwanted records or tables saved to the browser) Collection ---
    bonusesTrackingRows = [];
    const bonusesTbody = document.getElementById('bonusesTableBody');
    if (bonusesTbody) bonusesTbody.innerHTML = '';
    const bonusesSummary = document.getElementById('bonusesSummaryContent');
    if (bonusesSummary) bonusesSummary.innerHTML = '';
    // -------------------------------
    bonusesPage.classList.remove('active');
    menuPage.classList.add('active');
});

// Fast Date Buttons
document.getElementById('btnBonusesToday').addEventListener('click', () => {
    const now = new Date();
    document.getElementById('bonusesStartDate').value = formatBonusesHtmlDate(now);
    document.getElementById('bonusesEndDate').value = formatBonusesHtmlDate(now);
    loadBonusesData();
});

document.getElementById('btnBonusesThisMonth').addEventListener('click', () => {
    setBonusesDefaultDates();
    loadBonusesData();
});

document.getElementById('btnFetchBonuses').addEventListener('click', loadBonusesData);

// Main Fetch and Filter Engine (Upgraded with Pagination and Strict-Case Bypass)
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

    // BUG FIX 1: Use the pagination engine to safely download unlimited rows!
    const data = await fetchAllRecords('repair_log'); // Explicitly mapped to sever monitor.js dependency
    
    if (!data) {
        alert("Error loading bonuses data. Please check your connection.");
        return;
    }

    // BUG FIX 2: Convert the logged-in username to pure lowercase to prevent case-mismatch errors
   const safeCurrentName = currentUser && currentUser.username ? currentUser.username.trim().toLowerCase() : '';
    
    let badgeCounts = {
        assigned_by: 0,
        agree_coord: 0,
        complete_coord: 0,
        end_tech: 0,
        hass_done: 0,
        smart_things: 0,
        total_collected: 0,   // NEW: Tracks money
        reasonBreakdown: {}   // NEW: Tracks reasons
    };


    const filteredRows = data.filter(row => {
        if (!row.assign_date) return false;
        const parts = row.assign_date.split('-');
        if (parts.length !== 3) return false;
        const rowDate = new Date(parts[2], parts[1] - 1, parts[0]);
        
        if (rowDate < startLimit || rowDate > endLimit) return false;

        let userWasInvolved = false;
        
        // STRICT RULE: Only collect the row if the user's name is in 'assigned_by'
        if (row.assigned_by && String(row.assigned_by).trim().toLowerCase() === safeCurrentName) {
            userWasInvolved = true;
        }

        // TALLY METRICS (Calculates normally based on this restricted table)
        if (userWasInvolved) {
            if (String(row.assigned_by || '').trim().toLowerCase() === safeCurrentName) badgeCounts.assigned_by++;
            if (String(row.agree_coord || '').trim().toLowerCase() === safeCurrentName) badgeCounts.agree_coord++;
            if (String(row.complete_coord || '').trim().toLowerCase() === safeCurrentName) badgeCounts.complete_coord++;
            if (String(row.end_tech || '').trim().toLowerCase() === safeCurrentName) badgeCounts.end_tech++;
            
            if (String(row.hass || '').trim().toLowerCase() === 'yes') badgeCounts.hass_done++;
            if (String(row.smart_things || '').trim().toLowerCase() === 'yes') badgeCounts.smart_things++;

            // NEW: Add up the collected money securely
            badgeCounts.total_collected += (Number(row.collected) || 0);

            // NEW: Tally the specific reasons
            let reason = (row.collected_reason || '').trim();
            
            // --- LEGACY/RETIRED ACTIONS INTERCEPTOR ---
            if (reason === 'عمرة' || reason === 'شحنة') {
                reason = 'Legacy/Retired Actions';
            }
            // ------------------------------------------

            if (reason) {
                badgeCounts.reasonBreakdown[reason] = (badgeCounts.reasonBreakdown[reason] || 0) + 1;
            }
        }

        return userWasInvolved; 
    });

    // Generate the Badge HTML
    let summaryHTML = '';
    const addMetric = (label, count, type) => {
        if (count > 0) { 
            summaryHTML += `
            <div class="metric-clickable" onclick="openMetricDetails('bonuses', '${safeCurrentName}', '${type}')" style="background: var(--btn-bg); padding: 10px 20px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; align-items: center; min-width: 130px; flex-grow: 1;">
                <span style="font-size: 11px; color: var(--text-color); margin-bottom: 5px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase;">${label}</span>
                <span style="font-size: 24px; font-weight: 900; color: var(--text-color);">${count}</span>
            </div>`;
        }
    };

    addMetric('Assigned order', badgeCounts.assigned_by, 'acted'); // Assigned by YOU = acted
    addMetric('Agree customers', badgeCounts.agree_coord, 'agreed');
    addMetric('Completed Orders', badgeCounts.complete_coord, 'completed');
    addMetric('Ended Orders', badgeCounts.end_tech, 'finished');
    addMetric('Hass Done', badgeCounts.hass_done, 'hass');
    addMetric('Smart Things', badgeCounts.smart_things, 'smart_things');
    addMetric('Total Collected', badgeCounts.total_collected, 'collected');

    // NEW: Renders Reason Breakdown Badge if reasons exist
    if (Object.keys(badgeCounts.reasonBreakdown).length > 0) {
        let reasonsHtml = '';
        Object.keys(badgeCounts.reasonBreakdown).sort().forEach(r => {
            reasonsHtml += `<div style="margin-top: 5px; font-size: 13px; color: var(--text-color); border-bottom: 1px dashed var(--border-color); padding-bottom: 3px; width: 100%; text-align: left;">
                ${r}: <strong class="metric-clickable" onclick="openMetricDetails('bonuses', '${safeCurrentName}', 'reason', '${r}')">${badgeCounts.reasonBreakdown[r]}</strong>
            </div>`;
        });
        
        summaryHTML += `
        <div style="background: var(--btn-bg); padding: 10px 20px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; align-items: center; min-width: 180px; flex-grow: 1;">
            <span style="font-size: 11px; color: var(--text-color); margin-bottom: 5px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase;">Reason Breakdown</span>
            <div style="width: 100%; margin-top: 5px;">${reasonsHtml}</div>
        </div>`;
    }

    const summaryContent = document.getElementById('bonusesSummaryContent');
    if (summaryHTML === '') {
         summaryContent.innerHTML = '<div style="padding: 10px; opacity: 0.7;">No tracked actions found for the selected dates.</div>';
    } else {
         summaryContent.innerHTML = summaryHTML;
    }

    bonusesTrackingRows = filteredRows;
    renderBonusesTable();
}

// RENDER & SORT ENGINE
function renderBonusesTable(dataToRender = bonusesTrackingRows) {
    const thead = document.getElementById('bonusesHeaderRow');
    const tbody = document.getElementById('bonusesTableBody');
    
    // Build Headers & Search Boxes once
    if (thead.children.length === 0) {
        const tr = document.createElement('tr');
        
        // --- Inject Row Number Header ---
        const indexHeader = document.createElement('th');
        indexHeader.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; width: 100%;">
                <span style="font-weight:bold;">#</span>
            </div>
            <input type="text" disabled style="width: 100%; box-sizing: border-box; margin-top: 5px; padding: 4px; border: 1px solid transparent; background: transparent; visibility: hidden;">
        `;
        tr.appendChild(indexHeader);

        BONUSES_COLUMNS.forEach(col => {
            const th = document.createElement('th');
            
            // Header Text with Sorting
            th.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <span class="sort-header" style="cursor:pointer; font-weight:bold;">${col.label}</span>
                </div>
            `;
            th.querySelector('.sort-header').addEventListener('click', () => sortBonusesColumn(col.key));
            
            // Excel-style Search Box
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
            
            searchInput.addEventListener('keyup', filterBonusesTable);
            
            th.appendChild(searchInput);
            tr.appendChild(th);
        });
        thead.appendChild(tr);
    }

    tbody.innerHTML = '';
    
    dataToRender.forEach((row, index) => { // <-- Added 'index' here
        const tr = document.createElement('tr');
        
        // --- Inject Row Number Cell ---
        const indexTd = document.createElement('td');
        indexTd.textContent = index + 1;
        indexTd.style.textAlign = 'center';
        indexTd.style.fontWeight = 'bold';
        tr.appendChild(indexTd);

        BONUSES_COLUMNS.forEach(col => {
            const td = document.createElement('td');
            const cellValue = row[col.key] ? String(row[col.key]) : '';
            td.textContent = cellValue;
            
            // Highlight current user's name
            if (cellValue.trim() === (currentUser ? currentUser.username : '')) {
                td.style.fontWeight = "bold";
                td.style.color = "#4caf50"; 
            }
            
            tr.appendChild(td);
        });
        
        tbody.appendChild(tr);
    });
}

// LIGHTWEIGHT DOM FILTER
function filterBonusesTable() {
    const trs = document.getElementById('bonusesTableBody').getElementsByTagName('tr');
    const inputs = document.getElementById('bonusesHeaderRow').getElementsByTagName('input');
    
    let visibleCount = 1; // --- NEW: Start our dynamic counter
    
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
        
        // --- NEW: Update the row number if the row is visible ---
        if (showRow && tds[0]) {
            tds[0].textContent = visibleCount++;
        }
    }
}

// COLUMN SORTING
function sortBonusesColumn(colKey) {
    const currentDir = bonusesSortDir[colKey] === 'asc' ? 'desc' : 'asc';
    bonusesSortDir = { [colKey]: currentDir }; 

    bonusesTrackingRows.sort((a, b) => {
        let valA = a[colKey] || '';
        let valB = b[colKey] || '';

        // Safely sort date columns
        if ((colKey === 'assign_date' || colKey === 'date') && valA && valB) {
            const partsA = valA.split('-');
            const partsB = valB.split('-');
            if(partsA.length === 3 && partsB.length === 3) {
                const dateA = new Date(partsA[2], partsA[1] - 1, partsA[0]);
                const dateB = new Date(partsB[2], partsB[1] - 1, partsB[0]);
                return currentDir === 'asc' ? dateA - dateB : dateB - dateA;
            }
        }

        // Standard string sorting
        return currentDir === 'asc' 
            ? String(valA).localeCompare(String(valB)) 
            : String(valB).localeCompare(String(valA));
    });

    renderBonusesTable(bonusesTrackingRows);
    filterBonusesTable(); // Re-apply filters so hidden items stay hidden!
}
