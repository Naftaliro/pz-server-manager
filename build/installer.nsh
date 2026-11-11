; electron-builder includes this in the NSIS installer (build/installer.nsh)

; The exe is still "PZ Server Manager.exe" in 1.6: 1.5.1 and older update themselves from the zip
; and only look for an exe with their own name, so renaming it now would break their update.
; 1.6's updater knows both names, so a later version can be "Knox Launcher.exe". When it is,
; installing over an old copy runs the old uninstaller first, which removes the old exe; if that
; couldn't finish, the old files would be left next to the new exe, so they're deleted here.
; Only when the name really changed, or this would delete the exe that was just installed
!macro customInstall
  !if "${APP_EXECUTABLE_FILENAME}" != "PZ Server Manager.exe"
    Delete "$INSTDIR\PZ Server Manager.exe"
    Delete "$INSTDIR\Uninstall PZ Server Manager.exe"
  !endif
!macroend
