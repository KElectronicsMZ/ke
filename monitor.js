// --- MISSING DOM DECLARATIONS FOR NAVIGATION ---
const monitorPage = document.getElementById('monitorPage');


// NEW TRACKING DATASETS FOR MONITOR SPLIT
let monitorTrackingRows = []; 
let editedMonitorRows = {};  
const MONITOR_TABLE_NAME = 'repair_log'; // Your secondary table name in Supabase
let currentFilteredMonitorRows = [];

// --- NEW: LEADERBOARD & SORTING MEMORY ---
let globalUserProfiles = {}; // Caches roles so we know who is a tech vs coord
let techLeaderboardData = []; // Holds the active tech data for sorting
let coordLeaderboardData = []; // Holds the active coord data for sorting
let monitorSortConfig = { table: '', col: '', dir: 'desc' }; // Remembers what column you clicked

// Open Monitor Page from HUB Menu
document.getElementById('btnMonitor').addEventListener('click', () => {
    menuPage.classList.remove('active');
    monitorPage.classList.add('active');
    
    // --- NEW: SET DEFAULT DATES TO CURRENT MONTH ---
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    

    
    const formatInputDate = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    document.getElementById('monitorStartDate').value = formatInputDate(firstDay);
    document.getElementById('monitorEndDate').value = formatInputDate(now);
    // -----------------------------------------------

    // Call the engine once. It will automatically read the default "This Month" dates we just set!
    //loadMonitorDataEngine(); //this line is cmmmented to prevent the page from loading the table when it is opened 
});

// Back to HUB button inside Monitor Page
document.getElementById('monitorHubBtn').addEventListener('click', () => {
    if (Object.keys(editedMonitorRows).length > 0) {
        if (!confirm("You have unsaved monitoring changes. Are you sure you want to discard them?")) {
            return;
        }
    }
    editedMonitorRows = {};
    document.getElementById('monitorTableArea').style.display = 'none';
    document.getElementById('monitorSubmitBtn').style.display = 'none';
    document.getElementById('activeMonitorStatusHeader').textContent = 'Select a Status from the Left';
    monitorPage.classList.remove('active');
    menuPage.classList.add('active');
});

// Close Action Table inside Monitor Page
document.getElementById('closeMonitorTableBtn').addEventListener('click', () => {
    document.getElementById('monitorTableArea').style.display = 'none';
    document.getElementById('monitorSubmitBtn').style.display = 'none';
    document.getElementById('activeMonitorStatusHeader').textContent = 'Select a Status from the Left';
});

// --- 12. MONITOR ENGINE AND DATA INTERSECTION LOGIC ---
async function loadMonitorDataEngine() {
    
    const headerEl = document.getElementById('activeMonitorStatusHeader');
    if (headerEl) headerEl.textContent = 'Fetching specific date records... Please wait.';

    // 1. Get the dates from the screen first
    const startDateVal = document.getElementById('monitorStartDate').value;
    const endDateVal = document.getElementById('monitorEndDate').value;

    if (!startDateVal || !endDateVal) {
        alert("Please select both a start and end date.");
        if (headerEl) headerEl.textContent = 'Select a Status or Technician from the Left';
        return;
    }
    showGlobalLoader("Analyzing Monitor Logs..."); // Trigger Loader

    // 2. Generate the exact list of DD-MM-YYYY text strings to look for
    const start = new Date(startDateVal);
    const end = new Date(endDateVal);
    let dateStringsToFetch = [];
    
    let currentDay = new Date(start);
    while (currentDay <= end) {
        const dd = String(currentDay.getDate()).padStart(2, '0');
        const mm = String(currentDay.getMonth() + 1).padStart(2, '0');
        const yyyy = currentDay.getFullYear();
        dateStringsToFetch.push(`${dd}-${mm}-${yyyy}`);
        currentDay.setDate(currentDay.getDate() + 1); // Move loop to the next day
    }

    // 3. SERVER-SIDE FILTER: Only download logs that occurred on these specific dates
    const trackRows = await fetchAllRecords(MONITOR_TABLE_NAME, 'assign_date', dateStringsToFetch);
    
    // 4. Extract the unique SO numbers from the logs we just downloaded
    const uniqueSOs = [...new Set(trackRows.map(log => log.so))];

    // 5. SERVER-SIDE FILTER: Only download the specific orders tied to those SO numbers
    let mainOrders = [];
    if (uniqueSOs.length > 0) {
        mainOrders = await fetchAllRecords('orders', 'so', uniqueSOs);
    }
    
    // (Inside loadMonitorDataEngine)
    // Store in our master variables
    databaseOrders = mainOrders || [];
    monitorTrackingRows = trackRows || [];
    currentFilteredMonitorRows = monitorTrackingRows; 

    // --- NEW: FETCH ROLES TO SPLIT THE LEADERBOARD ---
    // If we haven't loaded the roles yet, ask the profiles table
    if (Object.keys(globalUserProfiles).length === 0) {
        const { data: profs } = await supabaseClient.from('profiles').select('username, role');
        if (profs) {
            profs.forEach(p => globalUserProfiles[p.username.trim()] = p.role.toLowerCase());
        }
    }

    
    calculateStatusMetrics();
    renderMonitorLeaderboard(currentFilteredMonitorRows); 
    
    hideGlobalLoader(); // Hide when finished rendering
}

// Bind Monitor CSV Export (Using PapaParse)
document.getElementById('monitorDownloadCsvBtn').addEventListener('click', () => {
    const tbody = document.getElementById('monitorTableBody');
    if (!tbody || tbody.children.length === 0) {
        alert("No visible Monitor data to export.");
        return;
    }

    // Extract headers dynamically
    const headers = Array.from(document.querySelectorAll('#monitorHeaderRow th')).map(th => th.textContent);
    
    // Extract visible rows text
    const csvData = [];
    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
        const rowData = Array.from(tr.querySelectorAll('td')).map(td => td.textContent);
        csvData.push(rowData);
    });

    // Generate CSV string using your existing PapaParse dependency
    const csv = Papa.unparse({
        fields: headers,
        data: csvData
    });

    // --- FIXED: UTF-8 BOM added safely without duplicate declarations ---
    const blob = new Blob(['\uFEFF' + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Monitor_Export_${new Date().getTime()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// ---LIGHTWEIGHT EXCEL-STYLE MONITOR FILTER ---
function filterMonitorTable() {
    const trs = document.getElementById('monitorTableBody').getElementsByTagName('tr');
    const inputs = document.getElementById('monitorHeaderRow').getElementsByTagName('input');
    
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
    }
}
// -------------------------------------------