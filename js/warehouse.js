// ==========================================
// --- WAREHOUSE MANAGEMENT SYSTEM ---
// ==========================================
// This file is fully isolated from app.js using an anonymous function wrapper. 
// This prevents variable naming conflicts (like 'menuPage') with the main system.

(function() {

// --- WAREHOUSE: DATA PARSING UTILITY ---
    // Extracts a clean array of required parts from a raw database order row
    window.parseRequiredParts = function(orderData) {
        let requiredParts = [];
        
        for (let i = 1; i <= 5; i++) {
            let partName = (orderData[`part_${i}`] || '').trim();
            let qtyRaw = (orderData[`qty_${i}`] || '').trim();

            // Strict filter: Ignore completely blank fields or the word "EMPTY"
            if (partName && partName.toUpperCase() !== 'EMPTY') {
                
                // Convert quantity to a strict number, default to 1 if they left it blank
                let qty = parseInt(qtyRaw, 10);
                if (isNaN(qty) || qty <= 0) {
                    qty = 1; 
                }

                requiredParts.push({
                    part_name: partName,
                    required_qty: qty
                });
            }
        }
        
        return requiredParts;
    };

    // --- WAREHOUSE: SEARCH & RENDER LOGIC ---
    const whSearchInput = document.getElementById('whSearchInput');
    const btnWhSearch = document.getElementById('btnWhSearch');
    const btnWhViewAll = document.getElementById('btnWhViewAll');
    const whOrderContainer = document.getElementById('whOrderContainer');

    // Allow 'Enter' key to trigger the search
    if (whSearchInput) {
        whSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                btnWhSearch.click();
            }
        });
    }

    // 1. Single Order Search
    if (btnWhSearch) {
        btnWhSearch.addEventListener('click', async () => {
            const soNumber = whSearchInput.value.trim();
            if (!soNumber) {
                alert("Please enter or scan an SO number.");
                return;
            }

            if (typeof showGlobalLoader === 'function') showGlobalLoader("Locating Order & Checking Inventory...");

            const { data: orderData, error: orderErr } = await supabaseClient
                .from('orders')
                .select('*')
                .eq('so', soNumber)
                .single();

            if (orderErr || !orderData) {
                if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
                alert(`Order SO: ${soNumber} not found in the database.`);
                return;
            }

            const requiredParts = window.parseRequiredParts(orderData);
            const assignedTech = orderData.assigned_tech || 'Unassigned';
            let currentStock = [];
            
            if (assignedTech !== 'Unassigned') {
                const { data: stockData } = await supabaseClient
                    .from('inventory_current_stock_view')
                    .select('*')
                    .eq('so', soNumber)
                    .eq('tech_id', assignedTech);
                if (stockData) currentStock = stockData;
            }

            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

            whOrderContainer.style.display = 'flex';
            whOrderContainer.innerHTML = generateWarehouseTicketHTML(orderData, requiredParts, currentStock);
        });
    }

    // 2. View All Pending Parts
    if (btnWhViewAll) {
        btnWhViewAll.addEventListener('click', async () => {
            if (typeof showGlobalLoader === 'function') showGlobalLoader("Fetching all pending parts...");

            // Fetch all orders using your pagination engine
            const allData = await fetchAllRecords('orders');
            
            // Filter strictly to orders currently with a Technician
            const techOrders = allData.filter(o => o.status && o.status.toLowerCase() === 'technician');

            // Find only the orders that actually require parts
            const ordersWithParts = [];
            techOrders.forEach(order => {
                const reqParts = window.parseRequiredParts(order);
                if (reqParts.length > 0) ordersWithParts.push({ order, reqParts });
            });

            if (ordersWithParts.length === 0) {
                if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
                whOrderContainer.style.display = 'flex';
                whOrderContainer.innerHTML = `<div style="padding: 15px; background: var(--card-bg); border-radius: 8px; text-align: center; font-weight: bold;">No pending parts found for any active technicians. 🎉</div>`;
                return;
            }

            // Fetch the ENTIRE current stock view so we know who has what
            const { data: allStockData } = await supabaseClient.from('inventory_current_stock_view').select('*');
            const allStock = allStockData || [];

            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

            // Render all tickets in a massive scrollable list
            whOrderContainer.style.display = 'flex';
            let finalHtml = `<h3 style="color: #8e24aa; border-bottom: 2px solid var(--border-color); padding-bottom: 10px; margin-top: 0;">📦 Pending Parts for All Technicians (${ordersWithParts.length} Orders)</h3>`;

            ordersWithParts.forEach(item => {
                // Filter the stock just for this specific tech and order
                const techStock = allStock.filter(s => s.so === item.order.so && s.tech_id === item.order.assigned_tech);
                finalHtml += generateWarehouseTicketHTML(item.order, item.reqParts, techStock);
            });

            whOrderContainer.innerHTML = finalHtml;
        });
    }

    // --- WAREHOUSE: UI HTML GENERATOR ---
    function generateWarehouseTicketHTML(order, requiredParts, currentStock) {
        let html = `
            <div style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h3 style="margin-top: 0; color: #1976d2; border-bottom: 1px dashed var(--border-color); padding-bottom: 10px;">
                    Order Details - <a href="#" onclick="window.openWhViewModal('${order.so}'); return false;" style="color: #1976d2; text-decoration: underline;">SO: ${order.so}</a>
                </h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 14px; margin-bottom: 15px;">
                    <div><strong>Status:</strong> ${order.status || 'N/A'}</div>
                    <div><strong>Assigned Tech:</strong> <span style="color: #f57c00; font-weight: bold;">${order.assigned_tech || 'Unassigned'}</span></div>
                    <div><strong>Model:</strong> ${order.model || 'N/A'}</div>
                    <div><strong>Route:</strong> ${order.rout || 'N/A'}</div>
                </div>
                <h4 style="margin-bottom: 10px; margin-top: 0;">Required Parts</h4>
        `;

        if (requiredParts.length === 0) {
            html += `<div style="text-align: center; opacity: 0.8; padding: 10px;">No parts requested for this order.</div></div>`;
            return html;
        }

        requiredParts.forEach(part => {
            const stockRecord = currentStock.find(s => s.part_name === part.part_name);
            const heldQty = stockRecord ? stockRecord.qty_on_hand : 0;
            const reqQty = part.required_qty;

            let statusIndicator = '';
            if (heldQty === 0) {
                statusIndicator = `<span style="color: #d32f2f; font-weight: bold; background: rgba(211, 47, 47, 0.1); padding: 3px 8px; border-radius: 4px;">Not Issued (0 / ${reqQty})</span>`;
            } else if (heldQty < reqQty) {
                statusIndicator = `<span style="color: #fbc02d; font-weight: bold; background: rgba(251, 192, 45, 0.1); padding: 3px 8px; border-radius: 4px;">Partial (${heldQty} / ${reqQty})</span>`;
            } else {
                statusIndicator = `<span style="color: #2e7d32; font-weight: bold; background: rgba(46, 125, 50, 0.1); padding: 3px 8px; border-radius: 4px;">Fully Issued ✅ (${heldQty} / ${reqQty})</span>`;
            }

            html += `
                <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 4px; padding: 10px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 15px; color: #8e24aa;">⚙️ ${part.part_name}</strong>
                        ${statusIndicator}
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="primary-btn" onclick="window.handleWarehouseAction('${order.so}', '${order.assigned_tech}', '${part.part_name}', 'Issue', 'Good')" style="flex: 1; background: #1976d2; border:none; padding: 8px;">⬆️ Issue Part</button>
                        <button class="primary-btn" onclick="window.handleWarehouseAction('${order.so}', '${order.assigned_tech}', '${part.part_name}', 'Return', 'Good')" style="flex: 1; background: #2e7d32; border:none; padding: 8px;">⬇️ Return (Good)</button>
                        <button class="primary-btn" onclick="window.handleWarehouseAction('${order.so}', '${order.assigned_tech}', '${part.part_name}', 'Return', 'Defective')" style="flex: 1; background: #d32f2f; border:none; padding: 8px;">🗑️ Return (Defect)</button>
                    </div>
                </div>
            `;
        });

        html += `</div>`; 
        return html;
    }

    // --- WAREHOUSE: ORPHANED PARTS LOGIC ---
    const btnWhOrphaned = document.getElementById('btnWhOrphaned');
    if (btnWhOrphaned) {
        btnWhOrphaned.addEventListener('click', async () => {
            if (typeof showGlobalLoader === 'function') showGlobalLoader("Scanning for orphaned parts...");

            // 1. Fetch all stock and active orders
            const { data: allStockData } = await supabaseClient.from('inventory_current_stock_view').select('*');
            const allStock = allStockData || [];
            
            const allData = await fetchAllRecords('orders');
            const techOrders = allData.filter(o => o.status && o.status.toLowerCase() === 'technician');

            // 2. Map required parts per tech
            const reqMap = {};
            techOrders.forEach(order => {
                const tech = order.assigned_tech || 'Unassigned';
                if (!reqMap[tech]) reqMap[tech] = {};
                const parts = window.parseRequiredParts(order);
                parts.forEach(p => {
                    reqMap[tech][p.part_name] = (reqMap[tech][p.part_name] || 0) + p.required_qty;
                });
            });

            let orphanedHtml = `<h3 style="color: #d32f2f; border-bottom: 2px solid var(--border-color); padding-bottom: 10px; margin-top: 0;">⚠️ Orphaned Parts (Assigned but not needed)</h3>`;
            let orphanedByTech = {};
            let foundOrphan = false;

            // 3. Compare Stock vs Requirements
            allStock.forEach(stock => {
                const tech = stock.tech_id;
                const part = stock.part_name;
                const held = stock.qty_on_hand;
                const soContext = stock.so; // The order it was originally issued under
                const required = (reqMap[tech] && reqMap[tech][part]) ? reqMap[tech][part] : 0;

                if (held > required) {
                    foundOrphan = true;
                    if (!orphanedByTech[tech]) orphanedByTech[tech] = [];
                    orphanedByTech[tech].push({ part, excess: held - required, so: soContext });
                }
            });

            if (!foundOrphan) {
                whOrderContainer.innerHTML = `<div style="padding: 15px; background: var(--card-bg); border-radius: 8px; text-align: center; font-weight: bold;">No orphaned parts found! All inventory is accounted for. 🎉</div>`;
            } else {
                Object.keys(orphanedByTech).forEach(tech => {
                    orphanedHtml += `
                    <div style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                        <h4 style="margin-top: 0; color: #f57c00;">👤 Technician: ${tech}</h4>
                    `;
                    orphanedByTech[tech].forEach(orph => {
                        orphanedHtml += `
                        <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 4px; padding: 10px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong style="font-size: 15px; color: #8e24aa;">⚙️ ${orph.part}</strong><br>
                                    <span style="font-size: 12px; opacity: 0.8;">Issued for: <a href="#" onclick="window.openWhViewModal('${orph.so}'); return false;" style="color: #1976d2; text-decoration: underline;">SO: ${orph.so}</a></span>
                                </div>
                                <span style="color: #d32f2f; font-weight: bold; background: rgba(211, 47, 47, 0.1); padding: 3px 8px; border-radius: 4px;">Excess: ${orph.excess}</span>
                            </div>
                            <div style="display: flex; gap: 10px;">
                                <button class="primary-btn" onclick="window.handleWarehouseAction('${orph.so}', '${tech}', '${orph.part}', 'Return', 'Good')" style="flex: 1; background: #2e7d32; border:none; padding: 8px;">⬇️ Return (Good)</button>
                                <button class="primary-btn" onclick="window.handleWarehouseAction('${orph.so}', '${tech}', '${orph.part}', 'Return', 'Defective')" style="flex: 1; background: #d32f2f; border:none; padding: 8px;">🗑️ Return (Defect)</button>
                            </div>
                        </div>
                        `;
                    });
                    orphanedHtml += `</div>`;
                });
                whOrderContainer.innerHTML = orphanedHtml;
            }
            
            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
            whOrderContainer.style.display = 'flex';
        });
    }

    // --- WAREHOUSE: CLICKABLE MODAL HELPER ---
    window.openWhViewModal = async function(soNumber) {
        if (typeof showGlobalLoader === 'function') showGlobalLoader("Loading ticket...");
        const { data: orderData } = await supabaseClient.from('orders').select('*').eq('so', soNumber).single();
        if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
        
        if (orderData && typeof openViewOnlyModal === 'function') {
            openViewOnlyModal(orderData);
        } else {
            alert("Could not load ticket details from database.");
        }
    };

    // --- WAREHOUSE: DATABASE TRANSACTION LOGIC ---
    window.handleWarehouseAction = async function(so, techId, partName, direction, condition) {
        if (techId === 'Unassigned' || techId === '') {
            alert("Action Blocked: You cannot issue or return parts on an order that is not assigned to a technician.");
            return;
        }

        // 1. Setup and show our new custom modal
        const modal = document.getElementById('whActionModal');
        document.getElementById('whActionTitle').innerText = `${direction} Part`;
        document.getElementById('whActionSubtitle').innerText = `Part: ${partName} | Condition: ${condition}`;
        document.getElementById('whActionQty').value = "1"; // Reset to default 1
        document.getElementById('whActionComment').value = ""; // Clear old comments
        
        // Display the modal
        modal.style.display = 'flex';

        // 2. Overwrite the Confirm button's click event specifically for this action
        const confirmBtn = document.getElementById('whActionConfirmBtn');
        confirmBtn.onclick = async function() {
            // Get values from the modal
            const qtyVal = document.getElementById('whActionQty').value;
            const commentVal = document.getElementById('whActionComment').value;
            
            const qty = parseInt(qtyVal, 10);
            if (isNaN(qty) || qty <= 0) {
                alert("Action Blocked: Please enter a valid quantity greater than 0.");
                return; // Stop if quantity is invalid, but keep modal open
            }
            
            const comment = commentVal.trim();

            // Close the modal since inputs are valid
            modal.style.display = 'none';

            if (typeof showGlobalLoader === 'function') showGlobalLoader("Processing Transaction...");

            // Make sure part exists in catalog
            await supabaseClient.from('inventory_catalog').upsert(
                { part_name: partName }, 
                { onConflict: 'part_name', ignoreDuplicates: true }
            );

            // Log the transaction
            const { error: logErr } = await supabaseClient.from('inventory_log').insert({
                part_name: partName,
                so: so,
                tech_id: techId,
                qty: qty,
                direction: direction,
                condition: condition,
                comment: comment
            });

            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

            if (logErr) {
                alert("Transaction Failed: " + logErr.message);
            } else {
                // Refresh the view seamlessly based on where the user currently is
                const searchInput = document.getElementById('whSearchInput');
                if (searchInput && searchInput.value.trim() === String(so)) {
                    document.getElementById('btnWhSearch').click();
                } else if (document.getElementById('whOrderContainer').innerHTML.includes('Orphaned Parts')) {
                    document.getElementById('btnWhOrphaned').click(); 
                } else {
                    document.getElementById('btnWhViewAll').click();
                }
            }
        };
    };


    const btnWarehouse = document.getElementById('btnWarehouse');
    const warehousePage = document.getElementById('warehousePage');
    const warehouseHubBtn = document.getElementById('warehouseHubBtn');
    const localMenuPage = document.getElementById('menuPage');

    // 1. Listen for clicks on the new Big Button
    if (btnWarehouse) {
        btnWarehouse.addEventListener('click', (e) => {
            e.preventDefault(); // Stops the page from jumping to the top
            
            // Turn off any page that is currently visible
            document.querySelectorAll('.page.active').forEach(page => {
                page.classList.remove('active');
            });
            
            // Turn on the Warehouse page
            if (warehousePage) {
                warehousePage.classList.add('active');
            }
        });
    }

    // 2. Listen for clicks on the Back Button inside the Warehouse
    if (warehouseHubBtn) {
        warehouseHubBtn.addEventListener('click', () => {
            //Clean up the UI when leaving
            const whSearchInput = document.getElementById('whSearchInput');
            const whOrderContainer = document.getElementById('whOrderContainer');
            if (whSearchInput) whSearchInput.value = '';
            if (whOrderContainer) {
                whOrderContainer.innerHTML = '';
                whOrderContainer.style.display = 'none';
            }

            // Clean up reports view
            document.getElementById('whReportsContainer').style.display = 'none';
            document.getElementById('whReportResults').innerHTML = '';

            // Navigate back to HUB
            if (warehousePage) warehousePage.classList.remove('active');
            if (localMenuPage) localMenuPage.classList.add('active');
        });
    }

    // --- WAREHOUSE: REPORTING & DASHBOARD ---
    const btnWhReports = document.getElementById('btnWhReports');
    const whReportsContainer = document.getElementById('whReportsContainer');
    const btnFetchWhReport = document.getElementById('btnFetchWhReport');
    const btnExportWhExcel = document.getElementById('btnExportWhExcel');
    const whReportResults = document.getElementById('whReportResults');
    let warehouseReportData = [];

    if (btnWhReports) {
        btnWhReports.addEventListener('click', () => {
            document.getElementById('whOrderContainer').style.display = 'none';
            whReportsContainer.style.display = 'flex';
            
            // Set default dates to current month
            const now = new Date();
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            const formatHtmlDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            
            document.getElementById('whReportStart').value = formatHtmlDate(firstDay);
            document.getElementById('whReportEnd').value = formatHtmlDate(now);
        });
    }

    if (btnFetchWhReport) {
        btnFetchWhReport.addEventListener('click', async () => {
            const startStr = document.getElementById('whReportStart').value;
            const endStr = document.getElementById('whReportEnd').value;
            
            if (!startStr || !endStr) return alert("Please select both dates.");
            
            if (typeof showGlobalLoader === 'function') showGlobalLoader("Fetching Warehouse Ledger...");

            // Fetch logs using the pagination engine
            const allLogs = await fetchAllRecords('inventory_log');
            
            // Filter by date
            const startLimit = new Date(startStr);
            startLimit.setHours(0,0,0,0);
            const endLimit = new Date(endStr);
            endLimit.setHours(23,59,59,999);

            warehouseReportData = allLogs.filter(log => {
                const logDate = new Date(log.created_at);
                return logDate >= startLimit && logDate <= endLimit;
            });

            // Sort newest first
            warehouseReportData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

            if (warehouseReportData.length === 0) {
                whReportResults.innerHTML = '<p style="text-align: center; opacity: 0.8;">No transactions found in this date range.</p>';
                btnExportWhExcel.style.display = 'none';
            } else {
                // Build visual table preview
                let html = `
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                        <thead>
                            <tr style="border-bottom: 2px solid var(--border-color);">
                                <th style="padding: 8px;">Date</th><th>SO</th><th>Tech</th><th>Part</th><th>Qty</th><th>Action</th><th>Comment</th>
                            </tr>
                            <tr style="border-bottom: 2px solid var(--border-color); background: rgba(0,0,0,0.05);">
                                ${[0,1,2,3,4,5,6].map(i => `<td style="padding: 4px;"><input type="text" data-col="${i}" class="wh-filter" placeholder="..." style="width: 100%; padding: 4px; box-sizing: border-box; font-size: 11px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); border-radius: 3px;"></td>`).join('')}
                            </tr>
                        </thead>
                        <tbody id="whReportTbody">
                `;
                warehouseReportData.forEach(log => {
                    const d = new Date(log.created_at);
                    html += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 8px;">${d.toLocaleDateString()}</td>
                            <td>${log.so || ''}</td>
                            <td>${log.tech_id || ''}</td>
                            <td>${log.part_name || ''}</td>
                            <td>${log.qty || 0}</td>
                            <td><span style="color: ${log.direction === 'Issue' ? '#1976d2' : '#2e7d32'}; font-weight: bold;">${log.direction}</span> ${log.condition ? '('+log.condition+')' : ''}</td>
                            <td>${log.comment || ''}</td>
                        </tr>
                    `;
                });
                html += `</tbody></table>`;
                whReportResults.innerHTML = html;
                
                // Attach live inline filter logic
                whReportResults.querySelectorAll('.wh-filter').forEach(inp => {
                    inp.addEventListener('input', () => {
                        const rows = document.getElementById('whReportTbody').querySelectorAll('tr');
                        const filters = Array.from(whReportResults.querySelectorAll('.wh-filter'));
                        rows.forEach(row => {
                            const isMatch = filters.every(f => !f.value || row.cells[f.dataset.col].textContent.toLowerCase().includes(f.value.toLowerCase()));
                            row.style.display = isMatch ? '' : 'none';
                        });
                    });
                });

                btnExportWhExcel.style.display = 'inline-block';
            }
            whReportResults.style.display = 'block';
        });
    }


    // Export Dual-Sheet Excel (SheetJS)
    if (btnExportWhExcel) {
        btnExportWhExcel.addEventListener('click', () => {
            if (warehouseReportData.length === 0) return;
            if (typeof showGlobalLoader === 'function') showGlobalLoader("Generating Excel...");

            try {
                // Sheet 1: Master Ledger
                const masterLedger = warehouseReportData.map(log => ({
                    "Date & Time": new Date(log.created_at).toLocaleString(),
                    "SO Number": log.so,
                    "Technician": log.tech_id,
                    "Part Name": log.part_name,
                    "Quantity": log.qty,
                    "Direction": log.direction,
                    "Condition": log.condition || 'N/A',
                    "Comment": log.comment || ''
                }));

                // Sheet 2: Waste Metrics ("Tech Damage")
                const defectLogs = warehouseReportData.filter(log => log.condition === 'Defective');
                const wasteMap = {};
                
                defectLogs.forEach(log => {
                    const tech = log.tech_id;
                    if (!wasteMap[tech]) wasteMap[tech] = { "Technician": tech, "Total Defective Parts": 0, "Details": [] };
                    wasteMap[tech]["Total Defective Parts"] += log.qty;
                    wasteMap[tech]["Details"].push(`${log.qty}x ${log.part_name} (${log.so})`);
                });

                const techDamageSheet = Object.values(wasteMap).map(w => ({
                    "Technician": w["Technician"],
                    "Total Defective Parts": w["Total Defective Parts"],
                    "Item Breakdown": w["Details"].join(" | ")
                }));

                const wb = XLSX.utils.book_new();
                
                const wsMaster = XLSX.utils.json_to_sheet(masterLedger);
                XLSX.utils.book_append_sheet(wb, wsMaster, "Master Ledger");
                
                const wsDamage = XLSX.utils.json_to_sheet(techDamageSheet.length ? techDamageSheet : [{"Message": "No defective parts returned"}]);
                XLSX.utils.book_append_sheet(wb, wsDamage, "Tech Damage");

                XLSX.writeFile(wb, `Warehouse_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
            } catch (err) {
                alert("Export Failed: " + err.message);
            }
            
            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
        });
    }


    //all codes and functions regarding the warehouse.js must be before the closing of the modular pattern )(); to prevent this file from making functions with the same name as the app.js which is the main .js 
})();