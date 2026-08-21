// ==========================================
// --- MY TEAM DASHBOARD MODULE ---
// ==========================================

(function() {
    const btnMyTeam = document.getElementById('btnMyTeam');
    const myTeamPage = document.getElementById('myTeamPage');
    const myTeamHubBtn = document.getElementById('myTeamHubBtn');
    const btnFetchMyTeam = document.getElementById('btnFetchMyTeam');
    const myTeamSupervisorSelect = document.getElementById('myTeamSupervisorSelect');
    const menuPage = document.getElementById('menuPage');

    if (!btnMyTeam) return;

    // Standardize HTML date formats
    const formatInputDate = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    // Navigation and Init
    btnMyTeam.addEventListener('click', async () => {
        document.querySelectorAll('.page.active').forEach(p => p.classList.remove('active'));
        myTeamPage.classList.add('active');

        // Set Default Dates to current month
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        document.getElementById('myTeamStartDate').value = formatInputDate(firstDay);
        document.getElementById('myTeamEndDate').value = formatInputDate(now);

        // Manager specific UI setup
        const isManager = currentUser.role.toLowerCase().includes('manager') || currentUser.role.toLowerCase().includes('admin');
        if (isManager) {
            document.getElementById('myTeamManagerSelectContainer').style.display = 'flex';
            if (myTeamSupervisorSelect.children.length <= 1) {
                const { data } = await supabaseClient.from('profiles').select('username').ilike('role', '%supervisor%').order('username');
                if (data) {
                    data.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s.username;
                        opt.textContent = s.username;
                        myTeamSupervisorSelect.appendChild(opt);
                    });
                }
            }
        }
    });

    myTeamHubBtn.addEventListener('click', () => {
        myTeamPage.classList.remove('active');
        menuPage.classList.add('active');
    });

    // Core Fetch Engine
    btnFetchMyTeam.addEventListener('click', async () => {
        const isManager = currentUser.role.toLowerCase().includes('manager') || currentUser.role.toLowerCase().includes('admin');
        let targetSupervisor = currentUser.username;

        if (isManager) {
            targetSupervisor = myTeamSupervisorSelect.value;
            if (!targetSupervisor) return alert("Please select a supervisor from the dropdown.");
        }

        const startStr = document.getElementById('myTeamStartDate').value;
        const endStr = document.getElementById('myTeamEndDate').value;

        if (!startStr || !endStr) {
            return alert("Please ensure both Start and End dates are selected.");
        }

        showGlobalLoader("Gathering Team Metrics...");

        // 1. Compile the team list
        const { data: teamData } = await supabaseClient.from('profiles').select('username').eq('supervisor_name', targetSupervisor);
        let teamList = [targetSupervisor]; // Inherently add the supervisor to their own pool
        if (teamData) {
            teamData.forEach(t => teamList.push(t.username));
        }

        let expandedTeamList = [];
        teamList.forEach(t => {
            expandedTeamList.push(t);
            expandedTeamList.push(t.toLowerCase());
            expandedTeamList.push(t.toUpperCase());
            expandedTeamList.push(t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
        });

        // Generate the exact DD-MM-YYYY dates required to pull the ledger from repair_log
        let dateStringsToFetch = [];
        let currentDay = new Date(`${startStr}T00:00:00`);
        const endLimit = new Date(`${endStr}T23:59:59`);
        
        while (currentDay <= endLimit) {
            const dd = String(currentDay.getDate()).padStart(2, '0');
            const mm = String(currentDay.getMonth() + 1).padStart(2, '0');
            const yyyy = currentDay.getFullYear();
            dateStringsToFetch.push(`${dd}-${mm}-${yyyy}`);
            currentDay.setDate(currentDay.getDate() + 1);
        }

        // 2. Fetch Live Workload (Orders) - Live Snapshot for "Pending"
        let orders = await fetchAllRecords('orders', 'assigned_tech', expandedTeamList);
        orders = orders.filter(o => {
            const currentStatus = String(o.status || '').trim().toLowerCase();
            return (currentStatus === 'technician' || currentStatus === 'tracking' || currentStatus === 'pending'); 
        });

        // 3. Fetch Time-Bound Ledger (Repair Logs) for "Total Assigned" & "Completed"
        let repairLogs = await fetchAllRecords('repair_log', 'assign_date', dateStringsToFetch);
        repairLogs = repairLogs.filter(log => {
            const aTech = String(log.assigned_tech || '').trim().toLowerCase();
            const eTech = String(log.end_tech || '').trim().toLowerCase();
            const actBy = String(log.assigned_by || '').trim().toLowerCase();
            return teamList.some(t => {
                const s = t.toLowerCase();
                return s === aTech || s === eTech || s === actBy;
            });
        });

        // 4. Fetch Stock (Live view)
        const stock = await fetchAllRecords('inventory_current_stock_view', 'tech_id', expandedTeamList);

        // 5. Fetch Inventory Logs (Timestamp filtered)
        let logs = await fetchAllRecords('inventory_log', 'tech_id', expandedTeamList);
        logs = logs.filter(l => {
            const logDate = new Date(l.created_at);
            return logDate >= new Date(`${startStr}T00:00:00`) && logDate <= endLimit;
        });

        hideGlobalLoader();

        renderWorkload(teamList, orders, repairLogs);
        renderStock(stock);
        renderLogs(logs);
    });

    // --- ISOLATED MODAL LOGIC ---
    const myTeamDetailsModal = document.getElementById('myTeamDetailsModal');
    document.getElementById('closeMyTeamModalBtn').addEventListener('click', () => {
        myTeamDetailsModal.style.display = 'none';
    });

    window.openMyTeamMetric = function(tech, type) {
        const listContainer = document.getElementById('myTeamModalList');
        listContainer.innerHTML = '';
        document.getElementById('myTeamModalTitle').textContent = `Details: ${type.toUpperCase()}`;
        document.getElementById('myTeamModalSubtitle').textContent = `Records for ${tech}`;
        
        let targetData = [];
        
        if (type === 'assigned') {
            targetData = globalMyTeamLogs.filter(l => String(l.assigned_tech || '').trim().toLowerCase() === tech.toLowerCase());
            const uniqueSOs = new Set();
            targetData.forEach(l => {
                if (!uniqueSOs.has(l.so)) {
                    uniqueSOs.add(l.so);
                    listContainer.innerHTML += `
                        <div style="background: var(--card-bg); padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='#1976d2'" onmouseout="this.style.borderColor='var(--border-color)'" onclick="searchAndOpenOrder('${l.so}')">
                            <strong style="color: #1976d2;">SO: ${l.so}</strong><br>
                            <span style="font-size: 11px;">Assigned on: ${l.assign_date} at ${l.assign_time}</span>
                        </div>`;
                }
            });
        } else if (type === 'acted') {
            targetData = globalMyTeamLogs.filter(l => String(l.assigned_by || '').trim().toLowerCase() === tech.toLowerCase());
            const uniqueSOs = new Set();
            targetData.forEach(l => {
                if (!uniqueSOs.has(l.so)) {
                    uniqueSOs.add(l.so);
                    listContainer.innerHTML += `
                        <div style="background: var(--card-bg); padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='#2e7d32'" onmouseout="this.style.borderColor='var(--border-color)'" onclick="searchAndOpenOrder('${l.so}')">
                            <strong style="color: #2e7d32;">SO: ${l.so}</strong><br>
                            <span style="font-size: 11px;">Action Submitted: ${l.assign_date} at ${l.assign_time} | Status: ${l.status || 'N/A'}</span>
                        </div>`;
                }
            });
        } else if (type === 'pending') {
            const assigned = globalMyTeamLogs.filter(l => String(l.assigned_tech || '').trim().toLowerCase() === tech.toLowerCase());
            const acted = globalMyTeamLogs.filter(l => String(l.assigned_by || '').trim().toLowerCase() === tech.toLowerCase());
            const actedSOs = new Set(acted.map(l => l.so));
            
            const uniquePending = new Set();
            assigned.forEach(l => {
                if (!actedSOs.has(l.so) && !uniquePending.has(l.so)) {
                    uniquePending.add(l.so);
                    listContainer.innerHTML += `
                        <div style="background: var(--card-bg); padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='#d32f2f'" onmouseout="this.style.borderColor='var(--border-color)'" onclick="searchAndOpenOrder('${l.so}')">
                            <strong style="color: #d32f2f;">SO: ${l.so}</strong><br>
                            <span style="font-size: 11px;">Assigned on: ${l.assign_date}. No action submitted yet.</span>
                        </div>`;
                }
            });
        } else if (type === 'finished') {
            targetData = globalMyTeamLogs.filter(l => String(l.end_tech || '').trim().toLowerCase() === tech.toLowerCase());
            targetData.forEach(l => {
                listContainer.innerHTML += `
                    <div style="background: var(--card-bg); padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='#1976d2'" onmouseout="this.style.borderColor='var(--border-color)'" onclick="searchAndOpenOrder('${l.so}')">
                        <strong style="color: #1976d2;">SO: ${l.so}</strong><br>
                        <span style="font-size: 11px;">Completed/Finished on: ${l.assign_date} at ${l.assign_time}</span>
                    </div>`;
            });
        }

        else if (type === 'collected') {
            // Filter where the technician acted on the ticket and the collected amount is greater than 0
            targetData = globalMyTeamLogs.filter(l => String(l.assigned_by || '').trim().toLowerCase() === tech.toLowerCase() && Number(l.collected) > 0);
            const uniqueSOs = new Set();
            targetData.forEach(l => {
                if (!uniqueSOs.has(l.so)) {
                    uniqueSOs.add(l.so);
                    listContainer.innerHTML += `
                        <div style="background: var(--card-bg); padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='#fbc02d'" onmouseout="this.style.borderColor='var(--border-color)'" onclick="searchAndOpenOrder('${l.so}')">
                            <strong style="color: #fbc02d;">SO: ${l.so}</strong><br>
                            <span style="font-size: 11px;">Collection Date: ${l.assign_date} at ${l.assign_time} | Amount: ${l.collected}</span>
                        </div>`;
                }
            });
        }

        if (listContainer.innerHTML === '') {
            listContainer.innerHTML = '<span style="opacity: 0.7;">No records found.</span>';
        }
        myTeamDetailsModal.style.display = 'flex';
    };

    window.searchAndOpenOrder = async function(so) {
        document.getElementById('detailsModal').style.zIndex = '1200'; 
        showGlobalLoader("Locating Order...");
        const { data } = await supabaseClient.from('orders').select('*').eq('so', so).single();
        hideGlobalLoader();
        if (data && typeof openViewOnlyModal === 'function') {
            openViewOnlyModal(data);
        } else {
            alert("Could not load order details.");
        }
    };

    let globalMyTeamOrders = [];
    let globalMyTeamLogs = [];

    // Render Engines
    function renderWorkload(teamList, orders, repairLogs) {
        globalMyTeamOrders = orders;
        globalMyTeamLogs = repairLogs;
        
        const tbody = document.getElementById('myTeamWorkloadBody');
        tbody.innerHTML = '';
        
        teamList.sort().forEach(tech => {
            const safeTech = tech.toLowerCase();
            
            let assignedSOs = new Set();
            let actedSOs = new Set();
            let finishedCount = 0;
            let collectedSum = 0;

            // Strict time-bound ledger analysis
            repairLogs.forEach(log => {
                const so = log.so;
                if (String(log.assigned_tech || '').trim().toLowerCase() === safeTech) assignedSOs.add(so);
                if (String(log.assigned_by || '').trim().toLowerCase() === safeTech) {
                    actedSOs.add(so);
                    collectedSum += (Number(log.collected) || 0);
                }
                if (String(log.end_tech || '').trim().toLowerCase() === safeTech) finishedCount++;
            });

            // Mathematical reduction for Left Out (Pending)
            let overlapCount = 0;
            assignedSOs.forEach(so => { if (actedSOs.has(so)) overlapCount++; });
            const pendingCount = assignedSOs.size - overlapCount;

            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="font-weight: bold; padding: 10px;">${tech}</td>
                    <td style="padding: 10px; text-align: center;">
                        <span class="metric-clickable" style="color: var(--text-color); cursor: pointer; font-weight: bold;" onclick="openMyTeamMetric('${tech}', 'assigned')">${assignedSOs.size}</span>
                    </td>
                    <td style="padding: 10px; text-align: center;">
                        <span class="metric-clickable" style="color: #2e7d32; cursor: pointer; font-weight: bold;" onclick="openMyTeamMetric('${tech}', 'acted')">${actedSOs.size}</span>
                    </td>
                    <td style="padding: 10px; text-align: center;">
                        <span class="metric-clickable" style="color: #d32f2f; cursor: pointer; font-weight: bold;" onclick="openMyTeamMetric('${tech}', 'pending')">${pendingCount}</span>
                    </td>
                    <td style="padding: 10px; text-align: center;">
                        <span class="metric-clickable" style="color: #1976d2; cursor: pointer; font-weight: bold;" onclick="openMyTeamMetric('${tech}', 'finished')">${finishedCount}</span>
                    </td>
                    <td style="padding: 10px; text-align: center;">
                        <span class="metric-clickable" style="color: #fbc02d; cursor: pointer; font-weight: bold;" onclick="openMyTeamMetric('${tech}', 'collected')">${collectedSum}</span>
                    </td>
                </tr>
            `;
        });
    }

    function renderStock(stock) {
        const tbody = document.getElementById('myTeamStockBody');
        tbody.innerHTML = '';
        
        if (stock.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; opacity: 0.7; padding: 10px;">No active stock found for this team.</td></tr>';
            return;
        }

        stock.sort((a, b) => a.tech_id.localeCompare(b.tech_id)).forEach(s => {
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="font-weight: bold; padding: 8px;">${s.tech_id || ''}</td>
                    <td style="padding: 8px;">${s.so || ''}</td>
                    <td style="padding: 8px;">${s.part_name || ''}</td>
                    <td style="color: #1976d2; font-weight: bold; padding: 8px; text-align: center;">${s.qty_on_hand || 0}</td>
                </tr>
            `;
        });
    }

    function renderLogs(logs) {
        const tbody = document.getElementById('myTeamLogsBody');
        tbody.innerHTML = '';
        
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; opacity: 0.7; padding: 10px;">No inventory logs found for the selected dates.</td></tr>';
            return;
        }

        logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).forEach(l => {
            const cleanDate = new Date(l.created_at).toLocaleDateString() + ' ' + new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dirColor = l.direction === 'IN' ? '#2e7d32' : '#d32f2f';
            
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="font-size: 11px; padding: 8px;">${cleanDate}</td>
                    <td style="font-weight: bold; padding: 8px;">${l.tech_id || ''}</td>
                    <td style="padding: 8px;">${l.so || ''}</td>
                    <td style="padding: 8px;">${l.part_name || ''}</td>
                    <td style="font-weight: bold; padding: 8px; text-align: center;">${l.qty || 0}</td>
                    <td style="color: ${dirColor}; font-weight: bold; padding: 8px; text-align: center;">${l.direction || ''}</td>
                    <td style="font-size: 11px; padding: 8px;">${l.comment || ''}</td>
                </tr>
            `;
        });
    }
})();