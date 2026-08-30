-- agentdesk 的前台窗口探针（常驻）。
--
-- 为什么单独做成一个 app：辅助功能权限得锁在它身上。给终端或 node 授权，
-- 等于给它们跑的一切都开了读所有窗口的口子 —— 不能这么要求用户，开源更不能。
--
-- 它每 2 秒把「前台 app + 窗口标题」写进 ~/.agentdesk/foreground.txt，
-- agentdesk 只读这个文件，不碰任何权限。不想用了直接退出这个 app 即可。
property outFile : ((path to home folder as text) & ".agentdesk:foreground.txt")

on writeState()
	set appName to ""
	set winTitle to ""
	try
		tell application "System Events"
			set frontApp to first application process whose frontmost is true
			set appName to name of frontApp
			try
				set winTitle to value of attribute "AXTitle" of front window of frontApp
			on error tErr
				set winTitle to "!TITLE_ERR: " & tErr
			end try
		end tell
	on error aErr
		set appName to "!APP_ERR: " & aErr
	end try
	try
		set fh to open for access file outFile with write permission
		set eof fh to 0
		write (appName & tab & winTitle) to fh as «class utf8»
		close access fh
	on error
		try
			close access file outFile
		end try
	end try
end writeState

on run
	writeState()
end run

on idle
	writeState()
	return 2
end idle
