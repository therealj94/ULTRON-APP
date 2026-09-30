$ErrorActionPreference = 'Stop'
$installer = Get-Item "$PSScriptRoot/../artifacts/installer/*.exe"
$root = "$PSScriptRoot/../artifacts/delivery"
New-Item -ItemType Directory -Force $root | Out-Null
$bytes = [IO.File]::ReadAllBytes($installer.FullName)
$chunkSize = 24MB
$parts = @()
for ($offset = 0; $offset -lt $bytes.Length; $offset += $chunkSize) {
    $number = $parts.Count + 1
    $name = 'part-{0:D2}' -f $number
    $folder = Join-Path $root $name
    New-Item -ItemType Directory -Force $folder | Out-Null
    $length = [Math]::Min($chunkSize, $bytes.Length - $offset)
    $chunk = New-Object byte[] $length
    [Array]::Copy($bytes, $offset, $chunk, 0, $length)
    $path = Join-Path $folder "$name.bin"
    [IO.File]::WriteAllBytes($path, $chunk)
    $parts += @{ name="$name.bin"; size=$length; sha256=(Get-FileHash $path -Algorithm SHA256).Hash }
}
if ($parts.Count -gt 4) { throw 'Installer exceeds configured transfer parts' }
@{ filename=$installer.Name; size=$bytes.Length; sha256=(Get-FileHash $installer.FullName -Algorithm SHA256).Hash; parts=$parts } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root 'part-01/manifest.json') -Encoding UTF8
