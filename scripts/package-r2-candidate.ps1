$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = Join-Path $projectRoot 'dist'
$releaseRoot = Join-Path $projectRoot 'release'
$manifest = Get-Content -LiteralPath (Join-Path $buildRoot 'release-manifest.json') -Raw | ConvertFrom-Json
$revision = $manifest.release.buildRevision
if ($revision -notmatch '^[a-f0-9]{16}$') { throw 'Invalid revision' }
$archivePath = Join-Path $releaseRoot "siege-zeke-simple-public-$revision-candidate.zip"
if (Test-Path -LiteralPath $archivePath) { throw 'Candidate ZIP already exists; do not overwrite it' }
& tar.exe -a -cf $archivePath -C $buildRoot .
if ($LASTEXITCODE -ne 0) { throw 'ZIP creation failed' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
$buildFiles = @(Get-ChildItem -LiteralPath $buildRoot -Recurse -File)
$verified = @()
try {
  $entries = @($archive.Entries | Where-Object { $_.Name })
  if ($entries.Count -ne $buildFiles.Count) { throw 'ZIP file count differs' }
  foreach ($entry in $entries) {
    $relative = $entry.FullName -replace '^\./', ''
    if ($relative.StartsWith('/') -or $relative.Contains('..') -or $relative.StartsWith('dist/')) { throw 'Unsafe ZIP path' }
    $disk = Join-Path $buildRoot $relative
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $zipHash = [Convert]::ToHexString($sha.ComputeHash($stream)).ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    $diskHash = (Get-FileHash -LiteralPath $disk -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($zipHash -ne $diskHash) { throw "ZIP bytes differ: $relative" }
    $verified += [ordered]@{ path = $relative; bytes = $entry.Length; sha256 = $zipHash }
  }
} finally { $archive.Dispose() }
$result = [ordered]@{
  status = 'candidate-package-verified-not-full-release-gate'
  revision = $revision
  archive = $archivePath
  sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  bytes = (Get-Item -LiteralPath $archivePath).Length
  files = $verified.Count
  publicApproved = $false
  deployed = $false
  entries = $verified
}
$result | ConvertTo-Json -Depth 5
