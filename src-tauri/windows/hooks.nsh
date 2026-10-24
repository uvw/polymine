; Polymine keeps settings, history, and the saved game in %APPDATA%\Polymine,
; not in the identifier folders Tauri's uninstaller removes. Remove it too when
; the player ticks "Delete the application data", but never during an update.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$APPDATA\Polymine"
  ${EndIf}
!macroend

; Puts polymine-cli on the user's PATH. The CLI edits the registry itself,
; since NSIS strings stop at 1024 characters, shorter than many PATHs.
!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$INSTDIR\polymine-cli.exe"
    nsExec::Exec '"$INSTDIR\polymine-cli.exe" link'
    Pop $0
  ${EndIf}
!macroend

; Takes it off again, except during an update, which installs it right back.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIf} ${FileExists} "$INSTDIR\polymine-cli.exe"
    nsExec::Exec '"$INSTDIR\polymine-cli.exe" unlink'
    Pop $0
  ${EndIf}
!macroend
