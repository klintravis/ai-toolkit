$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sandboxRoot = Join-Path $env:TEMP 'ai-toolkit-installed-sandbox'
$userDataDir = Join-Path $sandboxRoot 'user-data'
$extensionsDir = Join-Path $sandboxRoot 'extensions'
$sampleToolkitDir = Join-Path $sandboxRoot 'sample-toolkit'
$userSettingsDir = Join-Path $userDataDir 'User'
$settingsPath = Join-Path $userSettingsDir 'settings.json'

function Get-CodeCommandLine {
  $codeCommand = Get-Command code.cmd -ErrorAction SilentlyContinue
  if (-not $codeCommand) {
    $codeCommand = Get-Command code-insiders.cmd -ErrorAction SilentlyContinue
  }

  if ($codeCommand) {
    return $codeCommand.Source
  }

  $candidates = @(
    (Join-Path $env:LocalAppData 'Programs\Microsoft VS Code\bin\code.cmd'),
    (Join-Path $env:LocalAppData 'Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd')
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw 'Unable to find the VS Code CLI. Install the `code` command or update the script candidates.'
}

function Ensure-Directory {
  param([string] $Path)

  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Write-File {
  param(
    [string] $Path,
    [string] $Content
  )

  Ensure-Directory -Path (Split-Path -Parent $Path)
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Initialize-SampleToolkit {
  Ensure-Directory -Path (Join-Path $sampleToolkitDir 'agents')
  Ensure-Directory -Path (Join-Path $sampleToolkitDir 'instructions')
  Ensure-Directory -Path (Join-Path $sampleToolkitDir 'prompts')
  Ensure-Directory -Path (Join-Path $sampleToolkitDir 'skills\review-repo')

  Write-File -Path (Join-Path $sampleToolkitDir 'agents\workspace-helper.agent.md') -Content @'
---
name: Workspace Helper
description: Helps inspect and explain the current workspace.
model: GPT-5.4
---

You are a practical workspace assistant. Read the repository, explain what it does, and suggest the smallest safe change that moves the task forward.
'@

  Write-File -Path (Join-Path $sampleToolkitDir 'instructions\safe-defaults.instructions.md') -Content @'
---
applyTo: "**"
---

Prefer small, reversible changes. Confirm existing build and test paths before adding new tooling.
'@

  Write-File -Path (Join-Path $sampleToolkitDir 'prompts\explain-repo.prompt.md') -Content @'
# Explain Repository

Summarize the project structure, the main entry points, and the fastest way to run it locally.
'@

  Write-File -Path (Join-Path $sampleToolkitDir 'skills\review-repo\SKILL.md') -Content @'
---
name: review-repo
description: Inspect a repository and highlight the highest-risk files and fastest validation path.
---

# Review Repo

Inspect the repository and call out the highest-risk files and the easiest way to validate behavior.
'@
}

function Initialize-Settings {
  Ensure-Directory -Path $userSettingsDir

  $toolkitParentName = Split-Path -Path (Split-Path -Path $sampleToolkitDir -Parent) -Leaf
  $toolkitLeafName = Split-Path -Path $sampleToolkitDir -Leaf
  $toolkitId = "$toolkitParentName/$toolkitLeafName"

  $settingsJson = @{
    'aiToolkit.toolkitPaths' = @($sampleToolkitDir)
    'aiToolkit.enabledToolkits' = @{
      $toolkitId = $true
    }
    'aiToolkit.configureCopilotSettings' = $false
    'workbench.startupEditor' = 'none'
  } | ConvertTo-Json -Depth 5

  Write-File -Path $settingsPath -Content $settingsJson
}

Push-Location $repoRoot

try {
  Ensure-Directory -Path $sandboxRoot
  Ensure-Directory -Path $userDataDir
  Ensure-Directory -Path $extensionsDir

  Initialize-SampleToolkit
  Initialize-Settings

  npm run compile
  if ($LASTEXITCODE -ne 0) {
    throw "Compile failed with exit code $LASTEXITCODE"
  }

  npm run package
  if ($LASTEXITCODE -ne 0) {
    throw "Packaging failed with exit code $LASTEXITCODE"
  }

  $vsix = Get-ChildItem -Path $repoRoot -Filter 'ai-toolkit-*.vsix' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $vsix) {
    throw 'Packaging finished, but no VSIX file was found.'
  }

  $codeExecutable = Get-CodeCommandLine

  & $codeExecutable --install-extension $vsix.FullName --extensions-dir $extensionsDir --user-data-dir $userDataDir --force
  if ($LASTEXITCODE -ne 0) {
    throw "Extension install failed with exit code $LASTEXITCODE"
  }

  & $codeExecutable --new-window --extensions-dir $extensionsDir --user-data-dir $userDataDir $repoRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Sandbox launch failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}