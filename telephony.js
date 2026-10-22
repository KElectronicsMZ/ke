// ==========================================
// --- K-E TELEPHONY INTEGRATION MODULE ---
// ==========================================

(function() {
    let activeCall = null;
    let callTimerInterval = null;
    let telephonyChannel = null;

    // DOM Elements
    const activeCallPopup = document.getElementById('activeCallPopup');
    const activeCallSo = document.getElementById('activeCallSo');
    const activeCallSlot = document.getElementById('activeCallSlot');
    const callDurationTimer = document.getElementById('callDurationTimer');
    const btnRefreshCallState = document.getElementById('btnRefreshCallState');
    const btnCloseCallPopup = document.getElementById('btnCloseCallPopup');
    const incomingCallBanner = document.getElementById('incomingCallBanner');
    const incomingCallInfo = document.getElementById('incomingCallInfo');
    const btnDismissIncomingCall = document.getElementById('btnDismissIncomingCall');

    if (btnDismissIncomingCall) {
        btnDismissIncomingCall.addEventListener('click', () => {
            if (incomingCallBanner) incomingCallBanner.style.display = 'none';
        });
    }

    if (btnCloseCallPopup) {
        btnCloseCallPopup.addEventListener('click', () => {
            if (activeCallPopup) activeCallPopup.style.display = 'none';
            stopCallTimer();
        });
    }

    if (btnRefreshCallState) {
        btnRefreshCallState.addEventListener('click', async () => {
            await refreshActiveCallStatus();
        });
    }

    // Android wake recovery: Check call status when tab resumes focus
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && activeCall) {
            refreshActiveCallStatus();
        }
    });

    function startCallTimer(startTime) {
        stopCallTimer();
        const start = startTime ? new Date(startTime).getTime() : Date.now();
        callTimerInterval = setInterval(() => {
            const now = Date.now();
            const elapsed = Math.floor((now - start) / 1000);
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            if (callDurationTimer) callDurationTimer.textContent = `${mins}:${secs}`;
        }, 1000);
    }

    function stopCallTimer() {
        if (callTimerInterval) {
            clearInterval(callTimerInterval);
            callTimerInterval = null;
        }
    }

    function showActiveCallUI(so, slot, startTime) {
        if (!activeCallPopup) return;
        if (activeCallSo) activeCallSo.textContent = so || '-';
        if (activeCallSlot) activeCallSlot.textContent = slot || 'PRIMARY';
        activeCallPopup.style.display = 'block';
        startCallTimer(startTime);
    }

    async function refreshActiveCallStatus() {
        if (!activeCall || !window.supabaseClient) return;
        const { data, error } = await window.supabaseClient
            .from('telephony_calls')
            .select('*')
            .eq('call_id', activeCall.call_id)
            .single();

        if (error || !data) return;

        if (['COMPLETED', 'FAILED', 'CANCELLED', 'NO_ANSWER', 'BUSY'].includes(data.status)) {
            stopCallTimer();
            if (activeCallPopup) activeCallPopup.style.display = 'none';
            activeCall = null;
        } else if (data.status === 'CONNECTED' && data.employee_connected_at) {
            startCallTimer(data.employee_connected_at);
        }
    }

    // Initialize Realtime subscriptions for telephony channels
    window.initTelephonyRealtime = function(username, role) {
        if (!window.supabaseClient || !username) return;

        const cleanUser = username.toLowerCase();
        const roleStr = (role || '').toLowerCase();
        const userTopic = `telephony:user_${cleanUser}`;

        if (telephonyChannel) {
            window.supabaseClient.removeChannel(telephonyChannel);
        }

        telephonyChannel = window.supabaseClient.channel('telephony-events');

        // Listen for 1-to-1 call updates directed at this user
        telephonyChannel.on('broadcast', { event: userTopic }, (payload) => {
            const data = payload.payload;
            if (data.type === 'CALL_STARTED') {
                activeCall = data;
                showActiveCallUI(data.so, data.phone_slot, data.started_at);
            } else if (data.type === 'CALL_ENDED') {
                stopCallTimer();
                if (activeCallPopup) activeCallPopup.style.display = 'none';
                activeCall = null;
            }
        });

        // Listen to Call Center Queue if Coordinator, Manager, or Admin
        if (roleStr.includes('coordinator') || roleStr.includes('manager') || roleStr.includes('admin')) {
            telephonyChannel.on('broadcast', { event: 'telephony:call_center_queue' }, (payload) => {
                const data = payload.payload;
                if (incomingCallBanner && incomingCallInfo) {
                    incomingCallInfo.textContent = `SO: ${data.so || 'Unknown'} - Customer: ${data.customer_name || 'N/A'}`;
                    incomingCallBanner.style.display = 'block';
                }
            });
        }

        telephonyChannel.subscribe();
    };

    // Authenticated audio streaming for playback
    window.playTelephonyRecording = async function(callId, audioElement) {
        if (!callId || !audioElement) return;

        try {
            const session = (await window.supabaseClient.auth.getSession()).data.session;
            const token = session ? session.access_token : '';

            const response = await fetch(`/api/v1/telephony/calls/${encodeURIComponent(callId)}/recording/stream`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Recording unavailable or unauthorized.');
            }

            const audioBlob = await response.blob();
            const blobUrl = URL.createObjectURL(audioBlob);
            audioElement.src = blobUrl;
            audioElement.play();
        } catch (err) {
            alert('Could not stream recording: ' + err.message);
        }
    };

    // Trigger Outbound Bridged Call via PBX Gateway
    window.triggerSecureCall = async function(soNumber, phoneSlot = 'PRIMARY') {
        if (!soNumber) return;

        if (!navigator.onLine) {
            alert('Cannot place a PBX call while offline. Please use your standard cellular phone line.');
            return;
        }

        try {
            const sessionRes = await window.supabaseClient.auth.getSession();
            const session = sessionRes?.data?.session;
            const token = session ? session.access_token : '';

            if (!token) {
                alert('Session expired or unauthorized. Please re-login.');
                return;
            }

            // Generate UUID v4 for idempotency
            const idempotencyKey = 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

            showActiveCallUI(soNumber, phoneSlot, Date.now());

            const response = await fetch('/api/v1/telephony/calls', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Idempotency-Key': idempotencyKey
                },
                body: JSON.stringify({
                    context: {
                        type: 'order',
                        id: String(soNumber)
                    },
                    phone_slot: phoneSlot
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.message || response.statusText || 'Gateway unreachable';
                
                // If Gateway is still in progress, inform user cleanly
                if (response.status === 404 || response.status === 502) {
                    alert(`PBX Gateway notice: The telephony server is currently staging this endpoint (${response.status}). Acceptance testing will activate once the PBX team connects their server.`);
                } else {
                    alert('Call initiation notice: ' + errMsg);
                }
            } else {
                const callRes = await response.json();
                activeCall = callRes;
                if (callRes.call_id) {
                    refreshActiveCallStatus();
                }
            }
        } catch (err) {
            console.warn('PBX Gateway network request:', err.message);
            alert('Notice: The PBX Gateway server is not yet responding to /api/v1/telephony/calls. Direct phone link remains fully operational.');
        }
    };
})();