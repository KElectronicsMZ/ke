// ==========================================
// --- CALL CENTER MANAGEMENT MODULE ---
// ==========================================
// Isolated modular pattern to prevent variable conflicts with app.js

(function() {
    const btnCallCenter = document.getElementById('btnCallCenter');
    const callCenterPage = document.getElementById('callCenterPage');
    const ccHubBtn = document.getElementById('ccHubBtn');
    const menuPage = document.getElementById('menuPage');
    const ccTicketContainer = document.getElementById('ccTicketContainer');

    // --- MEMORY VARIABLES FOR FILTER ENGINE ---
    let ccOriginalFollowUps = [];
    let ccOriginalOrdersData = [];
    let ccOriginalLogs = [];

    // --- NAVIGATION LOGIC ---
    if (btnCallCenter) {
        btnCallCenter.addEventListener('click', () => {
            console.log("PING! The Call Center button was clicked!");
            // Hide all active pages
            document.querySelectorAll('.page.active').forEach(page => {
                page.classList.remove('active');
            });
            // Show Call Center Page and Load Data
            if (callCenterPage) {
                callCenterPage.classList.add('active');
                loadCallCenterTickets();
            }
        });
    }

    if (ccHubBtn) {
        ccHubBtn.addEventListener('click', () => {
            if (callCenterPage) callCenterPage.classList.remove('active');
            if (menuPage) menuPage.classList.add('active');
        });
    }

    // --- FETCH PENDING QUEUE ---
    async function loadCallCenterTickets() {
        if (typeof showGlobalLoader === 'function') showGlobalLoader("Loading Call Center Queue...");
        ccTicketContainer.innerHTML = '';

        // 1. Fetch only pending follow-ups from the table
        const { data: followUps, error: fuErr } = await supabaseClient
            .from('follow_up')
            .select('*')
            .eq('call_status', 'pending');

        if (fuErr) {
            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
            alert("Error loading queue: " + fuErr.message);
            return;
        }

        if (!followUps || followUps.length === 0) {
            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
            ccTicketContainer.innerHTML = "<h3 style='text-align:center;'>No pending calls in the queue! 🎉</h3>";
            
            const badge = document.getElementById('ccQueueCountBadge');
            if (badge) badge.style.display = 'none';
            
            return;
        }

        // 2. Fetch the base order details for the SOs in the queue
        const soList = followUps.map(f => f.so);
        const { data: ordersData, error: ordErr } = await supabaseClient
            .from('orders')
            .select('*')
            .in('so', soList);

        // --- NEW: Fetch logs once here to prevent server spam during live filtering ---
        const { data: logsData } = await supabaseClient
            .from('repair_log')
            .select('so, comment, assigned_by')
            .in('so', soList)
            .neq('comment', '');

        if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

        if (ordErr) {
            alert("Error loading order details: " + ordErr.message);
            return;
        }

        // --- NEW: Save data to memory for the filter engine ---
        ccOriginalFollowUps = followUps;
        ccOriginalOrdersData = ordersData || [];
        ccOriginalLogs = logsData || [];

        buildCCFilterTable(); // Build the search boxes
        renderCCTickets(ccOriginalFollowUps, ccOriginalOrdersData, ccOriginalLogs);
        
        // Update and show the badge
        const badge = document.getElementById('ccQueueCountBadge');
        if (badge) {
            badge.textContent = followUps.length;
            badge.style.display = 'inline-block';
        }
    }

    
    // --- RENDER DYNAMIC TICKETS ---
    // Accepts logs as a parameter and clears the container
    async function renderCCTickets(followUps, ordersData, logs = ccOriginalLogs) {
        ccTicketContainer.innerHTML = ''; // Wipe old tickets before drawing new ones

        followUps.forEach(fu => {
            const order = ordersData.find(o => String(o.so) === String(fu.so)) || {};
            
            // Find the latest comment for this SO using the passed logs
            const orderLogs = (logs || []).filter(l => String(l.so) === String(fu.so));
            const latestLog = orderLogs.length > 0 ? orderLogs[orderLogs.length - 1] : null;
            const techCommentHtml = latestLog ? `<div style="background: rgba(25, 118, 210, 0.1); padding: 8px; border-left: 3px solid #1976d2; margin-top: 8px; font-size: 13px;"><strong>Tech Comment (${latestLog.assigned_by}):</strong> ${latestLog.comment}</div>` : '';

            const card = document.createElement('div');
            card.className = 'ticket-card';
            card.style.borderColor = '#ffb300'; 
            card.style.borderWidth = '2px';

            const safePhone1 = order.phone ? String(order.phone).replace(/\s+/g, '') : '';
            const safePhone2 = order.phone_2 ? String(order.phone_2).replace(/\s+/g, '') : '';
            const p1 = order.phone ? `<a class="phone-link" href="tel:${safePhone1}">📞 ${order.phone}</a>` : 'N/A';
            const p2 = order.phone_2 ? `<a class="phone-link" href="tel:${safePhone2}">📞 ${order.phone_2}</a>` : 'N/A';

            // Build Parts Array
            let partsArray = [];
            for (let i = 1; i <= 5; i++) {
                let part = (order[`part_${i}`] || '').trim();
                let qty = (order[`qty_${i}`] || '').trim();
                if (part && part.toUpperCase() !== 'EMPTY') {
                    partsArray.push(`${part} (x${qty && qty.toUpperCase() !== 'EMPTY' ? qty : '1'})`);
                }
            }
            let partsHtml = partsArray.length > 0 ? `<div style="color: #8e24aa; font-size: 13px; font-weight: bold; margin-top: 8px;">🛠️ Parts: ${partsArray.join(', ')}</div>` : '';

            const baseInfoHTML = `
                <div class="ticket-header" style="background: rgba(255, 179, 0, 0.1); padding: 10px; margin: -15px -15px 15px -15px; border-bottom: 2px solid #ffb300; border-radius: 8px 8px 0 0;">
                    <span><strong style="color: #ffb300; font-size: 16px;">[Call Center]</strong> SO: <span style="font-size: 16px;">${fu.so}</span></span>
                    <span style="color:#ffb300; font-size: 13px; font-weight: bold;">Type: ${fu.call_type}</span>
                </div>
                <div class="ticket-row"><span><strong>Name:</strong> ${order.name || 'N/A'}</span> <span>${p1}</span></div>
                <div class="ticket-row"><span><strong>Date:</strong> ${order.date || 'N/A'}</span> <span>${p2}</span></div>
                <div class="ticket-row" style="margin-top: 5px;"><strong>Address:</strong> ${order.address || 'N/A'}</div>
                <div class="ticket-row"><span><strong>Model:</strong> ${order.model || 'N/A'}</span> <span><strong>SN:</strong> ${order.serial || 'N/A'}</span></div>
                <hr style="border-color: var(--border-color); margin: 8px 0;">
                <div style="font-size: 13px; margin-bottom: 4px;"><strong>Remark:</strong> ${order.remark || 'N/A'}</div>
                <div style="font-size: 13px; margin-bottom: 4px;"><strong>Status Comment:</strong> ${order.status_comment || 'N/A'}</div>
                <div style="font-size: 13px; margin-bottom: 4px;"><strong>Route:</strong> ${order.rout || 'N/A'} | <strong>I/O:</strong> ${order.io || 'N/A'}</div>
                <div style="font-size: 13px;"><strong>Assigned Tech:</strong> <span style="color: #1976d2; font-weight: bold;">${order.assigned_tech || 'N/A'}</span></div>
                ${partsHtml}
                ${techCommentHtml}
                <hr style="border-color: var(--border-color); margin: 15px 0;">
            `;

        
            // 2. Build Dynamic Form Based on Call Type
            let formHTML = '';
            
            if (fu.call_type === 'new_order') {
                formHTML = `
                    <div style="direction: rtl; text-align: right; margin-bottom: 15px;">
                        <p style="color: #ffb300; font-weight: bold; font-size: 16px; margin-top: 0;">برجاء التواصل مع العميل لابلاغه ما اذا كان متواجد او يرغب فى تغيير المعاد</p>
                        <label style="display:block; margin-bottom:5px; font-weight:bold; font-size: 14px;">التعليق (Comment):</label>
                        <textarea class="cc-comment" rows="3" style="width: 100%; box-sizing: border-box; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); font-size: 14px;"></textarea>
                    </div>
                `;
            } else if (fu.call_type === 'qa_complete') {
                formHTML = `
                    <div style="direction: rtl; text-align: right; margin-bottom: 15px; font-size: 14px;">
                        <p style="color: #ffb300; font-weight: bold; font-size: 16px; margin-top: 0; text-align: center;">مراجعة جودة الخدمة (QA)</p>
                        
                        <div style="margin-bottom: 10px; display:flex; justify-content: space-between; align-items:center; background: var(--bg-color); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                            <label style="font-weight:bold;">هل الصيانة تمت بشكل جيد ؟</label>
                            <select class="cc-qa-good" style="padding: 5px; border-radius: 4px; background: var(--card-bg); color: var(--text-color); border: 1px solid var(--border-color); width: 80px;">
                                <option value="">--</option><option value="Yes">نعم (Y)</option><option value="No">لا (N)</option>
                            </select>
                        </div>

                        <div style="margin-bottom: 10px; display:flex; justify-content: space-between; align-items:center; background: var(--bg-color); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                            <label style="font-weight:bold;">هل الفنى ترك المكان نظيف بعد الصيانة؟</label>
                            <select class="cc-qa-clean" style="padding: 5px; border-radius: 4px; background: var(--card-bg); color: var(--text-color); border: 1px solid var(--border-color); width: 80px;">
                                <option value="">--</option><option value="Yes">نعم (Y)</option><option value="No">لا (N)</option>
                            </select>
                        </div>

                        <div style="margin-bottom: 10px; display:flex; justify-content: space-between; align-items:center; background: var(--bg-color); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                            <label style="font-weight:bold;">هل الفنى كان يرتدى الزى الرسمى ؟</label>
                            <select class="cc-qa-uniform" style="padding: 5px; border-radius: 4px; background: var(--card-bg); color: var(--text-color); border: 1px solid var(--border-color); width: 80px;">
                                <option value="">--</option><option value="Yes">نعم (Y)</option><option value="No">لا (N)</option>
                            </select>
                        </div>

                        <div style="margin-bottom: 10px; display:flex; justify-content: space-between; align-items:center; background: var(--bg-color); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                            <label style="font-weight:bold;">هل الفنى كان يرتدى اوفر شوز ؟</label>
                            <select class="cc-qa-overshoe" style="padding: 5px; border-radius: 4px; background: var(--card-bg); color: var(--text-color); border: 1px solid var(--border-color); width: 80px;">
                                <option value="">--</option><option value="Yes">نعم (Y)</option><option value="No">لا (N)</option>
                            </select>
                        </div>

                        <label style="display:block; margin-bottom:8px; margin-top:15px; font-weight:bold;">هل هناك اى شكاوى او تعليقات على الصيانة ؟</label>
                        <textarea class="cc-comment" rows="3" style="width: 100%; box-sizing: border-box; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); font-size: 14px;"></textarea>
                    </div>
                `;
            } else {
                // Dispatch Live Template
                formHTML = `
                    <div style="direction: rtl; text-align: right; margin-bottom: 15px;">
                        <p style="color: #ffb300; font-weight: bold; font-size: 16px; margin-top: 0;">متابعة خط السير (Dispatch Live)</p>
                        <label style="display:block; margin-bottom:5px; font-weight:bold; font-size: 14px;">التعليق (Comment):</label>
                        <textarea class="cc-comment" rows="3" style="width: 100%; box-sizing: border-box; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); font-size: 14px;"></textarea>
                    </div>
                `;
            }

            // 3. Audio Uploader and Submit Button
            const actionHTML = `
                <div style="margin-top: 15px; padding: 15px; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 4px;">
                    <label style="display:block; margin-bottom: 8px; font-size: 14px; font-weight: bold;">Upload Call Recording (Optional)</label>
                    <input type="file" class="cc-audio-upload" accept="audio/*" style="width: 100%; font-size: 13px; margin-bottom: 15px;">
                    <button class="primary-btn cc-submit-btn" style="width: 100%; background: #ffb300; color: #000; font-weight: bold; font-size: 15px;">Submit Follow Up</button>
                </div>
            `;

            card.innerHTML = baseInfoHTML + formHTML + actionHTML;

            // Attach Submission Logic Event
            const submitBtn = card.querySelector('.cc-submit-btn');
            submitBtn.addEventListener('click', async () => {
                await submitCCForm(fu, card, submitBtn);
            });

            ccTicketContainer.appendChild(card);
        });
    }

    // ==========================================
    // --- CALL CENTER FILTER ENGINE ---
    // ==========================================
    
    function buildCCFilterTable() {
        let filterContainer = document.getElementById('ccFilterContainer');

        // Create the HTML container dynamically if it doesn't exist yet
        if (!filterContainer) {
            filterContainer = document.createElement('div');
            filterContainer.id = 'ccFilterContainer';
            // Styling modeled exactly after the My Orders table
            filterContainer.style.cssText = 'width: 100%; margin: 0 auto 15px auto; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;';

            filterContainer.innerHTML = `
                <table style="width: 100%; border-collapse: collapse; text-align: center; table-layout: fixed;">
                    <thead>
                        <tr id="ccFilterHeaders"></tr>
                        <tr id="ccFilterInputs"></tr>
                    </thead>
                </table>
            `;
            // Insert it right above the ticket container
            const queueView = document.getElementById('ccQueueView');
            queueView.insertBefore(filterContainer, ccTicketContainer);
        }

        const headerRow = document.getElementById('ccFilterHeaders');
        const inputRow = document.getElementById('ccFilterInputs');

        if (ccOriginalFollowUps.length === 0) {
            filterContainer.style.display = 'none';
            return;
        }

        filterContainer.style.display = 'block';
        headerRow.innerHTML = '';
        inputRow.innerHTML = '';

        // Columns we want to filter by
        const CC_FILTER_COLS = [
            { key: 'so', label: 'SO' },
            { key: 'call_type', label: 'Type' },
            { key: 'date', label: 'Date' },
            { key: 'rout', label: 'Rout' },
            { key: 'phone', label: 'Phone' }
        ];

        CC_FILTER_COLS.forEach(col => {
            // 1. Build Header Name
            const th = document.createElement('th');
            th.style.padding = "5px";
            th.style.borderBottom = "1px solid var(--border-color)";
            th.style.borderRight = "1px solid var(--border-color)";
            th.innerHTML = `<span style="font-weight:bold; font-size: 13px; color: #1976d2;">${col.label}</span>`;
            headerRow.appendChild(th);

            // 2. Build Input Box
            const td = document.createElement('th');
            td.style.padding = "2px";
            td.style.borderRight = "1px solid var(--border-color)";

            const input = document.createElement('input');
            input.type = 'text';
            input.dataset.column = col.key;
            input.style.width = '100%';
            input.style.boxSizing = 'border-box';
            input.style.padding = '4px 2px';
            input.style.fontSize = '12px';
            input.style.background = 'var(--bg-color)';
            input.style.color = 'var(--text-color)';
            input.style.border = '1px solid var(--border-color)';
            input.style.borderRadius = '2px';

            // Trigger the filter function when the user types
            input.addEventListener('input', runCCFilters);

            td.appendChild(input);
            inputRow.appendChild(td);
        });
    }

    function runCCFilters() {
        const filterInputs = document.querySelectorAll('#ccFilterInputs input');
        let filteredFollowUps = [...ccOriginalFollowUps];

        filterInputs.forEach(input => {
            const val = input.value.toLowerCase().trim();
            const colKey = input.dataset.column;

            if (val) {
                filteredFollowUps = filteredFollowUps.filter(fu => {
                    const order = ccOriginalOrdersData.find(o => String(o.so) === String(fu.so)) || {};

                    let cellValue = '';
                    if (colKey === 'so' || colKey === 'call_type') {
                        // Data stored in the follow_up table
                        cellValue = String(fu[colKey] || '').toLowerCase();
                    } else if (colKey === 'phone') {
                        // Search both phone columns for a match
                        cellValue = String(order.phone || '').toLowerCase() + ' ' + String(order.phone_2 || '').toLowerCase();
                    } else {
                        // Data stored in the orders table (date, rout, etc)
                        cellValue = String(order[colKey] || '').toLowerCase();
                    }

                    return cellValue.includes(val);
                });
            }
        });

        // Instantly redraw the tickets with the filtered results!
        renderCCTickets(filteredFollowUps, ccOriginalOrdersData, ccOriginalLogs);
    }

    // --- FORM SUBMISSION ENGINE ---
    async function submitCCForm(fuData, cardEl, btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = 'Submitting...';

        // Extract text fields safely
        const commentBox = cardEl.querySelector('.cc-comment');
        const comment = commentBox ? commentBox.value.trim() : '';
        const audioInput = cardEl.querySelector('.cc-audio-upload');
        const file = audioInput ? audioInput.files[0] : null;

        // Extract QA fields safely
        const qaGood = cardEl.querySelector('.cc-qa-good') ? cardEl.querySelector('.cc-qa-good').value : '';
        const qaClean = cardEl.querySelector('.cc-qa-clean') ? cardEl.querySelector('.cc-qa-clean').value : '';
        const qaUniform = cardEl.querySelector('.cc-qa-uniform') ? cardEl.querySelector('.cc-qa-uniform').value : '';
        const qaOvershoe = cardEl.querySelector('.cc-qa-overshoe') ? cardEl.querySelector('.cc-qa-overshoe').value : '';

        // Validation Rules
        if (fuData.call_type === 'qa_complete') {
            if (!qaGood || !qaClean || !qaUniform || !qaOvershoe) {
                alert("Please answer all Yes/No questions before submitting the QA form.");
                btnEl.disabled = false;
                btnEl.textContent = 'Submit Follow Up';
                return;
            }
        }

        if (!comment && !file && fuData.call_type !== 'qa_complete') {
            if(!confirm("Are you sure you want to submit without leaving a comment or uploading a recording?")) {
                btnEl.disabled = false;
                btnEl.textContent = 'Submit Follow Up';
                return;
            }
        }

        let recordingUrl = '';

        // --- AUDIO FILE UPLOAD ---
        if (file) {
            btnEl.textContent = 'Uploading Audio...';
            try {
                const fileExt = file.name.split('.').pop();
                const fileName = `${fuData.so}_${Date.now()}.${fileExt}`;
                
                // Pointing to your specific folder route
                const urlPath = `call_center_recordings/${fileName}`;
                
                const { data: uploadData, error: uploadErr } = await supabaseClient.storage
                    .from('repair_media')
                    .upload(urlPath, file, {
                        cacheControl: '3600',
                        upsert: true
                    });

                if (uploadErr) throw uploadErr;

                // Grab the direct link to the file
                const { data: publicUrlData } = supabaseClient.storage
                    .from('repair_media')
                    .getPublicUrl(urlPath);
                    
                recordingUrl = publicUrlData.publicUrl;

            } catch (err) {
                alert("Audio upload failed: " + err.message);
                btnEl.disabled = false;
                btnEl.textContent = 'Submit Follow Up';
                return;
            }
        }

        btnEl.textContent = 'Saving Database...';

        const now = new Date();
        const payload = {
            call_status: 'submitted',
            submitted_at: now.toISOString(),
            operator_name: typeof currentUser !== 'undefined' && currentUser ? currentUser.username : 'Unknown',
            comment: comment,
            qa_good_service: qaGood,
            qa_clean: qaClean,
            qa_uniform: qaUniform,
            qa_overshoe: qaOvershoe,
            recording_url: recordingUrl
        };

        // --- SAVE TO SUPABASE ---
        const { error: updateErr } = await supabaseClient
            .from('follow_up')
            .update(payload)
            .eq('id', fuData.id); // Securely update this specific row using its unique ID

        if (updateErr) {
            alert("Database update failed: " + updateErr.message);
            btnEl.disabled = false;
            btnEl.textContent = 'Submit Follow Up';
            return;
        }

        // Clean up the UI
        alert("Follow Up successfully submitted!");
        cardEl.remove(); 

        
        // Count the remaining tickets and update the badge dynamically
        const remainingCards = ccTicketContainer.querySelectorAll('.ticket-card').length;
        const badge = document.getElementById('ccQueueCountBadge');
        
        if (badge) {
            badge.textContent = remainingCards;
            if (remainingCards === 0) badge.style.display = 'none';
        }

        if (remainingCards === 0) {
             ccTicketContainer.innerHTML = "<h3 style='text-align:center;'>Queue complete! 🎉</h3>";
        }
    }

    // --- GLOBAL HELPER: Push to Call Center Queue ---
    // This is attached to 'window' so app.js can call it easily
    window.pushToCCQueue = async function(soList, callType) {
        if (!soList || soList.length === 0) return;

        // 1. Fetch live settings to see if this trigger is turned ON
        const { data: settings } = await supabaseClient
            .from('system_settings')
            .select('*')
            .eq('id', 1)
            .single();

        if (!settings) return;

        // 2. Check if the specific trigger is enabled
        let isEnabled = false;
        if (callType === 'new_order' && settings.cc_trigger_new_order) isEnabled = true;
        if (callType === 'qa_complete' && settings.cc_trigger_qa_complete) isEnabled = true;
        if (callType === 'dispatch_live' && settings.cc_trigger_dispatch_live) isEnabled = true;

        if (!isEnabled) return; // Stop if the manager turned this switch off

        // 3. Delete any EXISTING 'pending' records for these SOs (Leaves 'submitted' intact!)
        await supabaseClient
            .from('follow_up')
            .delete()
            .in('so', soList)
            .eq('call_status', 'pending');

        // 4. Insert the fresh queue records
        const insertPayload = soList.map(so => ({
            so: String(so),
            call_type: callType,
            call_status: 'pending'
        }));

        await supabaseClient.from('follow_up').insert(insertPayload);
        console.log(`[Call Center] Added ${soList.length} orders to queue for ${callType}`);
    };

    // ==========================================
    // --- MANUAL SEND TO CC QUEUE LOGIC ---
    // (Operates on the System Page)
    // ==========================================
    const btnToggleSendToCC = document.getElementById('btnToggleSendToCC');
    const systemSendToCCContainer = document.getElementById('systemSendToCCContainer');
    const btnSubmitSendToCC = document.getElementById('btnSubmitSendToCC');
    const btnSubmitSendToCCQA = document.getElementById('btnSubmitSendToCCQA');
    const systemCcSoInput = document.getElementById('systemCcSoInput');

    if (btnToggleSendToCC && systemSendToCCContainer) {
        btnToggleSendToCC.addEventListener('click', () => {
            if (systemSendToCCContainer.style.display === 'none') {
                systemSendToCCContainer.style.display = 'flex';
            } else {
                systemSendToCCContainer.style.display = 'none';
            }
        });
    }

    // Reusable function to handle sending specific call types
    async function processManualCCQueue(callType, buttonElement) {
        const rawText = systemCcSoInput.value;
        const soList = rawText.split(/[\n,]+/).map(s => s.trim()).filter(s => s);

        if (soList.length === 0) {
            alert("Please paste at least one SO number.");
            return;
        }

        // Save original text to restore it if needed
        const originalText = buttonElement.textContent;
        buttonElement.disabled = true;
        buttonElement.textContent = 'Sending...';

        // RULE: Safely delete any existing pending records for these SOs so we cleanly overwrite them
        await supabaseClient
            .from('follow_up')
            .delete()
            .in('so', soList)
            .eq('call_status', 'pending');

        // Build the payload with the specific call type passed from the button
        const insertPayload = soList.map(so => ({
            so: String(so),
            call_type: callType, 
            call_status: 'pending'
        }));

        // Insert fresh records
        const { error } = await supabaseClient.from('follow_up').insert(insertPayload);

        buttonElement.disabled = false;
        buttonElement.textContent = originalText;

        if (error) {
            alert("Failed to send orders to Call Center: " + error.message);
        } else {
            alert(`✅ Success! ${soList.length} orders have been placed in the Call Center queue as '${callType}'.`);
            systemCcSoInput.value = '';
            systemSendToCCContainer.style.display = 'none';
        }
    }

    // Hook up both buttons to the engine
    if (btnSubmitSendToCC && systemCcSoInput) {
        btnSubmitSendToCC.addEventListener('click', () => {
            processManualCCQueue('manual_list', btnSubmitSendToCC);
        });
    }

    if (btnSubmitSendToCCQA && systemCcSoInput) {
        btnSubmitSendToCCQA.addEventListener('click', () => {
            processManualCCQueue('qa_complete', btnSubmitSendToCCQA);
        });
    }

    // ==========================================
    // --- CALL CENTER HISTORY VIEW LOGIC ---
    // ==========================================
    const ccQueueView = document.getElementById('ccQueueView');
    const ccHistoryView = document.getElementById('ccHistoryView');
    const ccHistoryBtn = document.getElementById('ccHistoryBtn');
    const ccBackToQueueBtn = document.getElementById('ccBackToQueueBtn');
    const btnFetchCcHistory = document.getElementById('btnFetchCcHistory');
    const ccHistStartDate = document.getElementById('ccHistStartDate');
    const ccHistEndDate = document.getElementById('ccHistEndDate');
    
    let ccHistoryData = [];
    let ccHistorySortDir = {};

    // 1. View Toggles
    if (ccHistoryBtn) {
        ccHistoryBtn.addEventListener('click', () => {
            ccQueueView.style.display = 'none';
            ccHistoryView.style.display = 'flex';
            
            // Auto-fill dates with the last 30 days if empty
            if (!ccHistStartDate.value || !ccHistEndDate.value) {
                const now = new Date();
                const past30 = new Date();
                past30.setDate(now.getDate() - 30);
                
                const formatInputDate = (dateObj) => {
                    const y = dateObj.getFullYear();
                    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
                    const d = String(dateObj.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                };
                
                ccHistStartDate.value = formatInputDate(past30);
                ccHistEndDate.value = formatInputDate(now);
            }
        });
    }

    if (ccBackToQueueBtn) {
        ccBackToQueueBtn.addEventListener('click', () => {
            ccHistoryView.style.display = 'none';
            ccQueueView.style.display = 'flex';
        });
    }

    // 2. Fetch History Logic
    if (btnFetchCcHistory) {
        btnFetchCcHistory.addEventListener('click', async () => {
            const start = ccHistStartDate.value;
            const end = ccHistEndDate.value;
            
            if (!start || !end) {
                alert("Please select both a start and end date.");
                return;
            }

            if (typeof showGlobalLoader === 'function') showGlobalLoader("Fetching Call Logs...");

            // Time padding to ensure the entire end day is included mathematically
            const startISO = `${start}T00:00:00.000Z`;
            const endISO = `${end}T23:59:59.999Z`;

            const { data, error } = await supabaseClient
                .from('follow_up')
                .select('*')
                .gte('submitted_at', startISO)
                .lte('submitted_at', endISO)
                .order('submitted_at', { ascending: false });

            if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

            if (error) {
                alert("Failed to fetch history: " + error.message);
                return;
            }

            ccHistoryData = data || [];
            renderCcHistoryTable();
        });
    }

    // 3. Render Table
    function renderCcHistoryTable() {
        const thead = document.getElementById('ccHistHeaderRow');
        const tbody = document.getElementById('ccHistTableBody');
        
        // Define exactly what columns we want to see
        const CC_HIST_COLUMNS = [
            { key: 'so', label: 'SO' },
            { key: 'call_type', label: 'Type' },
            { key: 'call_status', label: 'Status' },
            { key: 'operator_name', label: 'Operator' },
            { key: 'submitted_at', label: 'Submitted At' },
            { key: 'qa_good_service', label: 'QA: Good' },
            { key: 'qa_clean', label: 'QA: Clean' },
            { key: 'qa_uniform', label: 'QA: Uniform' },
            { key: 'qa_overshoe', label: 'QA: Overshoe' },
            { key: 'comment', label: 'Comment' },
            { key: 'recording_url', label: 'Recording' }
        ];

        // Build Headers and Search Filters (Only once)
        if (thead.children.length === 0) {
            const trHead = document.createElement('tr');
            
            // Index column header
            const indexTh = document.createElement('th');
            indexTh.innerHTML = `<div>#</div><input type="text" disabled style="width: 100%; box-sizing: border-box; margin-top: 5px; padding: 4px; border: 1px solid transparent; background: transparent; visibility: hidden;">`;
            trHead.appendChild(indexTh);

            CC_HIST_COLUMNS.forEach(col => {
                const th = document.createElement('th');
                
                // Sorting header
                th.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <span class="sort-header" style="cursor:pointer; font-weight:bold;">${col.label}</span>
                    </div>
                `;
                th.querySelector('.sort-header').addEventListener('click', () => sortCcHistoryColumn(col.key));
                
                // Excel-Style Search Input
                const searchInput = document.createElement('input');
                searchInput.type = 'text';
                searchInput.placeholder = 'Search...';
                searchInput.style.cssText = 'width: 100%; box-sizing: border-box; margin-top: 5px; padding: 4px; font-size: 11px; border: 1px solid var(--border-color); border-radius: 3px; background: var(--bg-color); color: var(--text-color);';
                searchInput.addEventListener('keyup', filterCcHistoryTable);
                
                th.appendChild(searchInput);
                trHead.appendChild(th);
            });
            thead.appendChild(trHead);
        }

        // Build Body Rows
        tbody.innerHTML = '';
        ccHistoryData.forEach((row, index) => {
            const tr = document.createElement('tr');
            
            // Number column
            const indexTd = document.createElement('td');
            indexTd.textContent = index + 1;
            indexTd.style.textAlign = 'center';
            indexTd.style.fontWeight = 'bold';
            tr.appendChild(indexTd);

            CC_HIST_COLUMNS.forEach(col => {
                const td = document.createElement('td');
                
                if (col.key === 'so') {
                    // Make SO clickable to instantly load and open the view-only ticket
                    const a = document.createElement('a');
                    a.href = '#';
                    a.textContent = row[col.key] || '';
                    a.style.cssText = 'color: var(--text-color); font-weight: 900; text-decoration: underline; cursor: pointer;';
                    a.addEventListener('click', async (e) => {
                        e.preventDefault();
                        if (typeof showGlobalLoader === 'function') showGlobalLoader("Fetching Ticket Details...");
                        // Fetch the master order details using the SO
                        const { data: orderData } = await supabaseClient.from('orders').select('*').eq('so', row.so).single();
                        if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

                        if (orderData && typeof openViewOnlyModal === 'function') {
                            openViewOnlyModal(orderData); // Opens your universal modal
                        } else {
                            alert("Could not load full ticket details for SO: " + row.so);
                        }
                    });
                    td.appendChild(a);
                } else if (col.key === 'submitted_at') {
                    if (row[col.key]) {
                        const d = new Date(row[col.key]);
                        td.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    }
                } else if (col.key === 'recording_url') {
                    if (row[col.key]) {
                        const a = document.createElement('a');
                        a.href = row[col.key];
                        a.target = '_blank';
                        a.textContent = '🔊 Listen';
                        a.style.cssText = 'color: #1976d2; font-weight: bold; text-decoration: none;';
                        td.appendChild(a);
                    } else {
                        td.textContent = 'N/A';
                    }
                } else {
                    td.textContent = row[col.key] !== null ? row[col.key] : '';
                }
                
                // Add styling to prevent ugly cell stretching
                td.style.padding = "6px";
                td.style.fontSize = "13px";
                td.style.whiteSpace = "nowrap";
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        // Hook into the global column resizer so the user can drag columns
        if (typeof applyResizableColumns === 'function') {
            applyResizableColumns('ccHistoryTable', 'cchist_cols');
        }
    }

    // 4. Filtering Logic
    function filterCcHistoryTable() {
        const trs = document.getElementById('ccHistTableBody').getElementsByTagName('tr');
        const inputs = document.getElementById('ccHistHeaderRow').getElementsByTagName('input');
        
        let visibleCount = 1; 
        
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
            // Renumber visible rows dynamically
            if (showRow && tds[0]) {
                tds[0].textContent = visibleCount++;
            }
        }
    }

    // 5. Sorting Logic
    function sortCcHistoryColumn(colKey) {
        const currentDir = ccHistorySortDir[colKey] === 'asc' ? 'desc' : 'asc';
        ccHistorySortDir = { [colKey]: currentDir }; 

        ccHistoryData.sort((a, b) => {
            let valA = a[colKey] || '';
            let valB = b[colKey] || '';

            if (colKey === 'submitted_at') {
                const dateA = new Date(valA || '1970-01-01');
                const dateB = new Date(valB || '1970-01-01');
                return currentDir === 'asc' ? dateA - dateB : dateB - dateA;
            }

            return currentDir === 'asc' 
                ? String(valA).localeCompare(String(valB)) 
                : String(valB).localeCompare(String(valA));
        });

        renderCcHistoryTable();
        filterCcHistoryTable(); 
    }

   
})();