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
            return;
        }

        // 2. Fetch the base order details for the SOs in the queue
        const soList = followUps.map(f => f.so);
        const { data: ordersData, error: ordErr } = await supabaseClient
            .from('orders')
            .select('*')
            .in('so', soList);

        if (typeof hideGlobalLoader === 'function') hideGlobalLoader();

        if (ordErr) {
            alert("Error loading order details: " + ordErr.message);
            return;
        }

        renderCCTickets(followUps, ordersData || []);
    }

    // --- RENDER DYNAMIC TICKETS ---
    function renderCCTickets(followUps, ordersData) {
        followUps.forEach(fu => {
            // Match the follow-up record with the master order details
            const order = ordersData.find(o => String(o.so) === String(fu.so)) || {};
            
            const card = document.createElement('div');
            card.className = 'ticket-card';
            card.style.borderColor = '#ffb300'; // Unique Yellow/Orange border for CC
            card.style.borderWidth = '2px';

            // Safe Phone Links
            const safePhone1 = order.phone ? String(order.phone).replace(/\s+/g, '') : '';
            const safePhone2 = order.phone_2 ? String(order.phone_2).replace(/\s+/g, '') : '';
            const p1 = order.phone ? `<a class="phone-link" href="tel:${safePhone1}">📞 ${order.phone}</a>` : 'N/A';
            const p2 = order.phone_2 ? `<a class="phone-link" href="tel:${safePhone2}">📞 ${order.phone_2}</a>` : 'N/A';

            // 1. Build Master Info Section (Top part of ticket)
            const baseInfoHTML = `
                <div class="ticket-header" style="background: rgba(255, 179, 0, 0.1); padding: 10px; margin: -15px -15px 15px -15px; border-bottom: 2px solid #ffb300; border-radius: 8px 8px 0 0;">
                    <span><strong style="color: #ffb300; font-size: 16px;">[Call Center]</strong> SO: <span style="font-size: 16px;">${fu.so}</span></span>
                    <span style="color:#ffb300; font-size: 13px; font-weight: bold;">Type: ${fu.call_type}</span>
                </div>
                <div class="ticket-row"><span><strong>Name:</strong> ${order.name || 'N/A'}</span> <span>${p1}</span></div>
                <div class="ticket-row"><span><strong>Date:</strong> ${order.date || 'N/A'}</span> <span>${p2}</span></div>
                <div class="ticket-row" style="margin-top: 5px;"><strong>Address:</strong> ${order.address || 'N/A'}</div>
                <div class="ticket-row"><span><strong>Model:</strong> ${order.model || 'N/A'}</span> <span><strong>SN:</strong> ${order.serial || 'N/A'}</span></div>
                <div class="ticket-row" style="margin-top: 5px;"><strong>Status Comment:</strong> ${order.status_comment || 'N/A'}</div>
                <div class="ticket-row" style="margin-top: 5px;"><strong>Assigned Tech:</strong> <span style="color: #1976d2; font-weight: bold;">${order.assigned_tech || 'N/A'}</span></div>
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

        if (ccTicketContainer.children.length === 0) {
             ccTicketContainer.innerHTML = "<h3 style='text-align:center;'>Queue complete! 🎉</h3>";
        }
    }

})();