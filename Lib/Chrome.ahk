; Chrome.ahk v1.3 - "Connect Only" Mode
; (이미 켜진 크롬이 있으면, 절대 경로를 찾거나 실행하지 않음)
; ====================================================

class Chrome
{
    static DebugPort := 9222
    
    CliEscape(Param)
    {
        return """" RegExReplace(Param, "(\\*)""", "$1$1\""") """"
    }
    
    FindInstances()
    {
        Out := {}
        for Item in ComObjGet("winmgmts:").ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = 'chrome.exe'")
        {
            CommandLine := Item.CommandLine
            if RegExMatch(CommandLine, "i)--remote-debugging-port=(\d+)", Match)
                Out[Match1] := CommandLine
        }
        return Out.MaxIndex() ? Out : False
    }
    
    __New(ProfilePath:="", URLs:="about:blank", Flags:="", ChromePath:="", DebugPort:="")
    {
        if (DebugPort == "")
            DebugPort := this.DebugPort

        ; [핵심] 이미 9222 포트가 열려 있다면? -> 아무것도 묻지 말고 즉시 연결!
        if (Chrome.FindInstances()[DebugPort])
        {
            this.DebugPort := DebugPort
            return
        }

        ; --- 아래 코드는 크롬이 꺼져있을 때만 작동 (이 시나리오에선 안 쓰임) ---
        if (ChromePath == "")
            FileGetShortcut, %A_StartMenuCommon%\Programs\Google Chrome.lnk, ChromePath
        if (ChromePath == "")
            RegRead, ChromePath, HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe
        if !FileExist(ChromePath)
            throw Exception("Chrome could not be found")
        
        Run, % this.CliEscape(ChromePath)
        . " --remote-debugging-port=" DebugPort
        . (ProfilePath ? " --user-data-dir=" this.CliEscape(ProfilePath) : "")
        . (Flags ? " " Flags : "")
        . (URLs ? " " URLs : "")
        ,,, OutputVarPID
        
        this.PID := OutputVarPID
        this.DebugPort := DebugPort
    }
    
    GetPageList()
    {
        http := ComObjCreate("WinHttp.WinHttpRequest.5.1")
        http.Open("GET", "http://127.0.0.1:" this.DebugPort "/json")
        http.Send()
        return this.Jxon_Load(http.ResponseText)
    }
    
    GetPageBy(Key, Value, MatchMode:="exact", Index:=1)
    {
        Count := 0
        for n, PageData in this.GetPageList()
        {
            if (((MatchMode = "exact" && PageData[Key] = Value)
              || (MatchMode = "partial" && InStr(PageData[Key], Value))
              || (MatchMode = "startswith" && InStr(PageData[Key], Value) == 1)
              || (MatchMode = "regex" && PageData[Key] ~= Value))
              && ++Count == Index)
                return new this.Page(PageData.webSocketDebuggerUrl)
        }
    }
    
    GetPageByURL(Value, MatchMode:="exact", Index:=1)
    {
        return this.GetPageBy("url", Value, MatchMode, Index)
    }
    
    GetPageByTitle(Value, MatchMode:="exact", Index:=1)
    {
        return this.GetPageBy("title", Value, MatchMode, Index)
    }
    
    GetPage(Index:=1, Type:="page", MatchMode:="exact")
    {
        return this.GetPageBy("type", Type, MatchMode, Index)
    }
    
    class Page
    {
        Connected := False
        ID := 0
        Responses := []
        
        __New(wsurl)
        {
            this.wsurl := wsurl
            if IsObject(wsurl)
                this.wsurl := wsurl.webSocketDebuggerUrl
            this.BoundKeepAlive := this.KeepAlive.Bind(this)
        }
        
        Call(DomainAndMethod, Params:="", WaitForResponse:=True)
        {
            if !this.Connected
                this.Connect()
            
            if !IsObject(Params)
                Params := {}
            
            this.ID += 1
            this.ws.Send(Chrome.Jxon_Dump({"id": this.ID, "params": Params, "method": DomainAndMethod}))
            
            if !WaitForResponse
                return
            
            this.Responses[this.ID] := False
            while !this.Responses[this.ID]
                Sleep, 50
            
            Response := this.Responses.Delete(this.ID)
            if (Response.error)
                throw Exception("Chrome indicated error in response",, Chrome.Jxon_Dump(Response.error))
            
            return Response.result
        }
        
        Evaluate(JS)
        {
            Response := this.Call("Runtime.evaluate",
            ( LTrim Join
            {
                "expression": JS,
                "objectGroup": "console",
                "includeCommandLineAPI": Chrome.Jxon_True(),
                "silent": Chrome.Jxon_False(),
                "returnByValue": Chrome.Jxon_False(),
                "userGesture": Chrome.Jxon_True(),
                "awaitPromise": Chrome.Jxon_False()
            }
            ))
            
            if (Response.exceptionDetails)
				throw Exception(Response.result.description,, Chrome.Jxon_Dump(Response.exceptionDetails))
			
			return Response.result
		}
		
		Disconnect()
		{
			if !this.Connected
				return
			this.Connected := False
			this.ws.Disconnect()
			this.ws := ""
			BoundKeepAlive := this.BoundKeepAlive
			SetTimer, %BoundKeepAlive%, Off
		}
		
		Connect()
		{
			if this.Connected
				return
			this.ws := {"base": Chrome.WebSocket, "_Event": this.Event, "Parent": this}
			this.ws.__New(this.wsurl)
			while !this.ws.Ready()
				Sleep, 10
			this.Connected := True
			BoundKeepAlive := this.BoundKeepAlive
			SetTimer, %BoundKeepAlive%, 15000
		}
		
		KeepAlive()
		{
			this.Call("Browser.getVersion",, False)
		}
		
		Event(EventName, Event)
		{
			if this.Parent
				this := this.Parent
			
			if (EventName == "Open")
			{
				this.Connected := True
			}
			else if (EventName == "Message")
			{
				Data := Chrome.Jxon_Load(Event.data)
				Fn := this.Callback
				if IsFunc(Fn)
					%Fn%(Data)
				if this.Responses.HasKey(Data.id)
					this.Responses[Data.id] := Data
			}
			else if (EventName == "Close")
			{
				this.Disconnect()
			}
			else if (EventName == "Error")
			{
				throw Exception("Websocket Error!")
			}
		}
		
		WaitForLoad(Timeout:=0)
		{
			Start := A_TickCount
			while (this.Evaluate("document.readyState").value != "complete")
			{
				if (Timeout > 0 && A_TickCount - Start > Timeout)
					throw Exception("Timed out waiting for page to load")
				Sleep, 100
			}
		}
	}
	
	class WebSocket
	{
		__New(WS_URL)
		{
			static wb
			Gui, +hWndhOld
			Gui, New, +hWndhWnd
			this.hWnd := hWnd
			Gui, Add, ActiveX, vwb, Shell.Explorer
			Gui, %hOld%: Default
			wb.Navigate("about:<!DOCTYPE html><meta http-equiv='X-UA-Compatible' content='IE=edge'><body></body>")
			while (wb.ReadyState < 4)
				sleep, 50
			this.document := wb.document
			
			strCode := "var ws = null;"
			strCode .= "function open() {"
			strCode .= "  ws = new WebSocket('" . WS_URL . "');"
			strCode .= "  ws.onopen = function(event) { window.chrome_ahk_event('Open', event); };"
			strCode .= "  ws.onclose = function(event) { window.chrome_ahk_event('Close', event); };"
			strCode .= "  ws.onerror = function(event) { window.chrome_ahk_event('Error', event); };"
			strCode .= "  ws.onmessage = function(event) { window.chrome_ahk_event('Message', event); };"
			strCode .= "}"
			strCode .= "setTimeout(open, 10);"
			
			this.document.parentWindow.chrome_ahk_event := this._Event.Bind(this)
			this.document.parentWindow.execScript(strCode)
		}
		
		Send(Data)
		{
			this.document.parentWindow.ws.send(Data)
		}
		
		Ready()
		{
			if this.document.parentWindow.ws.readyState == 1
				return True
		}
		
		Disconnect()
		{
			this.document.parentWindow.ws.close()
		}
	}
	
	; ==============================================================================
	; INTEGRATED JXON METHODS
	; ==============================================================================
	
	Jxon_Load(ByRef src, args*)
	{
		static q := Chr(34)
		
		key := "", is_key := false
		stack := [ tree := [] ]
		is_arr := { (tree): 1 }
		next := q . "{[01234567890-tfn"
		pos := 0
		
		while ( (ch := SubStr(src, ++pos, 1)) != "" )
		{
			if InStr(" `t`n`r", ch)
				continue
			if !InStr(next, ch, true)
			{
				continue 
			}
			
			is_array := is_arr[obj := stack[1]]
			
			if i := InStr("{[", ch)
			{
				val := (proto := args[i]) ? new proto : {}
				is_array? ObjPush(obj, val) : obj[key] := val
				ObjInsertAt(stack, 1, val)
				
				is_arr[val] := !(is_key := ch == "{")
				next := q . (is_key ? "}" : "]")
			}
			else if InStr("}]", ch)
			{
				ObjRemoveAt(stack, 1)
				next := stack[1]==tree ? "" : is_arr[stack[1]] ? ",]" : ",}"
			}
			else if InStr(",:", ch)
			{
				is_key := (!is_array && ch == ",")
				next := is_key ? q : q . "{[0123456789-tfn"
			}
			else 
			{
				if (ch == q) 
				{
					i := pos
					while i := InStr(src, q,, i+1)
					{
						val := StrReplace(SubStr(src, pos+1, i-pos-1), "\\", "\u005C")
						if SubStr(val, 0) != "\"
							break
					}
					if !i ? (pos--, next := "'") : 0
						continue
					
					pos := i 
					
					  val := StrReplace(val,    "\/",  "/")
					, val := StrReplace(val, "\" . q,    q)
					, val := StrReplace(val,    "\b", "`b")
					, val := StrReplace(val,    "\f", "`f")
					, val := StrReplace(val,    "\n", "`n")
					, val := StrReplace(val,    "\r", "`r")
					, val := StrReplace(val,    "\t", "`t")
					
					i := 0
					while i := InStr(val, "\u",, i+1)
					{
						if (A_IsUnicode || Abs("0x" . SubStr(val, i+2, 4)) < 0x100)
							val := SubStr(val, 1, i-1) . Chr("0x" . SubStr(val, i+2, 4)) . SubStr(val, i+6)
					}
				}
				else 
				{
					val := SubStr(src, pos, i := RegExMatch(src, "[\]\},\s]|$",, pos)-pos)
					
					static null := "" 
					if InStr(",true,false,null,", "," . val . ",", true) 
						val := %val%
					else if (Abs(val) == "") 
					{
						pos--
						next := "#"
						continue
					}
					
					pos += i-1
				}
				
				is_array? ObjPush(obj, val) : obj[key] := val
				next := obj==tree ? "" : is_array ? ",]" : ",}"
			}
		}
		
		return tree[1]
	}
	
	Jxon_Dump(obj, indent:="", lvl:=1)
	{
		static q := Chr(34)
		
		if IsObject(obj)
		{
			static Type := Func("Type")
			if Type ? (Type.Call(obj) != "Object") : (ObjGetCapacity(obj) == "")
				return q . "" . q
			
			is_array := 0
			for k in obj
				is_array := k == A_Index
			until !is_array
			
			if (lvl < 0)
			{
				for k, v in obj
					i .= Chrome.Jxon_Dump(v, indent, lvl+1) . ","
			}
			else
			{
				for k, v in obj
					i .= (is_array ? "" : q . k . q . ":") . Chrome.Jxon_Dump(v, indent, lvl+1) . ","
			}
			return is_array ? "[" . SubStr(i, 1, -1) . "]" : "{" . SubStr(i, 1, -1) . "}"
		}
		
		if (obj == "")
			return "null"
		if (obj == true)
			return "true"
		if (obj == false)
			return "false"
			
		if obj is number
			return obj

		obj := StrReplace(obj,  "\",    "\\")
		obj := StrReplace(obj,  "/",    "\/")
		obj := StrReplace(obj,    q, "\" . q)
		obj := StrReplace(obj, "`b",    "\b")
		obj := StrReplace(obj, "`f",    "\f")
		obj := StrReplace(obj, "`n",    "\n")
		obj := StrReplace(obj, "`r",    "\r")
		obj := StrReplace(obj, "`t",    "\t")
		
		return q . obj . q
	}

	Jxon_True()
	{
		return true
	}

	Jxon_False()
	{
		return false
	}
}