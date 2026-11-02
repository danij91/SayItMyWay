$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifestPath = Join-Path $projectRoot 'extension/manifest.json'
$originalManifest = [System.IO.File]::ReadAllBytes($manifestPath)
$manifestText = [System.Text.Encoding]::UTF8.GetString($originalManifest)
$current = ($manifestText | ConvertFrom-Json).version
function Get-VersionParts([string]$value) {
    if ($value -notmatch '^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$') { throw 'Use 1-4 numeric components without leading zeros, for example 1.0.1.' }
    $parts = @($value.Split('.') | ForEach-Object { [int]::Parse($_) })
    if (($parts | Where-Object { $_ -gt 65535 }).Count -gt 0 -or ($parts | Measure-Object -Sum).Sum -eq 0) { throw 'Version components must be 0-65535, and the version cannot be all zeros.' }
    while ($parts.Count -lt 4) { $parts += 0 }
    return $parts
}
$parts = Get-VersionParts $current
$patch = '{0}.{1}.{2}' -f $parts[0], $parts[1], ($parts[2] + 1)
$minor = '{0}.{1}.0' -f $parts[0], ($parts[1] + 1)
$major = '{0}.0.0' -f ($parts[0] + 1)
Write-Host "Current version: $current"
Write-Host "1. Patch (fixes): $patch"
Write-Host "2. Minor (features): $minor"
Write-Host "3. Major (major changes): $major"
Write-Host '4. Enter a version manually'
Write-Host "5. Rebuild $current (replace its existing ZIP)"
Write-Host '0. Cancel (also Enter)'
while ($true) {
    $choice = Read-Host 'Choose 0-5'
    if ([string]::IsNullOrWhiteSpace($choice) -or $choice -eq '0') { Write-Host 'Cancelled.'; return }
    $version = switch ($choice) {
        '1' { $patch }
        '2' { $minor }
        '3' { $major }
        '4' { Read-Host 'New version' }
        '5' { $current }
        default { $null }
    }
    if (!$version) { Write-Host 'Choose a listed option.'; continue }
    try {
        $nextParts = Get-VersionParts $version
        if ($choice -ne '5' -and [version]($nextParts -join '.') -le [version]($parts -join '.')) { throw 'A new release must be newer than the current version. Use option 5 to rebuild.' }
        break
    } catch { Write-Host $_.Exception.Message }
}
$completed = $false
Push-Location $projectRoot
try {
    $updatedManifest = [regex]::Replace($manifestText, '("version"\s*:\s*")[^"]+("\s*,)', ('${1}' + $version + '${2}'))
    [System.IO.File]::WriteAllText($manifestPath, $updatedManifest, [System.Text.UTF8Encoding]::new($false))
    & node scripts/build-extension.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Extension build failed.' }
    $buildRoot = (Resolve-Path 'dist/extension').Path
    $manifest = Get-Content -LiteralPath (Join-Path $buildRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $version = $manifest.version
    if ($version -notmatch '^\d+(\.\d+){0,3}$') { throw 'Invalid manifest version.' }
    $output = Join-Path $projectRoot "dist/SayItMyWay-$version.zip"
    $temporary = Join-Path $projectRoot ('dist/package-' + [guid]::NewGuid().ToString('N') + '.zip')
    try {
        $archive = [System.IO.Compression.ZipFile]::Open($temporary, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            Get-ChildItem -LiteralPath $buildRoot -Recurse -File | Where-Object { $_.Name -ne '.crimsonmap-generated.json' } | ForEach-Object {
                $name = $_.FullName.Substring($buildRoot.Length + 1).Replace('\', '/')
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $name) | Out-Null
            }
            foreach ($name in @('LICENSE', 'THIRD_PARTY_NOTICES.md')) {
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $projectRoot $name), $name) | Out-Null
            }
        } finally { $archive.Dispose() }
        Move-Item -LiteralPath $temporary -Destination $output -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
    Write-Output "Release ZIP: $output"
    Get-FileHash -LiteralPath $output -Algorithm SHA256
    $completed = $true
} finally {
    if (!$completed) { [System.IO.File]::WriteAllBytes($manifestPath, $originalManifest) }
    Pop-Location
}
