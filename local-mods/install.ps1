# Installs the fix mods from this folder into your Project Zomboid mods folder.
# Run this in PowerShell (works on the PowerShell that comes with Windows):
#
#   irm https://raw.githubusercontent.com/Naftaliro/pz-server-manager/main/local-mods/install.ps1 | iex
#
# Run it again any time to update. It only touches the folders it installs.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$branch = if ($env:PZM_BRANCH) { $env:PZM_BRANCH } else { 'main' }
$zipUrl = "https://github.com/Naftaliro/pz-server-manager/archive/refs/heads/$branch.zip"
$target = Join-Path $env:USERPROFILE 'Zomboid\mods'
$work = Join-Path ([IO.Path]::GetTempPath()) ("pzm-local-mods-" + [Guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    Write-Host "Downloading fix mods..."
    $zip = Join-Path $work 'repo.zip'
    Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
    Expand-Archive -LiteralPath $zip -DestinationPath $work -Force

    $source = Get-ChildItem -Path $work -Directory | ForEach-Object { Join-Path $_.FullName 'local-mods' } | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $source) { throw "local-mods folder not found in the download" }

    New-Item -ItemType Directory -Force -Path $target | Out-Null
    foreach ($mod in Get-ChildItem -Path $source -Directory) {
        $dest = Join-Path $target $mod.Name
        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
        Copy-Item -Recurse -Path $mod.FullName -Destination $dest
        Get-ChildItem -Path $dest -Recurse -Filter '.gitkeep' | Remove-Item -Force
        Write-Host "  installed $($mod.Name)"
    }
    Write-Host "Done. Mods are in $target" -ForegroundColor Green
}
catch {
    Write-Host "Install failed: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if (Test-Path $work) { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }
}
