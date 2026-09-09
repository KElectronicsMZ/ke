#SingleInstance, force
#NoEnv
SetWorkingDir %A_ScriptDir%

; --- LOCAL SCRIPT EXPIRATION SAFETY GATEKEEPER ---
; Target expiration stamp: July 1st, 2026 (Format: YYYYMMDD)
ExpirationDate := "20261001" ;chnge this to add more time

; A_YYYY . A_MM . A_DD builds today's local date string (e.g., 20260616)
CurrentLocalDate := A_YYYY . A_MM . A_DD

if (CurrentLocalDate >= ExpirationDate)
{
    MsgBox, 16, License Expired, `nPlease contact the administrator. Exiting script.
    ExitApp
}
; --- END OF SAFETY GATEKEEPER ---

; Global variables for the custom route GUI interaction
global GuiRouteChoice := ""
global GuiSubAreasText := ""
global GuiNewKeyword := ""
global GuiAddressText := ""
global RouteList := []
global RouteData := {}

; --- FLOATING HOTKEY MENU ---
Gui, HelpMenu:+AlwaysOnTop -Caption +ToolWindow +Border
Gui, HelpMenu:Color, 2C3E50 ; Dark blue-gray background
Gui, HelpMenu:Font, s10 cWhite, Segoe UI
Gui, HelpMenu:Add, Text, w200 Center, 🚀 Order Collector
Gui, HelpMenu:Add, Text, w200, --------------------------
Gui, HelpMenu:Add, Text, w200, [Ctrl + 1] Extract Order
Gui, HelpMenu:Add, Text, w200, [Ctrl + 2] Parse Line Map
Gui, HelpMenu:Add, Text, w200, [Alt + W] Auto Collect (ALL BRANCHES) ;COPY A LIST OF ALL ORDERS AND NEXT EACH ORDERE'S CELL IT'S AREA - DOWNLOADED EXCEL SHEET FROM GSPN
Gui, HelpMenu:Add, Text, w200, [Alt + E] Auto Collect (PER BRANCH) ;COPY A LIST OF ALL ORDERS IN ONE BRANCH ( A LITTLE FATSTER)
Gui, HelpMenu:Add, Text, w200, [Ctrl+Alt+S] Send Hass
Gui, HelpMenu:Add, Text, w200, [Ctrl + 3] Log Mouse Pos

; 1. Show the GUI completely hidden first so AHK calculates its final dimensions
Gui, HelpMenu:Show, Hide, Script Helper

; ---> NEW: Allow AHK to "see" the hidden window we just created
DetectHiddenWindows, On

; 2. Extract the calculated Width (GuiW) and Height (GuiH) of the hidden window
WinGetPos, , , GuiW, GuiH, Script Helper

; ---> NEW: Turn it back off immediately so we don't interfere with other scripts
DetectHiddenWindows, Off

; 3. Get the exact working area of the primary monitor (ignores the Windows Taskbar)
SysGet, WorkArea, MonitorWorkArea

; 4. Calculate the bottom-right coordinates with a 15-pixel aesthetic margin
PosX := WorkAreaRight - GuiW - 15
PosY := WorkAreaBottom - GuiH - 15

; 5. Render the GUI at the dynamic coordinates without stealing focus
Gui, HelpMenu:Show, x%PosX% y%PosY% NoActivate, Script Helper

^5::
Reload
return

; Press Ctrl+1 to trigger the parsing tool
^1:: ;collect order
extractOrder()
return

^2:: ;collect all text on the page in numbered lines
getFullList()
return

!e::
autoCollectOrders()
return

^!s::
sendHass()
return

; You can assign a new hotkey for this specific function.
; For example, Alt+W will trigger it:
!w::
autoCollectOrdersByBranch()
return

; Helper function to scrub structural whitespace characters
CleanVariable(VarToClean)
{
    VarToClean := StrReplace(VarToClean, "`r", "")
    VarToClean := StrReplace(VarToClean, "`n", "")
    VarToClean := StrReplace(VarToClean, "`t", A_Space)
    return Trim(VarToClean)
}

; Helper function to escape data safely for Excel CSV format
EscapeCSV(value)
{
    if (InStr(value, ",") || InStr(value, """") || InStr(value, "`n") || InStr(value, "`r"))
    {
        value := StrReplace(value, """", """""") ; Double up existing quotes
        return """" . value . """" ; Wrap the field in quotes
    }
    return value
}

getFullList()
{
    Clipboard := ""
    Send ^a
    Sleep, 200
    Send, ^c
    Sleep, 200

    ClipWait, 1
    if ErrorLevel
    {
        MsgBox, 16, Error, Failed to copy text from the page.
        return
    }

    displayOutput := "Line Index Map:`n================================================================================`n"

    Loop, Parse, Clipboard, `n, `r
    {
        cleanedLine := CleanVariable(A_LoopField)
        if (cleanedLine = "")
            continue

        displayOutput .= A_Index . " - " . cleanedLine . "`n"
    }

    Clipboard := displayOutput
    MsgBox, 0, Success, The complete sequential line map has been copied to your clipboard!
}

extractOrder()
{
    global GuiRouteChoice
    global GuiSubAreasText
    global RouteData

    ; --- CLIPBOARD RETRY LOOP WITH TIMED PROMPT START ---
    Loop
    {
        Clipboard := ""
        Send, ^a
        Sleep, 150
        Send, ^c
        ClipWait, 1

        Line12 := "", Line18 := "", Line61 := ""
        LineIndex := 0

        ; Parse the clipboard exactly like getFullList()
        Loop, Parse, Clipboard, `n, `r
        {
            cleanedLine := CleanVariable(A_LoopField)
            if (cleanedLine = "")
                continue

            LineIndex++

            ; Capture the specific iterations
            if (LineIndex = 12)
                Line12 := cleanedLine
            else if (LineIndex = 18)
                Line18 := cleanedLine
            else if (LineIndex = 61)
                Line61 := cleanedLine
            ; Break early if we've hit our max required line to save processing time
            if (LineIndex >= 62)
                break
        }
        ; Check if lines 12, 18, and 61 actually exist and contain data
        if (Line12 != "" && Line18 != "" && Line61 != "")
        {
            break ; Page is fully loaded!
        }
        
        MsgBox, 4116, GSPN Status, Page data not fully detected yet .`n`nDo you want to STOP the collection process?`nRetrying automatically in (10) seconds..., 10

        IfMsgBox, Yes
        {
            Reload
            return
        }

        Sleep, 200
    }
    ; --- CLIPBOARD RETRY LOOP WITH TIMED PROMPT END ---


    ;defining vars
    SO := "", CreatedBy := "", Branch := "", DateOnly := "", TimeOnly := "", CustName := ""
    Phone1 := "", Phone2 := "", Phone3 := ""
    StreetVal := "", CityVal := "", ModelVal := "", SerialVal := ""
    WtyStatus := "", RemarkVal := "", StatusCommentVal := ""
    GlobalOrderStatus := "", GlobalOrderReason := "", ServiceType := ""
    ChangeLogList := ""
    Rout := ""
    call_details := ""

    PartsArray := []

    InsideProductInfo := False
    InsidePartsInfo := False
    InsideChangeLog := False
    InsideCallDetails := False
    modelFlag := False
    serialFlag := False
    LogCounter := 1
    
    
    Loop, Parse, Clipboard, `n, `r
    {
        cleanedLine := CleanVariable(A_LoopField)
        if (cleanedLine = "")
            continue

        ; 1. SO Extraction
        if (InStr(cleanedLine, "General Information (") = 1)
        {
            RegExMatch(cleanedLine, "\(\s*(\d+)\s*\)", match)
            SO := match1
        }
        ; 2. Created By Extraction
        else if InStr(cleanedLine, "Created By")
        {
            pos := InStr(cleanedLine, "Created By")
            if (pos > 0)
            {
                tempVal := SubStr(cleanedLine, pos + 11)
                tempVal := Trim(tempVal)
                RegExMatch(tempVal, "^([^\s(]+)", match)
                if (match1 != "")
                    CreatedBy := match1
            }
        }
        ; 3. Branch & Date Extraction
        else if InStr(cleanedLine, "Service Branch")
        {
            parts := StrSplit(cleanedLine, "/")
            if (parts.MaxIndex() >= 3)
            {
                rawBranchPart := parts[3]
                datePos := InStr(rawBranchPart, "Date")
                if (datePos)
                    Branch := Trim(SubStr(rawBranchPart, 1, datePos - 1))
                else
                    Branch := Trim(rawBranchPart)
            }
            RegExMatch(cleanedLine, "Date\s+(.*)", match)
            dateParts := StrSplit(match1, A_Space)
            DateOnly := dateParts[1]
            TimeOnly := dateParts[2]
        }
        ; 4. Customer Name Extraction
        else if (InStr(cleanedLine, "Customer Information (") = 1)
        {
            RegExMatch(cleanedLine, "\(\s*(.*?)\s+\d+\s*\)", match)
            CustName := match1
        }
        ; 5. Phone Numbers Extraction
        else if InStr(cleanedLine, "Phone No")
        {
            phoneIndex := 1
            searchPos := 1
            while (searchPos := RegExMatch(cleanedLine, "\d{7,}", currentMatch, searchPos))
            {
                if (phoneIndex = 1)
                    Phone1 := currentMatch
                else if (phoneIndex = 2)
                    Phone2 := currentMatch
                else if (phoneIndex = 3)
                    Phone3 := currentMatch

                searchPos += StrLen(currentMatch)
                phoneIndex++
            }
        }
        ; 6. Address Handling (Street Line)
        else if InStr(cleanedLine, "Street")
        {
            StreetVal := cleanedLine
            StreetVal := StrReplace(StreetVal, "Street", "")
            StreetVal := StrReplace(StreetVal, "Zip Code", "")
            StreetVal := RegExReplace(StreetVal, "\s+\d+$", "")
            StreetVal := Trim(StreetVal)
        }
        ; 7. Address Handling (City/District Line)
        else if InStr(cleanedLine, "City/District")
        {
            CityVal := cleanedLine
            CityVal := StrReplace(CityVal, "City/District", "")
            CityVal := StrReplace(CityVal, "State/Country(Region)", "")
            CityVal := RegExReplace(CityVal, "\s+[A-Za-z\s]+[A-Z]{2}$", "")
            CityVal := Trim(CityVal)
        }
        ; Extract global Status and Reason
        else if InStr(cleanedLine, "Status/ Reason")
        {
            cleanStatusLine := StrReplace(cleanedLine, "Status/ Reason", "")
            statusParts := StrSplit(cleanStatusLine, "/")
            if (statusParts.MaxIndex() >= 1)
                GlobalOrderStatus := Trim(statusParts[1])
            if (statusParts.MaxIndex() >= 2)
                GlobalOrderReason := Trim(statusParts[2])
        }
        
        ; Extract Service Type using the strict portal dropdown list
        else if (InStr(cleanedLine, "Service Type") = 1) 
        {
            ;MsgBox,,, %cleanedLine%
            if InStr(cleanedLine, "Carry In")
                ServiceType := "Carry In"
            else if InStr(cleanedLine, "In Home")
                ServiceType := "In Home"
            else if InStr(cleanedLine, "Initial Installation")
                ServiceType := "Initial Installation"
            else if InStr(cleanedLine, "Inspection")
                ServiceType := "Inspection"
            else if InStr(cleanedLine, "Pickup Service")
                ServiceType := "Pickup Service"
            else if InStr(cleanedLine, "Return Handling")
                ServiceType := "Return Handling"
        }
        
        
        ; Global Remark Extraction
        if RegExMatch(cleanedLine, "^Remark\s+(.*)", remarkMatch)
        {
            extractedRemark := Trim(remarkMatch1)
            if (extractedRemark != "")
                RemarkVal := extractedRemark
            continue
        }

        ; Global Status Comment Extraction
        if RegExMatch(cleanedLine, "^Status Comment\s+(.*)", statusCommentMatch)
        {
            extractedComment := Trim(statusCommentMatch1)
            if (extractedComment != "")
                StatusCommentVal := extractedComment
            continue
        }

        ; Product Information
        if InStr(cleanedLine, "Product Information")
        {
            InsideProductInfo := True
            continue
        }

        if (InsideProductInfo)
        {
            if (cleanedLine = "Model")
            {
                modelFlag := True
                continue
            }
            if (modelFlag)
            {
                if RegExMatch(cleanedLine, "i)^(.+)\s[A-Z0-9]{4}$", modelMatch)
                    ModelVal := Trim(modelMatch1)
                else
                    ModelVal := cleanedLine

                modelFlag := False
                continue
            }

            if (cleanedLine = "Serial / IMEI")
            {
                serialFlag := True
                continue
            }
            if (serialFlag)
            {
                pDatePos := InStr(cleanedLine, "Prod.Date")
                if (pDatePos)
                    SerialVal := Trim(SubStr(cleanedLine, 1, pDatePos - 1))
                else
                    SerialVal := cleanedLine
                serialFlag := False
                continue
            }

            if RegExMatch(cleanedLine, "^[A-Z0-9]{2}$")
            {
                WtyStatus := cleanedLine
                InsideProductInfo := False
            }
        }

        ; Change Log
        if InStr(cleanedLine, "Change Log")
        {
            InsideChangeLog := True
            LogCounter := 1
            continue
        }
        else if InStr(cleanedLine, "Repair Part Information")
        {
            InsideChangeLog := False
        }

        if (InsideChangeLog)
        {
            if RegExMatch(cleanedLine, "^(\d{6})\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(.*)", logMatch)
            {
                remainingText := logMatch4
                if RegExMatch(remainingText, "(.*?)\s+(IH|OH)\s+(OW|IW|NA|LP)\s*(.*)", tableMatch)
                {
                    leftSide := Trim(tableMatch1)
                    rightSide := Trim(tableMatch4)

                    logUser := ""
                    logStatus := ""
                    logReason := ""
                    logComment := rightSide

                    if RegExMatch(leftSide, "^([A-Za-z0-9_]+)\s+(.*)", userMatch)
                    {
                        logUser := userMatch1
                        statusAndReason := Trim(userMatch2)

                        if (InStr(statusAndReason, "Assigned to Service Center") = 1) {
                            logStatus := "Assigned to Service Center"
                            logReason := Trim(SubStr(statusAndReason, 27))
                        } else if (InStr(statusAndReason, "Engineer Assigned") = 1) {
                            logStatus := "Engineer Assigned"
                            logReason := Trim(SubStr(statusAndReason, 18))
                        } else if (InStr(statusAndReason, "Pending") = 1) {
                            logStatus := "Pending"
                            logReason := Trim(SubStr(statusAndReason, 8))
                        } else if (InStr(statusAndReason, "Acknowledged (ASC)") = 1) {
                            logStatus := "Acknowledged (ASC)"
                            logReason := Trim(SubStr(statusAndReason, 19))
                        } else {
                            logStatus := statusAndReason
                        }
                    }

                    if (logReason = "")
                        logReason := "N/A"
                    if (logComment = "")
                        logComment := "N/A"

                    ChangeLogList .= "Log" . LogCounter . " : by (" . logUser . ") , " . logStatus . " , " . logReason . " , " . logComment . " | "
                    LogCounter++
                }
            }
        }

        ; Parts & Call Details
        else if InStr(cleanedLine, "Repair Part Information")
        {
            InsidePartsInfo := True
            continue
        }
        else if InStr(cleanedLine, "Interaction History")
        {
            InsidePartsInfo := False
            InsideCallDetails := True
            continue
        }
        else if InStr(cleanedLine, "Related Document")
        {
            InsideCallDetails := False
        }

        if (InsidePartsInfo)
        {
            if RegExMatch(cleanedLine, "^\d{4}\s+")
            {
                partFields := StrSplit(cleanedLine, " ")
                actualPartNo := ""
                actualQty := ""

                for idx, field in partFields
                {
                    cleanField := Trim(field)
                    if (cleanField = "")
                        continue

                    if (actualPartNo = "" && RegExMatch(cleanField, "^[A-Z]{2}\d{2}-\d{5}[A-Z]$"))
                    {
                        actualPartNo := cleanField

                        lookAheadIdx := idx + 1
                        while (lookAheadIdx <= partFields.MaxIndex())
                        {
                            nextField := Trim(partFields[lookAheadIdx])
                            if (RegExMatch(nextField, "^\d{10}$"))
                                break

                            if (nextField != "" && RegExMatch(nextField, "^\d+$"))
                                actualQty := nextField

                            lookAheadIdx++
                        }
                    }
                }

                if (actualPartNo != "")
                {
                    if (actualQty = "")
                        actualQty := "1"

                    PartsArray.Push({Part: actualPartNo, Qty: actualQty})
                }
            }
        }

        if (InsideCallDetails)
        {
            if (call_details = "")
                call_details := cleanedLine
            else
                call_details .= " | " . cleanedLine
        }
    }

    FinalAddress := CleanVariable(StreetVal . " " . CityVal)
    ChangeLogList := RTrim(ChangeLogList, " | ")

    ; --- DYNAMIC ROUTE & FILE SCANNER ENGINE (TABLE VERSION) ---
    AreaFile := A_ScriptDir . "\knownareas_table.txt"
    matchFound := False
    Rout := ""
    RouteList := []
    RouteData := {}

    if FileExist(AreaFile)
    {
        Loop, Read, %AreaFile%
        {
            ; Handle the first row (Headers / Main Routes)
            if (A_Index = 1) 
            {
                headers := StrSplit(A_LoopReadLine, A_Tab)
                for _, h in headers
                {
                    cleanH := Trim(h)
                    if (cleanH != "") {
                        RouteList.Push(cleanH)
                        RouteData[cleanH] := "" ; Initialize dictionary
                    }
                }
                continue
            }

            ; Handle the data rows (Sub Areas)
            rowCells := StrSplit(A_LoopReadLine, A_Tab)
            for colIdx, cellValue in rowCells
            {
                cleanSub := Trim(cellValue)
                if (cleanSub = "")
                    continue

                mainRoute := RouteList[colIdx]

                ; Store comma-separated list for the GUI fallback window
                if (RouteData[mainRoute] = "")
                    RouteData[mainRoute] := cleanSub
                else
                    RouteData[mainRoute] .= "," . cleanSub

                ; Check if the area matches the address
                if (!matchFound && InStr(FinalAddress, cleanSub))
                {
                    Rout := mainRoute
                    matchFound := True
                }
            }
        }
    }

    ; If no automatic route matches, open the interactive layout
    if (!matchFound)
    {
        GuiRouteChoice := ""
        GuiSubAreasText := ""

        Gui, RouteManual:Destroy
        Gui, RouteManual:+AlwaysOnTop +OwnDialogs
        Gui, RouteManual:Font, s10, Segoe UI

        dropdownString := ""
        hasUnknown := False

        ; Check for 'unknown' in the existing list and set it as the default
        for idx, rName in RouteList
        {
            if (rName = "unknown" || rName = "Unknown") {
                dropdownString .= rName . "||"
                hasUnknown := True
            } else {
                dropdownString .= rName . "|"
            }
        }

        ; If 'Unknown' is not in the knownareas.txt file yet, prepend it as the default
        if (!hasUnknown) {
            dropdownString := "Unknown||" . dropdownString
        }

        Gui, RouteManual:Add, Text, x490 y15 w300, Select Main Area (ROUT):
        Gui, RouteManual:Add, DropDownList, x490 y40 w300 vGuiRouteChoice gUpdateSubAreas, %dropdownString%
        Gui, RouteManual:Add, Text, x490 y85 w300, Current Order Full Address:
        Gui, RouteManual:Add, Edit, x490 y105 w300 r3 ReadOnly -TabStops, %FinalAddress%
        Gui, RouteManual:Add, Text, x15 y15 w450, Sub Areas (Modify or add keywords separated by commas):
        Gui, RouteManual:Add, Edit, x15 y40 w450 r6 vGuiSubAreasText,

        Gui, RouteManual:Add, Button, x270 y200 w100 gRouteGuiOK Default, OK
        Gui, RouteManual:Add, Button, x380 y200 w100 gRouteGuiCancel, Cancel

        Gui, RouteManual:Show, w810 h250, Route Manual Selector

        TimeoutDuration := 5000
        CheckInterval := 100
        ElapsedTime := 0

        Loop
        {
            if !WinExist("Route Manual Selector")
                break

            if (A_TimeIdlePhysical < CheckInterval)
            {
                ElapsedTime := 0
            }
            else
            {
                ElapsedTime += CheckInterval
            }

            if (ElapsedTime >= TimeoutDuration)
            {
                Rout := ""
                Gui, RouteManual:Destroy
                break
            }

            Sleep, %CheckInterval%
        }
    }

    ; --- MODEL CATEGORY SUFFIX ENGINE ---
    if (Rout != "")
    {
        upperModel := Format("{:U}", ModelVal)

        if (SubStr(upperModel, 1, 2) = "UA"
         || SubStr(upperModel, 1, 2) = "LH"
         || SubStr(upperModel, 1, 2) = "HG"
         || SubStr(upperModel, 1, 2) = "PS"
         || SubStr(upperModel, 1, 2) = "QA"
         || SubStr(upperModel, 1, 2) = "LS"
         || InStr(upperModel, "VDE"))
        {
            Rout := Rout . "_TV"
        }
        else if (SubStr(upperModel, 1, 2) = "RT"
              || SubStr(upperModel, 1, 2) = "RS"
              || SubStr(upperModel, 1, 2) = "WW"
              || SubStr(upperModel, 1, 2) = "WA"
              || SubStr(upperModel, 1, 2) = "RB"
              || InStr(upperModel, "REF")
              || InStr(upperModel, "WSM"))
        {
            Rout := Rout . "_HA"
        }
        else if (SubStr(upperModel, 1, 2) = "AR"
            || InStr(upperModel, "ACN"))
        {
            Rout := Rout . "_AC"
        }
    }

    PartsDisplay := ""
    for index, partObj in PartsArray
    {
        if (PartsDisplay != "")
            PartsDisplay .= " - "
        PartsDisplay .= partObj.Part . " - (" . partObj.Qty . ")"
    }

; --- BUILD FORMATTED CLIPBOARD OUTPUT ---
    CleanedSummary := "so : " . SO . "`n"
                    . "created_by : " . CreatedBy . "`n"
                    . "branch : " . Branch . "`n"
                    . "date : " . DateOnly . " " . TimeOnly . "`n"
                    . "days : " . DaysPassed . "`n"
                    . "status : " . GlobalOrderStatus . "`n"
                    . "reason : " . GlobalOrderReason . "`n"
                    . "name : " . CustName . "`n"
                    . "phone : " . Phone1 . "`n"
                    . "phone_2 : " . Phone2 . "`n"
                    . "phone_3 : " . Phone3 . "`n"
                    . "address : " . FinalAddress . "`n"
                    . "rout : " . Rout . "`n"
                    . "model : " . ModelVal . "`n"
                    . "serial : " . SerialVal . "`n"
                    . "io : " . WtyStatus . "`n"
                    . "remark : " . RemarkVal . "`n"
                    . "status_comment : " . StatusCommentVal . "`n"
                    . "change_log : " . ChangeLogList . "`n"
                    . "return : " . ReturnNum . "`n"
                    . "call_details : " . call_details . "`n"

    ; Loop through the parts array to format them dynamically like part_1 : data
    for index, partObj in PartsArray
    {
        CleanedSummary .= "part_" . index . " : " . partObj.Part . "`n"
                        . "qty_" . index . " : " . partObj.Qty . "`n"
    }

    ; Send the beautifully formatted list directly to the clipboard
    Clipboard := CleanedSummary

    ; Show the popup confirmation
    MsgBox, 0, Clean Extraction Complete, Cleaned order records copied to Clipboard!`n`n%CleanedSummary% , 0.5

    csvFile := A_ScriptDir . "\orders.csv"
    MaxParts := 5

    if !FileExist(csvFile)
    {
        headers := "so,created_by,branch,date,days,status,reason,service_type,name,phone,phone_2,phone_3,address,rout,model,serial,io,remark,status_comment,change_log,return"
        Loop, %MaxParts%
        {
            headers .= ",part_" . A_Index . ",qty_" . A_Index
        }
        headers .= ",call_details,img1,img2,img3,vid1,vid2,vid3`n"
        FileAppend, %headers%, %csvFile%, UTF-8
    }

    ; --- CALCULATE DAYS PASSED ---
    dateUnits := StrSplit(DateOnly, ".")
    if (dateUnits.MaxIndex() = 3) {
        orderTimestamp := dateUnits[3] . dateUnits[1] . dateUnits[2]
        DaysPassed := A_Now
        EnvSub, DaysPassed, %orderTimestamp%, Days
    } else {
        DaysPassed := "N/A"
    }

    ; --- EXTRACT RETURN TRACKING NUMBER FROM REMARK ---
    ReturnNum := ""
    if RegExMatch(RemarkVal, "\b4\d{4,}\b", returnMatch)
    {
        ReturnNum := returnMatch
    }

    ; ====================================================================
    ; 1. BUILD THE CSV ROW (COMMA DELIMITED)
    ; ====================================================================
    csvRow := EscapeCSV(SO) . ","
           . EscapeCSV(CreatedBy) . ","
           . EscapeCSV(Branch) . ","
           . EscapeCSV(DateOnly) . ","
           . EscapeCSV(DaysPassed) . ","
           . EscapeCSV(GlobalOrderStatus) . ","
           . EscapeCSV(GlobalOrderReason) . ","
           . EscapeCSV(ServiceType) . ","
           . EscapeCSV(CustName) . ","
           . (Phone1 != "" ? EscapeCSV("'" . Phone1) : "") . ","
           . (Phone2 != "" ? EscapeCSV("'" . Phone2) : "") . ","
           . (Phone3 != "" ? EscapeCSV("'" . Phone3) : "") . ","
           . EscapeCSV(FinalAddress) . ","
           . EscapeCSV(Rout) . ","
           . EscapeCSV(ModelVal) . ","
           . EscapeCSV(SerialVal) . ","
           . EscapeCSV(WtyStatus) . ","
           . EscapeCSV(RemarkVal) . ","
           . EscapeCSV(StatusCommentVal) . ","
           . "" . ","  ; <--- EDITED: Prints blank. To restore, replace "" with: EscapeCSV(ChangeLogList)
           . EscapeCSV(ReturnNum)

    ; ====================================================================
    ; 2. BUILD THE TXT ROW (TAB DELIMITED FOR EXCEL)
    ; ====================================================================
    ; We use `t (Tab) here. Excel naturally reads tabs as separate columns.
    ; Notice we are actually writing ChangeLogList here instead of ""
    txtRow := SO . "`t"
           . CreatedBy . "`t"
           . Branch . "`t"
           . DateOnly . "`t"
           . DaysPassed . "`t"
           . GlobalOrderStatus . "`t"
           . GlobalOrderReason . "`t"
           . ServiceType . "`t"
           . CustName . "`t"
           . (Phone1 != "" ? "'" . Phone1 : "") . "`t"
           . (Phone2 != "" ? "'" . Phone2 : "") . "`t"
           . (Phone3 != "" ? "'" . Phone3 : "") . "`t"
           . FinalAddress . "`t"
           . Rout . "`t"
           . ModelVal . "`t"
           . SerialVal . "`t"
           . WtyStatus . "`t"
           . RemarkVal . "`t"
           . StatusCommentVal . "`t"
           . " " . "`t" ; <--- Writing the actual data to the text file (change_log) which is a big chunk of text so it's " "
           . ReturnNum

    ; ====================================================================
    ; 3. HANDLE THE PARTS ARRAY LOOP FOR BOTH FILES
    ; ====================================================================
    Loop, %MaxParts%
    {
        if (A_Index <= PartsArray.MaxIndex())
        {
            ; Add parts to the CSV with Commas
            csvRow .= "," . EscapeCSV(PartsArray[A_Index].Part) . "," . EscapeCSV(PartsArray[A_Index].Qty)
            ; Add parts to the TXT with Tabs
            txtRow .= "`t" . PartsArray[A_Index].Part . "`t" . PartsArray[A_Index].Qty
        }
        else
        {
            ; Add empty comma placeholders to CSV
            csvRow .= ",,"
            ; Add empty tab placeholders to TXT
            txtRow .= "`t`t"
        }
    }

    ; ====================================================================
    ; 4. FINALIZE AND APPEND TO BOTH FILES
    ; ====================================================================
    ; Finalize CSV: Use "" for Call Details so it prints blank.
    ; To restore later, change "" to: EscapeCSV(call_details)
    csvRow .= "," . "" . ",,,,,,`n"

    ; Finalize TXT: Actually write the call_details using Tabs.
    txtRow .= "`t" . "" . "`t`t`t`t`t`t`n" ; use the follwing to make it write the full call details =>> txtRow .= "`t" . call_details . "`t`t`t`t`t`t`n"

    ; 1. Append to your normal orders.csv file
    FileAppend, %csvRow%, %csvFile%, UTF-8

    ; 2. Define the orders.txt path and append the tabbed data
    txtFile := A_ScriptDir . "\orders.txt"
    FileAppend, %txtRow%, %txtFile%, UTF-8
    Clipboard = %txtRow%
    MsgBox,,,Order %SO% collected , 1
    return
}

; ============================================================================
; GUI BUTTON TARGET LABELS SUBROUTINES
; ============================================================================

UpdateSubAreas:
    global RouteData
    global GuiRouteChoice
    Gui, RouteManual:Submit, NoHide
    GuiControl, RouteManual:, GuiSubAreasText, % RouteData[GuiRouteChoice]
return

RouteGuiOK:
    global Rout, RouteList, RouteData, GuiRouteChoice, GuiSubAreasText
    Gui, RouteManual:Submit

    Rout := GuiRouteChoice
    RouteData[Rout] := GuiSubAreasText

    ; --- REWRITE THE WHOLE knownareas_table.txt FILE ---
    AreaFile := A_ScriptDir . "\knownareas_table.txt"
    
    MaxRows := 0
    ColArrays := {}
    
    ; 1. Break the comma-separated data back into arrays and find the longest column
    for idx, mainArea in RouteList
    {
        areas := StrSplit(RouteData[mainArea], ",")
        ColArrays[idx] := areas
        if (areas.MaxIndex() > MaxRows)
            MaxRows := areas.MaxIndex()
    }

    ; 2. Build the Header Row
    newFileContent := ""
    for idx, mainArea in RouteList
    {
        newFileContent .= mainArea . (idx = RouteList.MaxIndex() ? "" : A_Tab)
    }
    newFileContent .= "`n"

    ; 3. Build the Data Rows
    Loop, %MaxRows%
    {
        rowIdx := A_Index
        for colIdx, mainArea in RouteList
        {
            val := Trim(ColArrays[colIdx][rowIdx])
            newFileContent .= val . (colIdx = RouteList.MaxIndex() ? "" : A_Tab)
        }
        newFileContent .= "`n"
    }

    ; 4. Save to file
    fileObj := FileOpen(AreaFile, "w")
    if IsObject(fileObj)
    {
        fileObj.Write(RTrim(newFileContent, "`n`r"))
        fileObj.Close()
    }
    
    Gui, RouteManual:Destroy
return

RouteGuiCancel:
    global Rout
    Rout := ""
    Gui, RouteManual:Destroy
return

autoCollectOrders()
{
    FileDelete, %A_ScriptDir%\orders.csv
    FileDelete, %A_ScriptDir%\orders.txt
    ; Read variables from the external config.txt file
    ConfigFile := A_ScriptDir . "\config.txt"

    ; If the file is missing, it defaults to your original hardcoded values
    IniRead, ST, %ConfigFile%, Timers, WaitTime, 500
    IniRead, EnterX, %ConfigFile%, Mouse_OrderEnter, X, 481
    IniRead, EnterY, %ConfigFile%, Mouse_OrderEnter, Y, 308
    IniRead, ViewX, %ConfigFile%, Mouse_OrderView, X, 330
    IniRead, ViewY, %ConfigFile%, Mouse_OrderView, Y, 807
    IniRead, ListX, %ConfigFile%, Mouse_ListBtn, X, 1833
    IniRead, ListY, %ConfigFile%, Mouse_ListBtn, Y, 192
    ; Read the X coordinate from the [Dropown_Branch] section of config.txt.
    ; Note: The section name is spelled exactly as it is in your config file ("Dropown_Branch").
    ; The '754' at the end is a fallback default just in case the config file is missing.
    IniRead, BranchX, %ConfigFile%, Branch_Dropdown, X, 754
    IniRead, BranchY, %ConfigFile%, Branch_Dropdown, Y, 244

    ClipText := Clipboard

    ; Count total lines
    ordersCount := 0
    Loop, Parse, ClipText, `n, `r
    {
        if (Trim(A_LoopField) != "")
            ordersCount++
    }

    if (ordersCount = 0) {
        ToolTip, No orders found in clipboard!
        Sleep, 2000
        ToolTip
        return
    }

    Loop, Parse, ClipText, `n, `r
    {
        if (Trim(A_LoopField) = "")
            continue

        ToolTip, Waiting for list page to load (Order %A_Index%)...

        ; --- WAIT FOR LIST PAGE TO FULLY LOAD ---
        Loop
        {
            Clipboard := ""
            Send, ^a
            Sleep, 200
            Send, ^c
            ClipWait, 1

            ; Check for the specific fields shown in the portal list view
            if (InStr(Clipboard, "VOC Flag") && InStr(Clipboard, "Wty Flag"))
            {
                Send, {Esc} ; Deselect the highlighted text before clicking
                break
            }
            Sleep, 1000
        }

        ToolTip, Processing Order %A_Index% of %ordersCount%... `n(%A_LoopField%)


        ; Exact Click 1 - Order Enter Location
        Click, %EnterX%, %EnterY%
        Sleep, %ST%
        Send, ^a
        Sleep, %ST%
        Send, %A_LoopField%
        Sleep, %ST%
        Send, {Enter}
        Sleep, %ST%
        

        
        ; Exact Click 2 - Orders View Location
        Sleep, %ST%
        Sleep, %ST%
        Sleep, %ST%
        Click, %ViewX%, %ViewY%
        Sleep, %ST%

        waitSomeTime(2)
        extractOrder()
        Sleep, %ST%

        ; Exact Click 3 - List Button Location
        Click, %ListX%, %ListY%
        Sleep, %ST%
    }

    ToolTip, 🎉 Collection Finished!
    Sleep, 3000
    ToolTip ; Clear tooltip
}


waitSomeTime(time)
{
	MsgBox,,, Waiting some time to be ready for next step `n if nothing happens this message will disappear after %time% seconds, %time%
}

sendHass()
{
    clipboardOriginal := Clipboard
    myInterval = 500

    if (StrLen(Clipboard) < 10) {
        MsgBox, 16, Error, Please copy Excel data to clipboard first!
        Clipboard := clipboardOriginal
        return
    }

    lines := StrSplit(Clipboard, "`n", "`r")

    for index, line in lines {
        if (line = "")
            continue

        fields := StrSplit(line, "`t")
        if (fields.MaxIndex() < 3)
            continue

        order := Trim(fields[1])
        model := Trim(fields[2])
        serial := Trim(fields[3])

        SendInput, %order%
        SendInput, {Enter}
        Sleep, %myInterval%

        SendInput, %model%
        SendInput, {Enter}
        Sleep, %myInterval%

        SendInput, %serial%
        SendInput, {Enter}
        Sleep, %myInterval%

        if (index < lines.MaxIndex()) {
            SendInput, ============================
            SendInput, {Enter}
            Sleep, %myInterval%
        }
    }

    Clipboard := clipboardOriginal
    MsgBox, 64, Complete, Processing finished!
}

; --- LOG MOUSE POSITION ---
^3::
    ; Get current mouse coordinates
    MouseGetPos, MouseX, MouseY

    ; Define the file path
    PosFile := A_ScriptDir . "\positionscollected.txt"

    ; Determine the next position index by counting existing "[position X]" headers
    Counter := 1
    if FileExist(PosFile)
    {
        FileRead, FileContent, %PosFile%
        ; Regex to count occurrences of [position
        RegExMatch(FileContent, "O)\[position (\d+)\]", Match)
        Loop, Parse, FileContent, `n, `r
        {
            if (RegExMatch(A_LoopField, "\[position (\d+)\]", OutputVar))
                Counter := OutputVar1 + 1
        }
    }

    ; Append the new data to the file
    FileAppend, [position %Counter%]`nX : %MouseX%`nY : %MouseY%`n, %PosFile%

    ; Brief confirmation
    ToolTip, Position %Counter% logged!
    SetTimer, RemoveToolTip, -1000
return

RemoveToolTip:
    ToolTip
return




autoCollectOrdersByBranch()
{
    FileDelete, %A_ScriptDir%\orders.csv
    FileDelete, %A_ScriptDir%\orders.txt
    ; 1. Read variables from the external config.txt file
    ConfigFile := A_ScriptDir . "\config.txt"
    IniRead, ST, %ConfigFile%, Timers, WaitTime, 500
    IniRead, EnterX, %ConfigFile%, Mouse_OrderEnter, X, 481
    IniRead, EnterY, %ConfigFile%, Mouse_OrderEnter, Y, 308
    IniRead, ViewX, %ConfigFile%, Mouse_OrderView, X, 330
    IniRead, ViewY, %ConfigFile%, Mouse_OrderView, Y, 807
    IniRead, ListX, %ConfigFile%, Mouse_ListBtn, X, 1833
    IniRead, ListY, %ConfigFile%, Mouse_ListBtn, Y, 192
    IniRead, BranchX, %ConfigFile%, Branch_Dropdown, X, 754
    IniRead, BranchY, %ConfigFile%, Branch_Dropdown, Y, 244


    ; 2. Build the Branch Dictionary from branches.txt
    BranchFile := A_ScriptDir . "\branches.txt"
    BranchData := {}

    if FileExist(BranchFile)
    {
        fileObj := FileOpen(BranchFile, "r", "UTF-8")
        if IsObject(fileObj)
        {
            currentMain := ""
            while !fileObj.AtEOF
            {
                currentLine := Trim(fileObj.ReadLine(), "`r`n ")
                if (currentLine = "")
                    continue

                ; Look for [main branch name]
                if (SubStr(currentLine, 1, 1) = "[" && SubStr(currentLine, 0) = "]")
                {
                    currentMain := SubStr(currentLine, 2, StrLen(currentLine) - 2)
                    BranchData[currentMain] := ""
                }
                else if (currentMain != "")
                {
                    BranchData[currentMain] := currentLine
                }
            }
            fileObj.Close()
        }
    }
    else
    {
        MsgBox, 16, Missing File, Please create 'branches.txt' in the script folder!
        return
    }

    ClipText := Clipboard

    ; 3. Count total lines to process
    ordersCount := 0
    Loop, Parse, ClipText, `n, `r
    {
        if (Trim(A_LoopField) != "")
            ordersCount++
    }

    if (ordersCount = 0) {
        ToolTip, No orders found in clipboard!
        Sleep, 2000
        ToolTip
        return
    }

    ; 4. Main Processing Loop
    Loop, Parse, ClipText, `n, `r
    {
        currentLine := Trim(A_LoopField)
        if (currentLine = "")
            continue

        ; When you copy 2 columns from Excel/Google Sheets, they are separated by a Tab (`t)
        fields := StrSplit(currentLine, A_Tab)

        ; Extract the two columns
        currentOrder := Trim(fields[1])
        currentLocation := Trim(fields[2])
        ;MsgBox,,,%currentOrder% is in %currentLocation%
        ToolTip, Waiting for list page to load (Order %currentOrder%)...

        ; --- WAIT FOR LIST PAGE TO FULLY LOAD ---
        Loop
        {
            Clipboard := ""
            Send, ^a
            Sleep, 200
            Send, ^c
            ClipWait, 1

            if (InStr(Clipboard, "VOC Flag") && InStr(Clipboard, "Wty Flag"))
            {
                Send, {Esc} ; Deselect the highlighted text before clicking
                break
            }
            Sleep, 1000
        }

        ToolTip, Processing Order %A_Index% of %ordersCount%... `nOrder: %currentOrder% `nLoc: %currentLocation%

        ; --- CHOOSING THE AREA ---
        matchedBranch := ""

        ; Loop through our loaded branches.txt data to find a match
        for mainBranch, subAreasString in BranchData
        {
            subAreas := StrSplit(subAreasString, ",")
            for each, subArea in subAreas
            {
                cleanSub := Trim(subArea)
                if (cleanSub != "" && InStr(currentLocation, cleanSub))
                {
                    matchedBranch := mainBranch
                    ;MsgBox,,,%matchedBranch%
                    break 2 ; Break out of both loops once a match is found
                }
            }
        }

        ; If a matching branch was found, interact with the dropdown
        if (matchedBranch != "")
        {
            ;MsgBox,,, %BranchX%, %BranchY%
            Click, %BranchX%, %BranchY% ;This is the location of the branch dorpdown list
            Sleep, %ST%

            Send, {Up 5}          ; Reset to the absolute top of the list
            Sleep, %ST%

            ; Send down arrows based on the main branch name
            if (InStr(matchedBranch, "alex"))
                Send, {Down 1}
            else if (InStr(matchedBranch, "kafr"))
                Send, {Down 2}
            else if (InStr(matchedBranch, "matrouh"))
                Send, {Down 3}

            Sleep, %ST%
            Send, {Enter}         ; Confirm dropdown selection
            Sleep, %ST%
            Sleep, 300           ; Brief extra wait for the page to register the branch change
        }
        ; --- END OF CHOOSING THE AREA ---
        ;MsgBox,,,area chosen
        ; Exact Click 1 - Order Enter Location
        Click, %EnterX%, %EnterY%
        Sleep, %ST%
        Send, ^a
        Sleep, %ST%
        Send, %currentOrder%      ; Type the specific order number from column 1
        Sleep, %ST%
        Send, {Enter}
        Sleep, %ST%
        Sleep, 1000               ; Give the site a second to filter the list
        ;MsgBox,,,order entered




        ; --- VERIFICATION CHECK WITH HARD SWEEP ---
        Clipboard := ""
        Send, ^a
        Sleep, 200
        Send, ^c
        ClipWait, 1
        Send, {Esc}               ; Deselect

        OrderFound := False

        ; 1. Initial Check: Parse the clipboard to see if the order is on line 66
        LineIndex := 0
        Loop, Parse, Clipboard, `n, `r
            {
                cleanedSweepLine := CleanVariable(A_LoopField)
                if (cleanedSweepLine = "")
                    continue

                ; Look for both the order number and 'Edit' in the sweep
                if (InStr(cleanedSweepLine, currentOrder) && InStr(cleanedSweepLine, "Edit"))
                {
                    OrderFound := True
                    break ; Stop parsing early once found
                }
            }


        ; 2. Hard Sweep Check: If it wasn't found, try all 3 branches
        if (!OrderFound)
        {
            ToolTip, Order %currentOrder% not found on initial try. Starting Hard Sweep...
            Sleep, 1000

            ; Array of down-arrow presses (1=alex, 2=kafr, 3=matrouh)
            SweepPresses := [1, 2, 3]
            SweepNames := ["alex", "kafr", "matrouh"]

            for idx, downPresses in SweepPresses
            {
                ToolTip, % "Sweeping branch: " . SweepNames[idx] . "..."

                ; -------------------------------------------------------------------------
                ; DYNAMIC DROPDOWN CLICK
                ; -------------------------------------------------------------------------
                ; to use the numbers it pulled from config.txt, rather than typing the literal letters.
                ;MsgBox,,, %BranchX%, %BranchY% ;This is the location of the branch dorpdown list
                Click, %BranchX%, %BranchY% ;This is the location of the branch dorpdown list
                Sleep, %ST%
                Send, {Up 5}          ; Reset to the top
                Sleep, %ST%
                Send, {Down %downPresses%}
                Sleep, %ST%
                Send, {Enter}
                Sleep, %ST%
                Sleep, 1000           ; Give the page a moment to process the branch change

                ; Re-enter the order number so the site searches this new branch
                Click, %EnterX%, %EnterY%
                Sleep, %ST%
                Send, {Enter}
                Click, 834, 468
                Sleep, %ST%
                Send, ^a
                Sleep, %ST%
                Send, %currentOrder%
                Sleep, %ST%
                Send, {Enter}
                Sleep, %ST%
                Sleep, 1000           ; Wait for list to filter

                ; Copy the page again
                Clipboard := ""
                Send, ^a
                Sleep, 200
                Send, ^c
                ClipWait, 1
                Send, {Esc}

                ; Parse the new clipboard entirely to check for the order
                Loop, Parse, Clipboard, `n, `r
                {
                    cleanedSweepLine := CleanVariable(A_LoopField)
                    if (cleanedSweepLine = "")
                        continue

                    ; Look for both the order number and 'Edit' in the sweep
                    if (InStr(cleanedSweepLine, currentOrder) && InStr(cleanedSweepLine, "Edit"))
                    {
                        OrderFound := True
                        break ; Stop parsing early once found
                    }
                }

                ; If we found it during the sweep, break out of the sweep loop!
                if (OrderFound)
                {
                    ToolTip, % "Order " . currentOrder . " found in " . SweepNames[idx] . "!"
                    Sleep, 1000
                    break
                }
            }
        }

        ; 3. Final Failure Check: If it failed all 3 branches, pause the script
        if (!OrderFound)
        {
            ToolTip ; Clear the tooltip
            MsgBox, 16, Order Not Found, Could not find order %currentOrder% in any of the 3 branches.`n`nThe script will now PAUSE. `n`nYou can manually check the GSPN page. When you are ready to skip this order and continue, right-click the green 'H' icon in your Windows taskbar and uncheck "Pause Script".,10

            ; Log the failure
            FileAppend, %currentOrder% - %currentLocation% (Failed All Branches)`n, %A_ScriptDir%\skipped_orders.txt

            ; This pauses the script entirely until you manually unpause it
            Pause, On

            ; Once you unpause, it skips the rest of the code for this order and moves to the next one
            continue
        }
        ; --- END VERIFICATION CHECK WITH HARD SWEEP ---


        ; Exact Click 2 - Orders View Location
        Click, %ViewX%, %ViewY%
        Sleep, %ST%

        waitSomeTime(2)
        extractOrder()
        Sleep, %ST%

        ; Exact Click 3 - List Button Location
        Click, %ListX%, %ListY%
        Sleep, %ST%
    }

    ToolTip, 🎉 2-Column Collection Finished!
    Sleep, 3000
    ToolTip ; Clear tooltip
}