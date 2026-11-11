; electron-builder includes this in the NSIS installer (build/installer.nsh)

; Up to 1.6.0 the exe was "PZ Server Manager.exe" (and its uninstaller "Uninstall PZ Server
; Manager.exe"). Installing over one of those runs its uninstaller first, which removes them.
; If that couldn't finish, they'd be left next to the new exe, so make sure they're gone
!macro customInstall
  Delete "$INSTDIR\PZ Server Manager.exe"
  Delete "$INSTDIR\Uninstall PZ Server Manager.exe"
!macroend
