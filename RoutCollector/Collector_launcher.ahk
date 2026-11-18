#NoEnv
SetWorkingDir %A_ScriptDir%
SetBatchLines, -1 ; Run at maximum speed for smooth GUI updates

; 1. Define paths and URL
OnlineScriptURL := "https://github.com/KElectronicsMZ/ke/raw/refs/heads/main/buildinapp_A.exe"
LocalScriptPath := A_ScriptDir . "\buildinapp.exe"
TempPath := A_ScriptDir . "\temp_update.exe"

; Bypass cache
Random, rand, 1, 999999
URL := OnlineScriptURL . "?v=" . rand

; 2. Close the running app so we can overwrite it later
Process, Close, buildinapp.exe
Sleep, 500

; 3. Build the Beautiful GUI (Matches your main app's dark theme)
Gui, Launcher: +AlwaysOnTop -Caption +Border +ToolWindow
Gui, Launcher: Color, 2C3E50, 34495E ; Dark blue-gray background
Gui, Launcher: Font, s12 cWhite wBold, Segoe UI
Gui, Launcher: Add, Text, x0 y15 w350 Center vStatusText, Connecting to Server...

Gui, Launcher: Font, s10 wNorm
; Adding a green (4CAF50) progress bar with a dark background (1A252F)
Gui, Launcher: Add, Progress, x25 y55 w300 h15 vProgBar c4CAF50 Background1A252F, 0
Gui, Launcher: Add, Text, x0 y80 w350 Center vPercentText, 0`%

; Calculate center of screen to display the splash screen
SysGet, ScreenWidth, 78
SysGet, ScreenHeight, 79
GuiX := (ScreenWidth / 2) - 175
GuiY := (ScreenHeight / 2) - 60
Gui, Launcher: Show, x%GuiX% y%GuiY% w350 h120, Updater

; 4. Get the Total File Size from GitHub first
TotalSize := 0
try {
    req := ComObjCreate("WinHttp.WinHttpRequest.5.1")
    req.Open("HEAD", URL, false)
    req.Send()
    TotalSize := req.GetResponseHeader("Content-Length")
}

; 5. Start the download in the background using Windows curl
if FileExist(TempPath)
    FileDelete, %TempPath%

GuiControl, Launcher:, StatusText, Downloading Update...
Run, %ComSpec% /c curl.exe -s -L "%URL%" -o "%TempPath%", , Hide, CmdPID

; 6. Monitor the download progress and animate the GUI
FakePercent := 0
Loop {
    ; Check if the background download process has finished
    Process, Exist, %CmdPID%
    if (!ErrorLevel) 
        break
    
    ; If GitHub gave us the total size, calculate the exact percentage
    if (TotalSize > 0) {
        FileGetSize, CurrentSize, %TempPath%
        if (!ErrorLevel && CurrentSize > 0) {
            Percent := (CurrentSize / TotalSize) * 100
            if (Percent > 100)
                Percent := 100
            GuiControl, Launcher:, ProgBar, %Percent%
            GuiControl, Launcher:, PercentText, % Round(Percent) . "%"
        }
    } 
    ; If GitHub hid the file size, use a smooth loading animation instead
    else {
        FakePercent += 2
        if (FakePercent > 100)
            FakePercent := 0
        GuiControl, Launcher:, ProgBar, %FakePercent%
        GuiControl, Launcher:, PercentText, Downloading...
    }
    
    Sleep, 100 ; Update the GUI every 100 milliseconds
}

; 7. Verify the download was successful
FileGetSize, FinalSize, %TempPath%
if (FinalSize > 0) {
    ; Max out the GUI so it looks complete
    GuiControl, Launcher:, ProgBar, 100
    GuiControl, Launcher:, PercentText, 100`%
    GuiControl, Launcher:, StatusText, Launching App...
    Sleep, 400 

    ; Safely overwrite the old app with the new one
    FileMove, %TempPath%, %LocalScriptPath%, 1
} 
else {
    Gui, Launcher: Destroy
    MsgBox, 16, Update Failed, Could not download the update. Check your internet connection.
}

; 8. Clean up GUI and launch the app
Gui, Launcher: Destroy

if FileExist(LocalScriptPath)
    Run, "%LocalScriptPath%"

ExitApp