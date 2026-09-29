param(
  [switch]$SkipPythonTests,
  [switch]$SkipPackage
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Read-JsonFile($Path) {
  Get-Content -Raw -Path $Path | ConvertFrom-Json
}

function Assert-Version($Name, $Actual, $Expected) {
  if ($Actual -ne $Expected) {
    throw "$Name version mismatch: expected $Expected, got $Actual"
  }
}

function Invoke-Native($Description, $FilePath, [string[]]$Arguments) {
  Write-Host ""
  Write-Host "==> $Description"
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE"
  }
}

$rootPackage = Read-JsonFile "package.json"
$frontendPackage = Read-JsonFile "frontend/package.json"
$version = [string]$rootPackage.version

$backendInit = Get-Content -Raw -Path "backend/ivfitter/__init__.py"
$backendPyproject = Get-Content -Raw -Path "backend/pyproject.toml"
$readme = Get-Content -Raw -Path "README.md"

if ($backendInit -notmatch '__version__\s*=\s*"([^"]+)"') {
  throw "Could not read backend __version__."
}
Assert-Version "backend __version__" $Matches[1] $version

if ($backendPyproject -notmatch 'version\s*=\s*"([^"]+)"') {
  throw "Could not read backend pyproject version."
}
Assert-Version "backend pyproject" $Matches[1] $version
Assert-Version "frontend package" ([string]$frontendPackage.version) $version

if ($readme -notmatch "Current version:\s+\*\*$([regex]::Escape($version))\*\*") {
  throw "README current version does not match $version."
}

Write-Host "Static release build for HM-IV-Fitter v$version"

Invoke-Native "Static browser production build" "npm.cmd" @("run", "build:static")
Invoke-Native "Frontend regression tests" "npm.cmd" @("run", "test:frontend", "--", "--reporter=dot")

if (-not $SkipPythonTests) {
  if (Test-Path ".venv/Scripts/python.exe") {
    $python = ".venv/Scripts/python.exe"
  } else {
    $python = "python"
  }
  $env:PYTHONPATH = "backend"
  Invoke-Native "Backend pytest suite" $python @("-m", "pytest", "-p", "no:cacheprovider", "backend/tests", "-q")
  Invoke-Native "Backend Python compile check" $python @("-m", "compileall", "-q", "backend/ivfitter", "backend/tests")
}

$required = @(
  "frontend/dist/index.html",
  "frontend/dist/browser-runtime.worker.js",
  "frontend/dist/static-python/manifest.json",
  "frontend/dist/static-python/ivfitter/browser_bridge.py"
)
foreach ($path in $required) {
  if (-not (Test-Path $path)) {
    throw "Static artifact is missing: $path"
  }
}

if (-not $SkipPackage) {
  $releaseDir = Join-Path $Root "release"
  $packageDir = Join-Path $releaseDir "hm-iv-fitter-static-v$version"
  $zipPath = Join-Path $releaseDir "hm-iv-fitter-static-v$version.zip"

  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  if (Test-Path $packageDir) {
    Remove-Item -LiteralPath $packageDir -Recurse -Force
  }
  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  New-Item -ItemType Directory -Force -Path $packageDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $Root "frontend/dist/*") -Destination $packageDir -Recurse
  Copy-Item -LiteralPath (Join-Path $Root "LICENSE") -Destination (Join-Path $packageDir "LICENSE.txt")
  Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force
  Write-Host "Created $zipPath"
}

Write-Host "Static release build completed."
