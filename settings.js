// ==========================================
// --- SETTINGS MANAGEMENT MODULE ---
// ==========================================

(function() {
    // 1. Grab the HTML elements using the EXACT IDs from your index.html
    const saveButton = document.getElementById('save-settings-btn');
    const newOrdersBox = document.getElementById('trigger-new-orders');
    const qaCompleteBox = document.getElementById('trigger-qa-complete');
    const dispatchLiveBox = document.getElementById('trigger-dispatch-live');
    const successMsg = document.getElementById('ccSettingsSavedMsg'); 
    const btnSettings = document.getElementById('btnSettings');

    // 2. Load the current settings from the database when the Settings page opens
    if (btnSettings) {
        btnSettings.addEventListener('click', async () => {
            const { data, error } = await supabaseClient
                .from('system_settings')
                .select('*')
                .eq('id', 1)
                .single();
            
            if (data && !error) {
                // Update the checkboxes to match the database
                newOrdersBox.checked = data.cc_trigger_new_order === true;
                qaCompleteBox.checked = data.cc_trigger_qa_complete === true;
                dispatchLiveBox.checked = data.cc_trigger_dispatch_live === true;
            } else if (error) {
                console.error("Could not load settings from database:", error);
            }
        });
    }

    // 3. Save the new settings when the button is clicked
    if (saveButton && newOrdersBox && qaCompleteBox && dispatchLiveBox) {
        saveButton.addEventListener('click', async function() {
            
            // Lock the button and change text so the user knows it's working
            saveButton.disabled = true;
            saveButton.textContent = 'Saving...';
            successMsg.style.display = 'none';

            // Prepare data matching your EXACT Supabase column names
            const settingsData = {
                cc_trigger_new_order: newOrdersBox.checked,
                cc_trigger_qa_complete: qaCompleteBox.checked,
                cc_trigger_dispatch_live: dispatchLiveBox.checked
            };

            console.log("Preparing to save:", settingsData);

            try {
                // Update the 'system_settings' table (Row ID 1)
                // We use 'supabaseClient' because that is your active connection from app.js
                const { error } = await supabaseClient
                    .from('system_settings') 
                    .update(settingsData)
                    .eq('id', 1);

                if (error) throw error;

                // Success! Restore button and show the success message
                saveButton.textContent = '💾 Save Settings';
                saveButton.disabled = false;
                successMsg.style.display = 'inline-block';
                
                // Hide the green success message automatically after 3 seconds
                setTimeout(() => {
                    successMsg.style.display = 'none';
                }, 3000);

            } catch (error) {
                console.error("Error saving:", error);
                alert('There was a problem saving your settings: ' + error.message);
                
                // Restore button if it fails
                saveButton.textContent = '💾 Save Settings';
                saveButton.disabled = false;
            }
        });
    }
})();