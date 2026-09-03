// ==========================================
// --- SETTINGS MANAGEMENT MODULE ---
// ==========================================

(function() {
    // 1. Grab HTML elements
    const saveButton = document.getElementById('save-settings-btn');
    const newOrdersBox = document.getElementById('trigger-new-orders');
    const qaCompleteBox = document.getElementById('trigger-qa-complete');
    const dispatchLiveBox = document.getElementById('trigger-dispatch-live');
    const successMsg = document.getElementById('ccSettingsSavedMsg'); 
    const btnSettings = document.getElementById('btnSettings');

    // Permissions UI elements
    const roleSelectDropdown = document.getElementById('roleSelectDropdown');
    const permissionsContainer = document.getElementById('permissionsContainer');
    const savePermissionsBtn = document.getElementById('save-permissions-btn');
    const permSettingsSavedMsg = document.getElementById('permSettingsSavedMsg');

    // User Role UI elements
    const userSelectDropdown = document.getElementById('userSelectDropdown');
    const assignRoleContainer = document.getElementById('assignRoleContainer');
    const assignRoleDropdown = document.getElementById('assignRoleDropdown');
    const currentUserRoleText = document.getElementById('currentUserRoleText');
    const saveUserRoleBtn = document.getElementById('save-user-role-btn');
    const userRoleSavedMsg = document.getElementById('userRoleSavedMsg');

    // Maps database columns to clean labels for the UI
    const permissionMap = [
        { col: 'can_view_my_orders', label: 'My Orders' },
        { col: 'can_view_monitor', label: 'Monitor' },
        { col: 'can_view_bonuses', label: 'Bonuses' },
        { col: 'can_view_assignation', label: 'Daily Assignation' },
        { col: 'can_view_system', label: 'System' },
        { col: 'can_view_call_center', label: 'Call Center' },
        { col: 'can_view_settings', label: 'Settings (Admin)' },
        { col: 'can_view_warehouse', label: 'Warehouse' },
        { col: 'can_view_accounting', label: 'Accounting' },
        { col: 'can_view_tracking', label: 'Tracking' },
        { col: 'can_view_my_team', label: 'My Team' },
        { col: 'can_view_fleet', label: 'Drivers Fleet' }
    ];

    // 2. Fetch everything when Settings page opens
    if (btnSettings) {
        btnSettings.addEventListener('click', async () => {
            // Fetch Call Center Settings
            const { data: ccData } = await supabaseClient.from('system_settings').select('*').eq('id', 1).single();
            if (ccData) {
                newOrdersBox.checked = ccData.cc_trigger_new_order === true;
                qaCompleteBox.checked = ccData.cc_trigger_qa_complete === true;
                dispatchLiveBox.checked = ccData.cc_trigger_dispatch_live === true;
            }

            // Fetch Users to extract unique roles and populate User Dropdown
            const { data: usersData } = await supabaseClient.from('profiles').select('username, role').order('username');
            
            if (usersData) {
                userSelectDropdown.innerHTML = '<option value="">-- Choose User --</option>';
                const uniqueRoles = new Set();

                usersData.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.username;
                    opt.textContent = u.username;
                    const userRole = (u.role || 'unassigned').toLowerCase().trim();
                    opt.dataset.currentRole = userRole; 
                    userSelectDropdown.appendChild(opt);
                    
                    if (userRole && userRole !== 'unassigned') {
                        uniqueRoles.add(userRole);
                    }
                });

                // Populate BOTH Role Dropdowns
                roleSelectDropdown.innerHTML = '<option value="">-- Choose Role --</option>';
                assignRoleDropdown.innerHTML = '<option value="">-- Choose Role --</option>';
                
                Array.from(uniqueRoles).sort().forEach(role => {
                    const opt1 = document.createElement('option');
                    opt1.value = role;
                    opt1.textContent = role.toUpperCase();
                    roleSelectDropdown.appendChild(opt1);

                    const opt2 = document.createElement('option');
                    opt2.value = role;
                    opt2.textContent = role.toUpperCase();
                    assignRoleDropdown.appendChild(opt2);
                });
            }
        });
    }

    // 3. Save Call Center Settings
    if (saveButton && newOrdersBox && qaCompleteBox && dispatchLiveBox) {
        saveButton.addEventListener('click', async function() {
            saveButton.disabled = true;
            saveButton.textContent = 'Saving...';
            successMsg.style.display = 'none';

            const settingsData = {
                cc_trigger_new_order: newOrdersBox.checked,
                cc_trigger_qa_complete: qaCompleteBox.checked,
                cc_trigger_dispatch_live: dispatchLiveBox.checked
            };

            const { error } = await supabaseClient.from('system_settings').update(settingsData).eq('id', 1);

            saveButton.textContent = '💾 Save Call Center Settings';
            saveButton.disabled = false;
            
            if (error) {
                alert('Problem saving settings: ' + error.message);
            } else {
                successMsg.style.display = 'inline-block';
                setTimeout(() => successMsg.style.display = 'none', 3000);
            }
        });
    }

    // 4. Role Permissions: Show Checkboxes on change
    if (roleSelectDropdown) {
        roleSelectDropdown.addEventListener('change', async (e) => {
            const selectedRole = e.target.value;
            if (!selectedRole) {
                permissionsContainer.style.display = 'none';
                savePermissionsBtn.style.display = 'none';
                return;
            }

            permissionsContainer.innerHTML = '<span style="color: gray;">Loading permissions...</span>';
            permissionsContainer.style.display = 'flex';
            
            const { data, error } = await supabaseClient.from('role_permissions').select('*').eq('role', selectedRole).single();

            permissionsContainer.innerHTML = ''; 
            
            // If there's an error (e.g. role doesn't exist in table yet), we just default all to false
            const permsData = data || {};

            permissionMap.forEach(perm => {
                const label = document.createElement('label');
                label.style.cssText = 'display: flex; align-items: center; gap: 10px; cursor: pointer; border-bottom: 1px dashed var(--border-color); padding-bottom: 8px;';
                const isChecked = permsData[perm.col] ? 'checked' : '';
                label.innerHTML = `
                    <input type="checkbox" data-col="${perm.col}" style="width: 18px; height: 18px;" ${isChecked}>
                    <span style="font-weight: bold;">${perm.label}</span>
                `;
                permissionsContainer.appendChild(label);
            });

            savePermissionsBtn.style.display = 'block';
        });
    }

    // 5. Role Permissions: Save (Upsert)
    if (savePermissionsBtn) {
        savePermissionsBtn.addEventListener('click', async () => {
            const selectedRole = roleSelectDropdown.value;
            if (!selectedRole) return;

            savePermissionsBtn.disabled = true;
            savePermissionsBtn.textContent = 'Saving...';
            permSettingsSavedMsg.style.display = 'none';

            const payload = { role: selectedRole }; 
            permissionsContainer.querySelectorAll('input[type="checkbox"]').forEach(box => {
                payload[box.dataset.col] = box.checked;
            });

            const { error } = await supabaseClient.from('role_permissions').upsert(payload, { onConflict: 'role' });

            savePermissionsBtn.disabled = false;
            savePermissionsBtn.textContent = '💾 Save Role Permissions';

            if (error) {
                alert("Error saving permissions: " + error.message);
            } else {
                permSettingsSavedMsg.style.display = 'block';
                setTimeout(() => permSettingsSavedMsg.style.display = 'none', 3000);
            }
        });
    }

    // 6. User Role: Show info on change
    if (userSelectDropdown) {
        userSelectDropdown.addEventListener('change', (e) => {
            const selectedUsername = e.target.value;
            if (!selectedUsername) {
                assignRoleContainer.style.display = 'none';
                saveUserRoleBtn.style.display = 'none';
                return;
            }

            const selectedOption = e.target.options[e.target.selectedIndex];
            const currentRole = selectedOption.dataset.currentRole;

            currentUserRoleText.textContent = `Current Role: ${currentRole.toUpperCase()}`;
            assignRoleDropdown.value = currentRole; 

            assignRoleContainer.style.display = 'flex';
            saveUserRoleBtn.style.display = 'block';
        });
    }

    // 7. User Role: Save Update
    if (saveUserRoleBtn) {
        saveUserRoleBtn.addEventListener('click', async () => {
            const selectedUsername = userSelectDropdown.value;
            const newRole = assignRoleDropdown.value;

            if (!selectedUsername || !newRole) {
                alert("Please select both a user and a role.");
                return;
            }

            saveUserRoleBtn.disabled = true;
            saveUserRoleBtn.textContent = 'Saving...';
            userRoleSavedMsg.style.display = 'none';

            const { error } = await supabaseClient.from('profiles').update({ role: newRole }).eq('username', selectedUsername);

            saveUserRoleBtn.disabled = false;
            saveUserRoleBtn.textContent = '💾 Update User Role';

            if (error) {
                alert("Error updating user role: " + error.message);
            } else {
                const selectedOption = userSelectDropdown.options[userSelectDropdown.selectedIndex];
                selectedOption.dataset.currentRole = newRole;
                currentUserRoleText.textContent = `Current Role: ${newRole.toUpperCase()}`;
                
                userRoleSavedMsg.style.display = 'block';
                setTimeout(() => userRoleSavedMsg.style.display = 'none', 3000);
            }
        });
    }
    // 8. Matrix Team & Supervisor Assignment Logic
    const matrixUserSelectDropdown = document.getElementById('matrixUserSelectDropdown');
    const matrixConfigContainer = document.getElementById('matrixConfigContainer');
    const isSupervisorCheckbox = document.getElementById('isSupervisorCheckbox');
    const matrixTeamContainer = document.getElementById('matrixTeamContainer');
    const saveMatrixTeamBtn = document.getElementById('save-matrix-team-btn');
    const matrixTeamSavedMsg = document.getElementById('matrixTeamSavedMsg');

    if (matrixUserSelectDropdown && btnSettings) {
        btnSettings.addEventListener('click', async () => {
            // Populate the main user dropdown with all profiles
            const { data: allUsers } = await supabaseClient
                .from('profiles')
                .select('username')
                .order('username');

            if (allUsers) {
                matrixUserSelectDropdown.innerHTML = '<option value="">-- Choose User --</option>';
                allUsers.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.username;
                    opt.textContent = u.username;
                    matrixUserSelectDropdown.appendChild(opt);
                });
            }
        });

        // Show config and load team members when a user is selected
        matrixUserSelectDropdown.addEventListener('change', async (e) => {
            const selectedUser = e.target.value;
            if (!selectedUser) {
                matrixConfigContainer.style.display = 'none';
                saveMatrixTeamBtn.style.display = 'none';
                return;
            }

            matrixTeamContainer.innerHTML = '<span style="color: gray;">Loading configuration...</span>';
            matrixConfigContainer.style.display = 'flex';

            // Fetch the selected user's profile and JSON array
            const { data: userProfile } = await supabaseClient
                .from('profiles')
                .select('role, team_members')
                .eq('username', selectedUser)
                .single();

            const currentRole = (userProfile?.role || '').toLowerCase();
            isSupervisorCheckbox.checked = currentRole.includes('supervisor');
            
            // Parse JSON array safely
            let currentTeam = [];
            try {
                if (userProfile?.team_members) {
                    currentTeam = typeof userProfile.team_members === 'string' 
                        ? JSON.parse(userProfile.team_members) 
                        : userProfile.team_members;
                }
            } catch (err) {
                currentTeam = [];
            }

            // Fetch ALL system users to display as team checkboxes
            const { data: allTechs } = await supabaseClient
                .from('profiles')
                .select('username')
                .neq('username', selectedUser) // Exclude themselves
                .order('username');

            matrixTeamContainer.innerHTML = '';

            if (allTechs && allTechs.length > 0) {
                allTechs.forEach(tech => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display: flex; align-items: center; gap: 10px; cursor: pointer; border-bottom: 1px dashed var(--border-color); padding-bottom: 8px;';
                    
                    const isChecked = currentTeam.includes(tech.username) ? 'checked' : '';
                    
                    label.innerHTML = `
                        <input type="checkbox" data-tech="${tech.username}" style="width: 18px; height: 18px;" ${isChecked}>
                        <span style="font-weight: bold;">${tech.username}</span>
                    `;
                    matrixTeamContainer.appendChild(label);
                });
                saveMatrixTeamBtn.style.display = 'block';
            } else {
                matrixTeamContainer.innerHTML = '<span style="color: gray;">No other users found.</span>';
                saveMatrixTeamBtn.style.display = 'none';
            }
        });

        // Save Matrix Configuration
        saveMatrixTeamBtn.addEventListener('click', async () => {
            const selectedUser = matrixUserSelectDropdown.value;
            if (!selectedUser) return;

            saveMatrixTeamBtn.disabled = true;
            saveMatrixTeamBtn.textContent = 'Saving...';
            matrixTeamSavedMsg.style.display = 'none';

            // 1. Fetch current role to safely append/remove "supervisor"
            const { data: userProfile } = await supabaseClient
                .from('profiles')
                .select('role')
                .eq('username', selectedUser)
                .single();
            
            let updatedRole = (userProfile?.role || '').trim();
            const hasSupervisorRole = updatedRole.toLowerCase().includes('supervisor');

            if (isSupervisorCheckbox.checked && !hasSupervisorRole) {
                updatedRole = updatedRole ? updatedRole + ', supervisor' : 'supervisor';
            } else if (!isSupervisorCheckbox.checked && hasSupervisorRole) {
                // Remove "supervisor" from the role string cleanly
                updatedRole = updatedRole.split(',').map(r => r.trim()).filter(r => r.toLowerCase() !== 'supervisor').join(', ');
            }

            // 2. Build the JSON Array of checked team members
            const checkboxes = matrixTeamContainer.querySelectorAll('input[type="checkbox"]');
            const newTeamArray = [];
            checkboxes.forEach(box => {
                if (box.checked) newTeamArray.push(box.dataset.tech);
            });

            // 3. Execute Database Update
            const { error } = await supabaseClient
                .from('profiles')
                .update({ 
                    role: updatedRole,
                    team_members: newTeamArray 
                })
                .eq('username', selectedUser);

            saveMatrixTeamBtn.disabled = false;
            saveMatrixTeamBtn.textContent = '💾 Save Team & Role';

            if (error) {
                alert("Error saving matrix team: " + error.message);
            } else {
                matrixTeamSavedMsg.style.display = 'block';
                setTimeout(() => matrixTeamSavedMsg.style.display = 'none', 3000);
            }
        });
    }
})();