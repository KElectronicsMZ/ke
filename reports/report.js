// ==========================================
// --- 1. THEME INHERITANCE ENGINE ---
// ==========================================
// Instantly read the theme saved by the main app and apply it here
const savedTheme = localStorage.getItem('ke_saved_theme');
if (savedTheme) {
    document.body.setAttribute('data-theme', savedTheme);
} else {
    // Failsafe: If no theme is saved in memory yet, force the default
    document.body.setAttribute('data-theme', 'greenish');
}

// ==========================================
// --- 2. DEFAULT 8 PM TIME ENGINE ---
// ==========================================
function setReportDefaultDates() {
    const now = new Date();
    
    // Quick helper to format dates for HTML inputs
    const formatHtmlDate = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const today = now;
    
    // Calculate exactly yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // 1. Set the Dates
    document.getElementById('reportStartDate').value = formatHtmlDate(yesterday);
    document.getElementById('reportEndDate').value = formatHtmlDate(today);

    // 2. Set the Times strictly to 8:00 PM (20:00 in 24-hour time)
    document.getElementById('reportStartTime').value = "20:00";
    document.getElementById('reportEndTime').value = "20:00";
}

// Run this the exact second the script loads
setReportDefaultDates();


// ==========================================
// --- 3. DATABASE CONNECTION & HELPERS ---
// ==========================================
const SUPABASE_URL = "https://nltzapfwhuidmjlnjwgy.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_9uEZtAWURjryzdCaVwH2Eg_OaW1MmpC"; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Universal Fetcher to bypass 1000-row limits
async function fetchAllRecords(tableName, filterColumn = null, filterValues = null) {
    let allData = [];
    let from = 0;
    const step = 999; 
    let keepFetching = true;

    while (keepFetching) {
        let query = supabaseClient.from(tableName).select('*');
        if (filterColumn && filterValues && filterValues.length > 0) {
            query = query.in(filterColumn, filterValues);
        }
        const { data, error } = await query.range(from, from + step);
        if (error) { console.error("Error fetching: " + error.message); break; }
        allData = allData.concat(data);
        if (data.length <= step) keepFetching = false;
        else from += step + 1; 
    }
    return allData;
}

// Helper to convert DD-MM-YYYY and HH:MM text into true math-ready Date objects
function parseLogDate(dateStr, timeStr) {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date(0);
    const timeParts = (timeStr || '00:00').split(':');
    return new Date(parts[2], parts[1] - 1, parts[0], timeParts[0], timeParts[1]);
}

// ==========================================
// --- 4. DATA FETCHING & CHUNKING ENGINE ---
// ==========================================
document.getElementById('btnRunReport').addEventListener('click', async () => {
    const startDateVal = document.getElementById('reportStartDate').value;
    const startTimeVal = document.getElementById('reportStartTime').value;
    const endDateVal = document.getElementById('reportEndDate').value;
    const endTimeVal = document.getElementById('reportEndTime').value;

    if (!startDateVal || !startTimeVal || !endDateVal || !endTimeVal) {
        alert("Please ensure all date and time fields are filled out.");
        return;
    }

    // Convert UI inputs into absolute Date limits
    const startLimit = new Date(`${startDateVal}T${startTimeVal}`);
    const endLimit = new Date(`${endDateVal}T${endTimeVal}`);

    if (startLimit >= endLimit) {
        alert("End date/time must be after start date/time.");
        return;
    }

    const btn = document.getElementById('btnRunReport');
    btn.textContent = "Fetching Data... ⏳";
    btn.disabled = true;

    // 1. Fetch ALL logs
    const allLogs = await fetchAllRecords('repair_log');
    
    // 2. Filter logs strictly within our absolute time window
    const validLogs = allLogs.filter(log => {
        const logTime = parseLogDate(log.assign_date, log.assign_time);
        return logTime >= startLimit && logTime <= endLimit;
    });

    // 3. Fetch Orders associated with these logs to get customer details for Phase 4
    const uniqueSOs = [...new Set(validLogs.map(log => log.so))];
    let ordersData = [];
    if (uniqueSOs.length > 0) {
        ordersData = await fetchAllRecords('orders', 'so', uniqueSOs);
    }
    const orderMap = {};
    ordersData.forEach(o => orderMap[o.so] = o);

    // 4. CHUNKING ENGINE: Split data into Daily Blocks based on your start time
    const reportChunks = [];
    let currentChunkStart = new Date(startLimit);

    while (currentChunkStart < endLimit) {
        // Calculate the end of this specific 24-hour block
        let currentChunkEnd = new Date(currentChunkStart);
        currentChunkEnd.setDate(currentChunkEnd.getDate() + 1);
        
        // If the chunk overshoots the user's end limit, cap it
        if (currentChunkEnd > endLimit) {
            currentChunkEnd = endLimit;
        }

        // Find logs that happened exactly inside this block
        const logsInChunk = validLogs.filter(log => {
            const logTime = parseLogDate(log.assign_date, log.assign_time);
            return logTime >= currentChunkStart && logTime < currentChunkEnd;
        });

        if (logsInChunk.length > 0) {
            reportChunks.push({
                startTime: new Date(currentChunkStart),
                endTime: new Date(currentChunkEnd),
                logs: logsInChunk
            });
        }

        // Move the loop forward to the next day
        currentChunkStart = new Date(currentChunkEnd);
    }

    // 5. AGGREGATE METRICS PER TECHNICIAN/USER
    const finalReportData = reportChunks.map(chunk => {
        const userStats = {};

        chunk.logs.forEach(log => {
            const actedBy = (log.assigned_by || 'Unknown').trim();
            const assignedTo = (log.assigned_tech || '').trim();
            
            // Initialize the user's memory box if they don't exist in this block yet
            const initUser = (name) => {
                if (name && name !== '' && !userStats[name]) {
                    userStats[name] = {
                        name: name,
                        actionsTaken: [],
                        ordersAssigned: new Set(),
                        totalCollected: 0,
                        reasonsBreakdown: {}
                    };
                }
            };

            // Track Actions (Who pressed the button)
            if (actedBy && actedBy !== 'Unknown') {
                initUser(actedBy);
                userStats[actedBy].actionsTaken.push(log);
                
                // Money Math
                const money = Number(log.collected) || 0;
                userStats[actedBy].totalCollected += money;
                
                // Reason Tally (e.g., اوبن سيل او ليدات)
                const reason = (log.collected_reason || '').trim();
                if (reason) {
                    userStats[actedBy].reasonsBreakdown[reason] = (userStats[actedBy].reasonsBreakdown[reason] || 0) + 1;
                }
            }

            // Track Assignments (Who it was given to)
            if (assignedTo && assignedTo !== 'Unknown') {
                initUser(assignedTo);
                userStats[assignedTo].ordersAssigned.add(log.so);
            }
        });

        return {
            chunkStart: chunk.startTime,
            chunkEnd: chunk.endTime,
            userStats: userStats
        };
    });

    // We will build the UI rendering in Phase 4. For now, we prove the math works.
    console.log("PHASE 3 COMPLETE. Structured Data:", finalReportData);
    
    alert(`Data Fetched! Found ${validLogs.length} actions across ${finalReportData.length} daily block(s). Press F12 to view the structured data.`);
    
    btn.textContent = "Run Report";
    btn.disabled = false;
    
    // phase 4 
    window.renderReportUI(finalReportData, orderMap); 
});

// ==========================================
// --- 5. UI RENDERING & THEME INTEGRATION ---
// ==========================================
window.renderReportUI = function(reportChunks, orderMap) {
    window.currentReportChunks = reportChunks; 
    window.currentOrderMap = orderMap;        
    const container = document.getElementById('reportContent');
    container.innerHTML = '';
    container.style.display = 'block';

    if (reportChunks.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--border-color);">No activity found for this time range.</div>';
        return;
    }

    // Loop through every 24-hour block
    reportChunks.forEach((chunk, chunkIndex) => {
        const chunkDiv = document.createElement('div');
        chunkDiv.style.marginBottom = '40px';

        // Block Header
        const header = document.createElement('h3');
        header.style.cssText = "background: var(--btn-bg); color: var(--text-color); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px; text-align: center;";
        
        // Clean Date Formatting (e.g., "Mon, Aug 17, 08:00 PM")
        const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' };
        header.innerHTML = `📅 <span style="opacity: 0.8;">Report Window:</span> ${chunk.chunkStart.toLocaleString(undefined, opts)} <strong style="color: #ffb300;"> ➡️ </strong> ${chunk.chunkEnd.toLocaleString(undefined, opts)}`;
        chunkDiv.appendChild(header);

        // Tech Cards Grid
        const grid = document.createElement('div');
        grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px;";

        for (const [username, stats] of Object.entries(chunk.userStats)) {
            const card = document.createElement('div');
            card.style.cssText = "background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);";
            
            card.innerHTML = `<h4 style="margin: 0; color: #1976d2; font-size: 18px; border-bottom: 2px solid var(--border-color); padding-bottom: 8px;">👤 ${username.toUpperCase()}</h4>`;

            // Top Badges (Now Clickable)
            const badgeContainer = document.createElement('div');
            badgeContainer.style.cssText = "display: flex; gap: 10px; flex-wrap: wrap;";
            badgeContainer.innerHTML = `
                <span style="background: rgba(46, 125, 50, 0.1); color: #2e7d32; padding: 5px 10px; border-radius: 4px; font-weight: bold; font-size: 13px; border: 1px solid #2e7d32;">✅ Actions: <span class="metric-clickable" style="text-decoration: underline;" onclick="openReportMetricModal(${chunkIndex}, '${username}', 'actions')">${stats.actionsTaken.length}</span></span>
                <span style="background: rgba(245, 124, 0, 0.1); color: #f57c00; padding: 5px 10px; border-radius: 4px; font-weight: bold; font-size: 13px; border: 1px solid #f57c00;">📌 Assigned: <span class="metric-clickable" style="text-decoration: underline;" onclick="openReportMetricModal(${chunkIndex}, '${username}', 'assigned')">${stats.ordersAssigned.size}</span></span>
                <span style="background: rgba(142, 36, 170, 0.1); color: #8e24aa; padding: 5px 10px; border-radius: 4px; font-weight: bold; font-size: 13px; border: 1px solid #8e24aa;">💰 Collected: <span class="metric-clickable" style="text-decoration: underline;" onclick="openReportMetricModal(${chunkIndex}, '${username}', 'collected')">${stats.totalCollected}</span></span>
            `;
            card.appendChild(badgeContainer);

            // Tally List for Reasons
            if (Object.keys(stats.reasonsBreakdown).length > 0) {
                const reasonDiv = document.createElement('div');
                reasonDiv.style.cssText = "background: var(--bg-color); padding: 10px; border-radius: 4px; border: 1px dashed var(--border-color); font-size: 13px;";
                reasonDiv.innerHTML = `<strong style="display: block; margin-bottom: 5px; color: var(--text-color);">🛠️ Types of Service Completed:</strong>`;
                
                Object.keys(stats.reasonsBreakdown).sort().forEach(r => {
                    reasonDiv.innerHTML += `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted var(--border-color); padding: 3px 0; color: var(--text-color);"><span>${r}</span> <strong class="metric-clickable" style="text-decoration: underline;" onclick="openReportMetricModal(${chunkIndex}, '${username}', 'reason', '${r}')">${stats.reasonsBreakdown[r]}</strong></div>`;
                });
                card.appendChild(reasonDiv);
            }

            // Detailed Action Logs (Scrollable box)
            if (stats.actionsTaken.length > 0) {
                const logContainer = document.createElement('div');
                logContainer.style.cssText = "max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 5px;";
                
                // Sort actions newest-first
                stats.actionsTaken.sort((a,b) => parseLogDate(b.assign_date, b.assign_time) - parseLogDate(a.assign_date, a.assign_time));

                stats.actionsTaken.forEach(log => {
                    const logCard = document.createElement('div');
                    logCard.style.cssText = "background: var(--bg-color); padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px;";
                    
                    // Create the clickable SO link
                    const soLink = document.createElement('a');
                    soLink.href = "#";
                    soLink.style.cssText = "color: #1976d2; font-weight: bold; text-decoration: underline; font-size: 14px;";
                    soLink.textContent = `SO: ${log.so}`;
                    soLink.onclick = (e) => {
                        e.preventDefault();
                        openReportViewModal(log.so, orderMap); // Trigger modal
                    };

                    logCard.innerHTML = `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px dashed var(--border-color); padding-bottom: 4px;">
                            <div class="so-inject-target"></div>
                            <span style="opacity: 0.8; font-weight: bold; color: var(--text-color);">${log.assign_time}</span>
                        </div>
                        <div style="margin-bottom: 4px; opacity: 0.9; color: var(--text-color);"><strong>Status Set To:</strong> ${log.status || 'N/A'}</div>
                        <div style="color: var(--text-color); font-style: italic; border-left: 2px solid #f57c00; padding-left: 5px;">${log.comment || 'No comment left'}</div>
                    `;
                    
                    // Safely attach the link element
                    logCard.querySelector('.so-inject-target').appendChild(soLink);
                    logContainer.appendChild(logCard);
                });
                card.appendChild(logContainer);
            }

            grid.appendChild(card);
        }
        
        chunkDiv.appendChild(grid);
        container.appendChild(chunkDiv);
    });

    // Un-hide export buttons (for Phase 6)
    document.getElementById('btnExportExcel').style.display = 'inline-block';
    document.getElementById('btnExportPDF').style.display = 'inline-block';
};

// ==========================================
// --- 6. REPORT TICKET MODAL ENGINE ---
// ==========================================
window.openReportViewModal = function(so, orderMap) {
    const ticket = orderMap[so];
    if(!ticket) {
        alert("Order details could not be found for this ticket.");
        return;
    }

    document.getElementById('reportModalHeader').textContent = 'View Order - SO: ' + ticket.so;
    
    const safePhone1 = ticket.phone ? String(ticket.phone).replace(/\s+/g, '') : '';
    const p1 = ticket.phone ? `<a class="phone-link" style="color: #4caf50; font-weight: bold; text-decoration: none;" href="tel:${safePhone1}">📞 ${ticket.phone}</a>` : 'N/A';
    
    // Dynamic parts list matching your main app
    let viewPartsArray = [];
    for (let i = 1; i <= 5; i++) {
        let part = (ticket[`part_${i}`] || '').trim();
        let qty = (ticket[`qty_${i}`] || '').trim();
        if (part && part.toUpperCase() !== 'EMPTY') {
            viewPartsArray.push(`${part} (x${qty && qty.toUpperCase() !== 'EMPTY' ? qty : '1'})`);
        }
    }
    let viewPartsHtml = viewPartsArray.length > 0 
        ? `<div style="color: #8e24aa; font-size: 14px; font-weight: bold; margin-bottom: 5px;">🛠️ Parts: ${viewPartsArray.join(', ')}</div>` 
        : `<strong>Parts:</strong> N/A<br>`;

    document.getElementById('reportModalBody').innerHTML = `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 8px;">
            <span style="color:#ffb300; font-weight: bold; font-size: 15px;">Days: ${ticket.days || 0}</span>
        </div>
        <div class="ticket-row" style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span><strong>Name:</strong> ${ticket.name || 'N/A'}</span> <span>${p1}</span>
        </div>
        <div class="ticket-row" style="margin-bottom: 5px;"><span><strong>Date:</strong> ${ticket.date || 'N/A'}</span></div>
        <div class="ticket-row" style="margin-top: 5px; margin-bottom: 5px;"><strong>Address:</strong> ${ticket.address || 'N/A'}</div>
        <div class="ticket-row" style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span><strong>Model:</strong> ${ticket.model || 'N/A'}</span> <span><strong>SN:</strong> ${ticket.serial || 'N/A'}</span>
        </div>
        <hr style="border-color: var(--border-color); margin: 12px 0;">
        <div style="margin-bottom: 5px;"><strong>Remark:</strong> ${ticket.remark || 'N/A'}</div>
        <div style="margin-bottom: 5px;"><strong>Status Comment:</strong> ${ticket.status_comment || 'N/A'}</div>
        <div style="margin-bottom: 5px;"><strong>Status:</strong> ${ticket.status || 'N/A'}</div>
        <div style="margin-bottom: 10px;"><strong>Assigned Tech:</strong> <span style="color: #1976d2; font-weight: bold;">${ticket.assigned_tech || 'N/A'}</span></div>
        ${viewPartsHtml}
    `;
    
    document.getElementById('reportDetailsModal').style.display = 'flex';
};

// ==========================================
// --- 7. METRIC LIST MODAL ENGINE ---
// ==========================================
window.openReportMetricModal = function(chunkIndex, username, type, extraArg = null) {
    const stats = window.currentReportChunks[chunkIndex].userStats[username];
    if (!stats) return;

    let displayList = [];
    let modalTitle = '';

    // Filter the raw data based on exactly which number the user clicked
    if (type === 'actions') {
        displayList = stats.actionsTaken;
        modalTitle = `Actions by ${username}`;
    } else if (type === 'assigned') {
        // Convert the Set of assigned SOs into an array object so we can loop it
        displayList = Array.from(stats.ordersAssigned).map(so => ({ so: so }));
        modalTitle = `Orders Assigned to ${username}`;
    } else if (type === 'collected') {
        displayList = stats.actionsTaken.filter(log => Number(log.collected) > 0);
        modalTitle = `Collections by ${username}`;
    } else if (type === 'reason') {
        displayList = stats.actionsTaken.filter(log => (log.collected_reason || '').trim() === extraArg);
        modalTitle = `Reason: ${extraArg} (${username})`;
    }

    const listContainer = document.getElementById('reportMetricList');
    listContainer.innerHTML = '';
    document.getElementById('reportMetricModalTitle').textContent = modalTitle;

    if (displayList.length === 0) {
        listContainer.innerHTML = '<p style="opacity: 0.7;">No records found.</p>';
    } else {
        displayList.forEach(item => {
            const card = document.createElement('div');
            card.className = 'metric-card'; // Reusing your existing CSS styles
            
            // Format the details gracefully (Assigned tickets won't have action times yet)
            let extraInfo = '';
            if (item.assign_time) {
                extraInfo = `Date: ${item.assign_date} at ${item.assign_time} <br>`;
                if (type === 'collected') extraInfo += `<strong>Collected:</strong> ${item.collected} <br>`;
                if (item.status) extraInfo += `<strong>Status:</strong> ${item.status}`;
            } else {
                extraInfo = '<span style="opacity: 0.7;">Assigned (Pending Action)</span>';
            }

            // Draw the clickable SO link that routes to the View Ticket Modal
            card.innerHTML = `
                <a href="#" class="metric-so-link" onclick="openReportViewModal('${item.so}', window.currentOrderMap); return false;">SO: ${item.so}</a>
                <div style="margin-top: 5px; font-size: 12px;">${extraInfo}</div>
            `;
            listContainer.appendChild(card);
        });
    }

    document.getElementById('reportMetricListModal').style.display = 'flex';
};
// ==========================================
// --- 8. EXPORT MODULES (EXCEL & PDF) ---
// ==========================================

// --- EXCEL EXPORT (STYLED & ADVANCED METRICS - FIXED) ---
document.getElementById('btnExportExcel').addEventListener('click', async () => {
    if (!window.currentReportChunks || window.currentReportChunks.length === 0) {
        alert("No data to export. Please run the report first.");
        return;
    }

    const btn = document.getElementById('btnExportExcel');
    btn.textContent = "Generating... ⏳";
    btn.disabled = true;

    try {
        // 1. Fetch user roles so we can split Techs and Coords
        const { data: profiles } = await supabaseClient.from('profiles').select('username, role');
        const roleMap = {};
        if (profiles) {
            profiles.forEach(p => roleMap[p.username.trim().toUpperCase()] = p.role.toLowerCase());
        }

        const excelDetailedData = [];
        const collectionsData = [];
        
        const techTotals = {};
        const coordTotals = {};
        const globalReasons = {}; // Tracks grand totals for the percentage math

        // 2. Deep Dive Data Aggregation (Fixed Loop Structure)
        window.currentReportChunks.forEach(chunk => {
            const opts = { month: 'short', day: 'numeric' };
            const blockName = `${chunk.chunkStart.toLocaleDateString(undefined, opts)} to ${chunk.chunkEnd.toLocaleDateString(undefined, opts)}`;
            
            // Loop through the grouped user stats instead of raw logs
            Object.values(chunk.userStats).forEach(user => {
                const actor = user.name.toUpperCase();
                const role = roleMap[actor] || 'technician';
                
                // --- Initialize User Memory ---
                if (role.includes('coordinator') || role.includes('tracking')) {
                    // Use a Set to track unique SOs dispatched OUT to techs
                    if (!coordTotals[actor]) coordTotals[actor] = { name: actor, assignedOutbound: new Set(), agreed: 0, completed: 0, totalActions: 0 };
                } else {
                    if (!techTotals[actor]) techTotals[actor] = { name: actor, assigned: 0, actions: 0, collected: 0, zeroMoney: 0, smartHome: 0, reasons: {} };
                    techTotals[actor].assigned += user.ordersAssigned.size;
                }

                // --- Safely Loop Through Their Specific Actions ---
                user.actionsTaken.forEach(log => {
                    const reason = (log.collected_reason || '').trim();
                    const money = Number(log.collected) || 0;

                    if (role.includes('coordinator') || role.includes('tracking')) {
                        coordTotals[actor].totalActions++;
                        if (log.agree_coord && log.agree_coord.trim().toUpperCase() === actor) coordTotals[actor].agreed++;
                        if (log.complete_coord && log.complete_coord.trim().toUpperCase() === actor) coordTotals[actor].completed++;
                        
                        // Track unique outbound assignments dispatched by this coordinator
                        if (log.assigned_tech && log.assigned_tech.trim() !== '') {
                            coordTotals[actor].assignedOutbound.add(log.so);
                        }
                    } else {
                        techTotals[actor].actions++;
                        techTotals[actor].collected += money;
                        if (money === 0) techTotals[actor].zeroMoney++;
                        if ((log.smart_things||'').toLowerCase() === 'yes' || (log.hass||'').toLowerCase() === 'yes') techTotals[actor].smartHome++;
                        
                        // Add to grand total ONLY for techs, so math is accurate
                        if (reason) {
                            globalReasons[reason] = (globalReasons[reason] || 0) + 1;
                            techTotals[actor].reasons[reason] = (techTotals[actor].reasons[reason] || 0) + 1;
                        }
                    }

                    // Build Detailed & Collection Sheets
                    excelDetailedData.push({
                        "Time Block": blockName,
                        "User": actor,
                        "Role": role.includes('coordinator') ? 'Coord' : 'Tech',
                        "SO Number": log.so,
                        "Action Date": log.assign_date,
                        "Action Time": log.assign_time,
                        "Status": log.status || '',
                        "Collected": money,
                        "Reason": reason,
                        "Comment": log.comment || ''
                    });

                    if (money > 0) {
                        collectionsData.push({
                            "User": actor, "Date": log.assign_date, "Time": log.assign_time,
                            "Amount": money, "Reason": reason, "SO Number": log.so
                        });
                    }
                });
            });
        });

        // 3. STYLING DEFINITIONS (xlsx-js-style configuration)
        const borderStyle = { 
            top: { style: "thin", color: { rgb: "FFB0BEC5" } }, bottom: { style: "thin", color: { rgb: "FFB0BEC5" } },
            left: { style: "thin", color: { rgb: "FFB0BEC5" } }, right: { style: "thin", color: { rgb: "FFB0BEC5" } }
        };
        const dataStyle = { border: borderStyle, alignment: { vertical: "center" } };
        
        // Header Colors
        const techHeaderStyle = { font: { bold: true, color: { rgb: "FFFFFFFF" } }, fill: { fgColor: { rgb: "FF1976D2" } }, border: borderStyle }; // Blue
        const aspectHeaderStyle = { font: { bold: true, color: { rgb: "FFFFFFFF" } }, fill: { fgColor: { rgb: "FF8E24AA" } }, border: borderStyle }; // Purple
        const coordHeaderStyle = { font: { bold: true, color: { rgb: "FFFFFFFF" } }, fill: { fgColor: { rgb: "FF2E7D32" } }, border: borderStyle }; // Green

        // 4. BUILD MASTER PERFORMANCE SHEET (AoA with Styles)
        const sortedReasons = Array.from(Object.keys(globalReasons)).sort();
        const masterSheetAoA = [];

        // --- TECHNICIAN TABLE ---
        const techHeaderRow = ["Technician", "Assigned Queue", "Actions Taken", "Total Revenue", "Action/Assign Ratio", "Avg Rev/Action", "Zero-Collection Rate", "Smart Home Rate"].map(h => ({ v: h, s: techHeaderStyle }));
        sortedReasons.forEach(r => techHeaderRow.push({ v: r, s: aspectHeaderStyle }));
        masterSheetAoA.push(techHeaderRow);

        Object.values(techTotals).forEach(u => {
            const actionRatio = u.assigned > 0 ? ((u.actions / u.assigned) * 100).toFixed(1) + '%' : (u.actions > 0 ? 'Overflow' : '0%');
            const avgRevenue = u.actions > 0 ? (u.collected / u.actions).toFixed(2) : 0;
            const zeroRate = u.actions > 0 ? ((u.zeroMoney / u.actions) * 100).toFixed(1) + '%' : '0%';
            const smartRate = u.actions > 0 ? ((u.smartHome / u.actions) * 100).toFixed(1) + '%' : '0%';

            const row = [u.name, u.assigned, u.actions, u.collected, actionRatio, avgRevenue, zeroRate, smartRate].map(val => ({ v: val, s: dataStyle }));
            
            // Percentage Math for Aspects
            sortedReasons.forEach(r => {
                const count = u.reasons[r] || 0;
                const totalOfAspect = globalReasons[r] || 1; 
                const percent = ((count / totalOfAspect) * 100).toFixed(1);
                row.push({ v: count > 0 ? `${count} (${percent}%)` : '0', s: dataStyle });
            });
            masterSheetAoA.push(row);
        });

        masterSheetAoA.push([]); masterSheetAoA.push([]); // Visual Spacing

        // --- COORDINATOR TABLE ---
        const coordHeaderRow = ["Coordinator", "Assigned Orders (Outbound)", "Agreed Orders", "Completed Orders", "Total Operations"].map(h => ({ v: h, s: coordHeaderStyle }));
        masterSheetAoA.push(coordHeaderRow);

        Object.values(coordTotals).forEach(u => {
            masterSheetAoA.push([u.name, u.assignedOutbound.size, u.agreed, u.completed, u.totalActions].map(val => ({ v: val, s: dataStyle })));
        });

        // 5. GENERATE WORKBOOK
        const workbook = XLSX.utils.book_new();
        
        // Sheet 1: Master Performance
        const wsMaster = XLSX.utils.aoa_to_sheet(masterSheetAoA);
        wsMaster['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 18 }];
        sortedReasons.forEach(() => wsMaster['!cols'].push({ wch: 20 })); // Give aspects wider columns for percentages
        XLSX.utils.book_append_sheet(workbook, wsMaster, "Performance Dash");

        // Helper function to cleanly style raw JSON sheets
        const styleRawSheet = (dataArray) => {
            const ws = XLSX.utils.json_to_sheet(dataArray);
            const range = XLSX.utils.decode_range(ws['!ref']);
            for(let R = range.s.r; R <= range.e.r; ++R) {
                for(let C = range.s.c; C <= range.e.c; ++C) {
                    const cellRef = XLSX.utils.encode_cell({c:C, r:R});
                    if(!ws[cellRef]) continue;
                    ws[cellRef].s = { border: borderStyle };
                    if (R === 0) { // Dark grey headers for data sheets
                        ws[cellRef].s.fill = { fgColor: { rgb: "FF455A64" } };
                        ws[cellRef].s.font = { bold: true, color: { rgb: "FFFFFFFF" } };
                    }
                }
            }
            ws['!cols'] = Array(10).fill({ wch: 18 });
            return ws;
        };
        
        // Sheet 2 & 3: Collections & Details
        const finalCols = collectionsData.length > 0 ? collectionsData : [{"Message": "No collections"}];
        XLSX.utils.book_append_sheet(workbook, styleRawSheet(finalCols), "Collections");
        
        const finalDetails = excelDetailedData.length > 0 ? excelDetailedData : [{"Message": "No logs found"}];
        XLSX.utils.book_append_sheet(workbook, styleRawSheet(finalDetails), "Detailed Logs");

        // Execute Download
        const dateStr = new Date().toISOString().split('T')[0];
        XLSX.writeFile(workbook, `Performance_Report_${dateStr}.xlsx`);

    } catch (err) {
        alert("Error generating Excel: " + err.message);
    } finally {
        btn.textContent = "⬇️ Excel";
        btn.disabled = false;
    }
});

// --- PDF EXPORT ---
document.getElementById('btnExportPDF').addEventListener('click', () => {
    if (!window.currentReportChunks || window.currentReportChunks.length === 0) {
        alert("No data to export. Please run the report first.");
        return;
    }

    const btn = document.getElementById('btnExportPDF');
    const originalText = btn.textContent;
    btn.textContent = "Generating... ⏳";
    btn.disabled = true;

    // 1. Save current theme and force a light, print-friendly theme
    const originalTheme = document.body.getAttribute('data-theme');
    document.body.setAttribute('data-theme', 'greenish'); 

    // 2. Hide the controls block so the buttons don't appear in the PDF
    const controlsDiv = document.getElementById('btnRunReport').parentElement.parentElement;
    controlsDiv.style.display = 'none';

    // 3. Configure PDF settings
    const element = document.body;
    const opt = {
        margin:       0.3,
        filename:     `Performance_Report_${new Date().toISOString().split('T')[0]}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    // 4. Generate PDF, then cleanly restore the screen to normal
    html2pdf().set(opt).from(element).save().then(() => {
        document.body.setAttribute('data-theme', originalTheme);
        controlsDiv.style.display = 'block';
        btn.textContent = originalText;
        btn.disabled = false;
    }).catch(err => {
        alert("An error occurred generating the PDF: " + err.message);
        document.body.setAttribute('data-theme', originalTheme);
        controlsDiv.style.display = 'block';
        btn.textContent = originalText;
        btn.disabled = false;
    });
});