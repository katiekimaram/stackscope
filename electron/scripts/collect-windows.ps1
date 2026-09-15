param([string]$OutputDirectory, [switch]$Performance, [switch]$Events, [switch]$Servicing, [switch]$FullReports)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$records = [System.Collections.Generic.List[object]]::new()
$processes = [System.Collections.Generic.List[object]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
function Record($kind, $category, $label, $value) {
    if ($null -ne $value -and "$value" -ne '') { $records.Add(@{kind=$kind; category=$category; label=$label; value="$value"}) }
}
function Step($label, [scriptblock]$action) {
    Write-Output $label
    try { & $action } catch { $warnings.Add("${label}: $($_.Exception.Message)") }
}
Step 'Reading hardware and Windows inventory' {
    $system = Get-CimInstance Win32_ComputerSystem
    Record hardware System 'Manufacturer' $system.Manufacturer
    Record hardware System 'Model' $system.Model
    Record hardware Memory 'Installed physical memory' ("{0:N0} MiB" -f ($system.TotalPhysicalMemory / 1MB))
    $os = Get-CimInstance Win32_OperatingSystem
    Record system Windows 'OS name' $os.Caption
    Record system Windows 'OS version' $os.Version
    Record system Windows 'Last boot time' ($os.LastBootUpTime.ToString('o'))
    Get-CimInstance Win32_Processor | ForEach-Object {
        Record hardware Processor 'Processor' $_.Name
        Record hardware Processor 'Logical processors' $_.NumberOfLogicalProcessors
    }
    Get-CimInstance Win32_VideoController | ForEach-Object {
        Record hardware Display 'Card name' $_.Name
        Record hardware $_.Name 'Driver version' $_.DriverVersion
    }
    Get-CimInstance Win32_DiskDrive | ForEach-Object { Record hardware Storage $_.Model ("{0:N1} GiB" -f ($_.Size / 1GB)) }
    Get-CimInstance Win32_BIOS | ForEach-Object { Record hardware BIOS 'BIOS version' $_.SMBIOSBIOSVersion }
}
Step 'Reading installed applications' {
    $keys = @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
    $apps = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object DisplayName | Sort-Object DisplayName, DisplayVersion -Unique
    foreach ($item in $apps) { Record software 'Installed applications' $item.DisplayName ("Version: {0}; Publisher: {1}" -f $item.DisplayVersion, $item.Publisher) }
    try { Get-AppxPackage -ErrorAction Stop | ForEach-Object { Record software 'Packaged applications' $_.Name ("Version: {0}; Publisher: {1}" -f $_.Version, $_.Publisher) } }
    catch { $warnings.Add('Packaged applications were unavailable for the current user.') }
}
Step 'Reading running processes' {
    Get-CimInstance Win32_Process | ForEach-Object {
        $processes.Add(@{name=$_.Name; pid="$($_.ProcessId)"; path="$($_.ExecutablePath)"; memoryMB=[math]::Round($_.WorkingSetSize / 1MB, 1)})
    }
    $warnings.Add('Protected process paths and applications installed for other users may be unavailable. Publisher signatures were not verified.')
}
if ($Performance) {
    Step 'Sampling CPU use for 30 seconds' {
        $before = @{}
        Get-Process | ForEach-Object { try { $before[$_.Id] = @{ cpu=$_.TotalProcessorTime.TotalSeconds; start=$_.StartTime.ToUniversalTime().Ticks } } catch {} }
        $clock = [System.Diagnostics.Stopwatch]::StartNew()
        Start-Sleep -Seconds 30
        $seconds = $clock.Elapsed.TotalSeconds
        $cores = [Environment]::ProcessorCount
        $rows = foreach ($p in Get-Process) {
            try {
                if ($p.Id -eq 0) { continue } # Idle time is not application CPU consumption.
                $first = $before[$p.Id]
                if ($null -eq $first -or $first.start -ne $p.StartTime.ToUniversalTime().Ticks) { continue }
                $cpu = [math]::Min(100, [math]::Max(0, ($p.TotalProcessorTime.TotalSeconds - $first.cpu) / $seconds / $cores * 100))
                $path = ''; try { $path = $p.Path } catch {}
                [pscustomobject]@{name=($p.ProcessName + '.exe'); cpuPercent=[math]::Round($cpu, 2).ToString([cultureinfo]::InvariantCulture); sampleSeconds=[math]::Round($seconds, 2).ToString([cultureinfo]::InvariantCulture); pid=$p.Id; memoryMB=[math]::Round($p.WorkingSet64 / 1MB, 1).ToString([cultureinfo]::InvariantCulture); path=$path; measuredAt=[DateTime]::UtcNow.ToString('o')}
            } catch {}
        }
        $rows | Export-Csv -NoTypeInformation -Encoding UTF8 -Path (Join-Path $OutputDirectory 'performance.csv')
    }
}
if ($Events) {
    Step 'Reading recent Windows errors and warnings' {
        $builder = [System.Text.StringBuilder]::new('<Events>')
        foreach ($log in @('System', 'Application')) {
            try {
                $entries = @(Get-WinEvent -FilterHashtable @{LogName=$log; StartTime=(Get-Date).AddDays(-7); Level=@(1,2,3)} -MaxEvents 1000 -ErrorAction Stop)
                foreach ($entry in $entries) { [void]$builder.Append($entry.ToXml()) }
                if ($entries.Count -eq 1000) { $warnings.Add("$log events reached the 1,000-event collection limit; export a custom time range for more history.") }
            } catch { $warnings.Add("${log} events: $($_.Exception.Message)") }
        }
        [void]$builder.Append('</Events>')
        [System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'windows-events.xml'), $builder.ToString(), [System.Text.UTF8Encoding]::new($false))
    }
}
if ($Servicing) {
    Step 'Copying readable CBS and DISM logs' {
        foreach ($relative in @('Logs\CBS\CBS.log', 'Logs\DISM\dism.log')) {
            $source = Join-Path $env:SystemRoot $relative
            $reader = $null; $writer = $null
            try {
                $reader = [System.IO.File]::Open($source, 'Open', 'Read', 'ReadWrite,Delete')
                if ($reader.Length -gt 1GB) { throw 'Log exceeds 1 GiB. Export a smaller time range.' }
                $writer = [System.IO.File]::Create((Join-Path $OutputDirectory ([System.IO.Path]::GetFileName($source))))
                # Copy exactly the observed length; an actively growing log cannot extend collection indefinitely.
                $remaining = $reader.Length; $buffer = New-Object byte[] 1048576
                while ($remaining -gt 0) {
                    $read = $reader.Read($buffer, 0, [int][math]::Min($remaining, $buffer.Length))
                    if ($read -eq 0) { break }
                    $writer.Write($buffer, 0, $read); $remaining -= $read
                }
            } catch { $warnings.Add("${relative}: $($_.Exception.Message)") }
            finally { if ($writer) { $writer.Dispose() }; if ($reader) { $reader.Dispose() } }
        }
    }
}
if ($FullReports) {
    Step 'Exporting MSINFO (this can take several minutes)' {
        $target = Join-Path $OutputDirectory 'msinfo.nfo'
        Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msinfo32.exe') -ArgumentList @('/nfo', ('"' + $target + '"')) -Wait -WindowStyle Hidden
        if (-not (Test-Path $target)) { throw 'MSINFO did not produce a report.' }
    }
    Step 'Exporting DXDIAG' {
        $target = Join-Path $OutputDirectory 'dxdiag.xml'
        Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\dxdiag.exe') -ArgumentList @('/dontskip', '/whql:off', '/x', ('"' + $target + '"')) -Wait -WindowStyle Hidden
        if (-not (Test-Path $target)) { throw 'DXDIAG did not produce a report.' }
    }
}
$snapshot = @{schema='stackscope.snapshot.v1'; collectedAt=[DateTime]::UtcNow.ToString('o'); records=$records.ToArray(); processes=$processes.ToArray(); warnings=$warnings.ToArray()}
$snapshot | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $OutputDirectory 'computer-snapshot.json')
Write-Output 'Collection complete'
