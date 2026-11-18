// ==========================================
// --- K-E TELEPHONY INTEGRATION MODULE ---
// ==========================================

window.PBX_GATEWAY_URL = window.PBX_GATEWAY_URL || '';

(function() {
    let activeCall = null;
    let callTimerInterval = null;
    let telephonyChannel = null;
    let queueChannel = null;
    let telephonyUsername = '';
    let incomingCall = null;
    let requestPending = false;
    let stateRevision = 0;
    let sessionGeneration = 0;
    let refreshPending = null;
    let dismissedCallId = null;
    const terminalStates = ['COMPLETED', 'FAILED', 'CANCELLED', 'NO_ANSWER', 'BUSY', 'EXPIRED'];
    const pendingStates = ['WAITING_FOR_EMPLOYEE', 'CREATED'];
    const activeStates = [...pendingStates, 'EMPLOYEE_CONNECTED', 'WAITING_FOR_CUSTOMER',
        'RINGING', 'DIALING', 'RINGING_EMPLOYEE', 'DIALING_CUSTOMER', 'RINGING_CUSTOMER', 'CONNECTED', 'IN_PROGRESS'];
    const endedCalls = new Set();
    let tabSync = null;
    try {
        if (typeof BroadcastChannel !== 'undefined') tabSync = new BroadcastChannel('ke_telephony_sync');
    } catch (err) { console.warn('Telephony tab sync unavailable.'); }
    const gatewayUrl = () => String(window.PBX_GATEWAY_URL || '').replace(/\/+$/, '');
    const apiUrl = path => `${gatewayUrl()}/api/v1/telephony${path}`;
    const ownsPopup = () => !document.hidden && (!document.hasFocus || document.hasFocus());
    const callData = data => data && (Object.prototype.hasOwnProperty.call(data, 'call')
        ? data.call : Object.prototype.hasOwnProperty.call(data, 'data') ? callData(data.data) : data);
    const errorMessages = {
        NO_GSM_CHANNEL_AVAILABLE: 'All phone lines are busy. Please try again shortly.',
        EMPLOYEE_MOBILE_NOT_REGISTERED: 'Your mobile number is not registered. Please contact your manager.',
        CALL_SESSION_EXPIRED: 'This call session has expired. Please start a new call.',
        NOT_AUTHORIZED: 'You are not authorized to make this call. Please sign in again or contact your manager.',
        TELEPHONY_DISABLED: 'PBX calling is not enabled for your account.'
    };
    function safeError(data) {
        const code = String(data?.error?.code || data?.code || '').trim().toUpperCase();
        return errorMessages[code] || 'The call could not be processed. Please try again shortly.';
    }
    async function accessToken() {
        const session = await window.supabaseClient?.auth.getSession();
        return session?.data?.session?.access_token || '';
    }
    function syncTabs(type, data) {
        if (telephonyUsername) tabSync?.postMessage({ username: telephonyUsername, type, data });
    }

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
    const btnOpenIncomingTicket = document.getElementById('btnOpenIncomingTicket');
    const activeCallStatusBadge = document.getElementById('activeCallStatusBadge');
    const btnCancelPendingCall = document.getElementById('btnCancelPendingCall');

    if (btnDismissIncomingCall) {
        btnDismissIncomingCall.addEventListener('click', () => {
            if (incomingCallBanner) incomingCallBanner.style.display = 'none';
            incomingCall = null;
            syncTabs('dismiss-incoming', null);
        });
    }

    if (btnCloseCallPopup) {
        btnCloseCallPopup.addEventListener('click', () => {
            if (activeCallPopup) activeCallPopup.style.display = 'none';
            stopCallTimer();
            dismissedCallId = activeCall?.call_id;
            syncTabs('dismiss-active', dismissedCallId);
        });
    }

    if (btnRefreshCallState) {
        btnRefreshCallState.addEventListener('click', async () => {
            await refreshActiveCallStatus();
        });
    }

    // Android wake recovery: Check call status when tab resumes focus
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && telephonyUsername) {
            renderCallState();
            refreshActiveCallStatus();
        } else if (document.hidden) {
            renderCallState();
        }
    });
    window.addEventListener('focus', () => {
        renderCallState();
        if (telephonyUsername) refreshActiveCallStatus();
    });
    window.addEventListener('blur', renderCallState);

    if (btnOpenIncomingTicket) btnOpenIncomingTicket.addEventListener('click', async () => {
        const so = incomingCall?.so || incomingCall?.context?.id;
        if (!so || btnOpenIncomingTicket.disabled) return;
        btnOpenIncomingTicket.disabled = true;
        try {
            const { data, error } = await window.supabaseClient.from('orders').select('*').eq('so', String(so)).single();
            if (error || !data) throw new Error('Ticket unavailable.');
            if (typeof window.openViewOnlyModal === 'function') await window.openViewOnlyModal(data);
            else if (typeof window.openDetailsModal === 'function') await window.openDetailsModal(data);
        } catch (err) { alert('Could not open this ticket. Please search for it in the System page.'); }
        finally { btnOpenIncomingTicket.disabled = false; }
    });

    if (btnCancelPendingCall) btnCancelPendingCall.addEventListener('click', async () => {
        if (!activeCall?.call_id || !pendingStates.includes(activeCall.status) || btnCancelPendingCall.disabled) return;
        const callId = activeCall.call_id;
        const username = telephonyUsername;
        const generation = sessionGeneration;
        btnCancelPendingCall.disabled = true;
        try {
            const token = await accessToken();
            if (!token) { alert(errorMessages.NOT_AUTHORIZED); return; }
            const response = await fetch(apiUrl(`/calls/${encodeURIComponent(callId)}/cancel`), {
                method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json().catch(() => ({}));
            if (username !== telephonyUsername || generation !== sessionGeneration) return;
            if (!response.ok) { alert(safeError(data)); return; }
            const call = callData(data);
            if (call?.status) applyCall({ ...call, call_id: callId });
            else await refreshActiveCallStatus();
        } catch (err) { alert('Could not cancel the call. Refresh its status before trying again.'); }
        finally { btnCancelPendingCall.disabled = false; }
    });

    function startCallTimer(startTime) {
        stopCallTimer();
        const start = startTime ? new Date(startTime).getTime() : NaN;
        if (callDurationTimer) callDurationTimer.textContent = '00:00';
        if (!Number.isFinite(start)) return;
        const tick = () => {
            const now = Date.now();
            const elapsed = Math.max(0, Math.floor((now - start) / 1000));
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            if (callDurationTimer) callDurationTimer.textContent = `${mins}:${secs}`;
        };
        tick();
        callTimerInterval = setInterval(tick, 1000);
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

    function renderCallState() {
        const show = activeCall && !terminalStates.includes(activeCall.status)
            && dismissedCallId !== activeCall.call_id && ownsPopup();
        if (show) {
            showActiveCallUI(activeCall.so || activeCall.context?.id, activeCall.phone_slot,
                activeCall.connected_at || activeCall.employee_connected_at);
            if (activeCallStatusBadge) activeCallStatusBadge.textContent = activeCall.status || 'INITIALIZING';
        } else {
            if (activeCallPopup) activeCallPopup.style.display = 'none';
            stopCallTimer();
        }
        if (btnCancelPendingCall) btnCancelPendingCall.style.display = show && pendingStates.includes(activeCall.status) ? 'inline-block' : 'none';
        if (incomingCallBanner) incomingCallBanner.style.display = incomingCall && ownsPopup() ? 'block' : 'none';
    }

    function applyCall(data, publish = true) {
        if (!data?.call_id) return;
        const status = String(data.status || '').toUpperCase();
        if (endedCalls.has(data.call_id) && !terminalStates.includes(status)) return;
        if (activeCall?.call_id === data.call_id && data.updated_at && activeCall.updated_at
            && new Date(data.updated_at) < new Date(activeCall.updated_at)) return;
        stateRevision++;
        if (terminalStates.includes(status)) {
            endedCalls.add(data.call_id);
            if (activeCall?.call_id === data.call_id) activeCall = null;
        } else {
            activeCall = { ...(activeCall?.call_id === data.call_id ? activeCall : {}), ...data,
                status: status || activeCall?.status || 'CREATED' };
        }
        renderCallState();
        if (publish) syncTabs('call', data);
    }

    function showIncoming(data, publish = true) {
        incomingCall = data;
        const so = data?.so || data?.context?.id;
        if (incomingCallInfo) incomingCallInfo.textContent = `SO: ${so || 'Unknown'} - Customer: ${data?.customer_name || 'N/A'}`;
        if (btnOpenIncomingTicket) btnOpenIncomingTicket.style.display = so ? 'inline-block' : 'none';
        renderCallState();
        if (publish) syncTabs('incoming', data);
    }

    if (tabSync) tabSync.onmessage = ({ data }) => {
        if (!telephonyUsername || data?.username !== telephonyUsername) return;
        if (data.type === 'call') applyCall(data.data, false);
        else if (data.type === 'incoming') showIncoming(data.data, false);
        else if (data.type === 'dismiss-incoming') { incomingCall = null; renderCallState(); }
        else if (data.type === 'dismiss-active') { dismissedCallId = data.data; renderCallState(); }
        else if (data.type === 'clear-active' && activeCall?.call_id === data.data) {
            endedCalls.add(data.data);
            stateRevision++; activeCall = null; renderCallState();
        }
    };

    async function refreshActiveCallStatus() {
        if (!telephonyUsername || !window.supabaseClient) return;
        if (refreshPending) return refreshPending;
        const username = telephonyUsername;
        const generation = sessionGeneration;
        const revision = stateRevision;
        const operation = (async () => {
            try {
                const token = await accessToken();
                if (!token) return;
                let call;
                try {
                    const response = await fetch(apiUrl('/calls/active'), { headers: { 'Authorization': `Bearer ${token}` } });
                    if (!response.ok) throw new Error('Active call endpoint unavailable.');
                    call = response.status === 204 ? null : callData(await response.json());
                } catch (err) {
                    if (gatewayUrl()) throw err;
                    const { data, error } = await window.supabaseClient.from('telephony_calls').select('*')
                        .eq('employee_id', username).in('status', activeStates)
                        .order('requested_at', { ascending: false }).limit(1);
                    if (error) throw error;
                    call = data?.[0] || null;
                }
                if (username !== telephonyUsername || generation !== sessionGeneration || revision !== stateRevision) return;
                if (call?.call_id) applyCall(call);
                else {
                    const clearedCallId = activeCall?.call_id;
                    if (clearedCallId) endedCalls.add(clearedCallId);
                    stateRevision++; activeCall = null; renderCallState();
                    if (clearedCallId) syncTabs('clear-active', clearedCallId);
                }
            } catch (err) { console.warn('Could not refresh PBX call status.'); }
            finally { if (refreshPending === operation) refreshPending = null; }
        })();
        refreshPending = operation;
        return refreshPending;
    }
    window.refreshActiveCallStatus = refreshActiveCallStatus;

    // Initialize Realtime subscriptions for telephony channels
    window.initTelephonyRealtime = function(username, role) {
        if (!window.supabaseClient || !username) return;

        const cleanUser = username.trim().toLowerCase();
        const roleStr = (role || '').toLowerCase();
        const userTopic = `telephony:user_${cleanUser}`;

        window.resetTelephonySession();
        telephonyUsername = cleanUser;
        const generation = sessionGeneration;

        telephonyChannel = window.supabaseClient.channel(userTopic, { config: { private: true } });

        // Listen for 1-to-1 call updates directed at this user
        const eventStates = { 'telephony.call.created': 'CREATED', 'telephony.call.connected': 'CONNECTED',
            'telephony.call.ended': 'COMPLETED', 'telephony.call.failed': 'FAILED' };
        ['telephony.call.updated', 'telephony.call.created', 'telephony.call.connected',
            'telephony.call.ended', 'telephony.call.failed', 'telephony.recording.ready'].forEach(event => {
            telephonyChannel.on('broadcast', { event }, ({ payload }) => {
                if (telephonyUsername !== cleanUser || generation !== sessionGeneration) return;
                const data = callData(payload);
                if (event === 'telephony.recording.ready') { refreshActiveCallStatus(); return; }
                applyCall({ ...data, status: data?.status || eventStates[event] });
            });
        });

        // Listen to Call Center Queue if Coordinator, Manager, or Admin
        if (roleStr.includes('coordinator') || roleStr.includes('manager') || roleStr.includes('admin')) {
            queueChannel = window.supabaseClient.channel('telephony:call_center_queue', { config: { private: true } });
            queueChannel.on('broadcast', { event: 'telephony.call.incoming' }, ({ payload }) => {
                if (telephonyUsername === cleanUser && generation === sessionGeneration) showIncoming(callData(payload));
            }).subscribe();
        }

        telephonyChannel.subscribe();
    };

    window.resetTelephonySession = function() {
        sessionGeneration++;
        if (telephonyChannel) window.supabaseClient.removeChannel(telephonyChannel);
        if (queueChannel) window.supabaseClient.removeChannel(queueChannel);
        telephonyChannel = queueChannel = null;
        telephonyUsername = '';
        activeCall = incomingCall = null;
        dismissedCallId = null;
        refreshPending = null;
        endedCalls.clear();
        stateRevision++;
        renderCallState();
    };

    // Authenticated audio streaming for playback
    window.playTelephonyRecording = async function(callId, audioElement) {
        if (!callId || !audioElement) return;

        try {
            const session = (await window.supabaseClient.auth.getSession()).data.session;
            const token = session ? session.access_token : '';

            const response = await fetch(apiUrl(`/calls/${encodeURIComponent(callId)}/recording/stream`), {
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
    window.triggerSecureCall = async function(soNumber, phoneSlot = 'PRIMARY', triggerBtn = null) {
        if (!soNumber) return;
        if (requestPending || triggerBtn?.disabled) return;

        if (!navigator.onLine) {
            alert('Cannot place a PBX call while offline. Please use your standard cellular phone line.');
            return;
        }

        requestPending = true;
        if (triggerBtn) triggerBtn.disabled = true;
        const username = telephonyUsername;
        const generation = sessionGeneration;
        try {
            const sessionRes = await window.supabaseClient.auth.getSession();
            const session = sessionRes?.data?.session;
            const token = session ? session.access_token : '';

            if (!token) {
                alert('Session expired or unauthorized. Please re-login.');
                return;
            }

            // Generate UUID v4 for idempotency
            const bytes = new Uint8Array(16);
            if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
            else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
            bytes[6] = (bytes[6] & 15) | 64;
            bytes[8] = (bytes[8] & 63) | 128;
            const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
            const idempotencyKey = window.crypto?.randomUUID ? window.crypto.randomUUID()
                : `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

            const response = await fetch(apiUrl('/calls'), {
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
                
                // If Gateway is still in progress, inform user cleanly
                if (errorMessages[String(errData?.error?.code || errData?.code || '').trim().toUpperCase()]) {
                    alert(safeError(errData));
                } else if (response.status === 404 || response.status === 502) {
                    alert(`PBX Gateway notice: The telephony server is currently staging this endpoint (${response.status}). Acceptance testing will activate once the PBX team connects their server.`);
                } else {
                    alert(safeError(errData));
                }
            } else {
                const callRes = await response.json();
                if (username !== telephonyUsername || generation !== sessionGeneration) return;
                const call = callData(callRes);
                if (!call?.call_id) { alert('The phone server returned an incomplete call session. Please refresh its status.'); return; }
                const existing = activeCall?.call_id === call.call_id ? activeCall : {};
                dismissedCallId = null;
                applyCall({ ...call, so: String(soNumber), phone_slot: phoneSlot,
                    status: 'WAITING_FOR_EMPLOYEE', ...existing });
                const accessNumber = callRes.access_number || call?.access_number;
                if (accessNumber && !endedCalls.has(call.call_id)) window.location.href = `tel:${accessNumber}`;
            }
        } catch (err) {
            console.warn('PBX Gateway network request:', err.message);
            alert('Notice: The PBX Gateway server is not yet responding to /api/v1/telephony/calls. Direct phone link remains fully operational.');
        } finally {
            requestPending = false;
            if (triggerBtn) triggerBtn.disabled = false;
        }
    };
})();
