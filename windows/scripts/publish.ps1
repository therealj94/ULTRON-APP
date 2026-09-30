$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot/.."
dotnet run --project tests/Aura.Windows.Tests.csproj -c Release
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
dotnet publish src/Aura.Windows/Aura.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o artifacts/win-x64
if ($LASTEXITCODE -ne 0) { throw 'Publish failed' }
Get-FileHash artifacts/win-x64/Aura.Windows.exe -Algorithm SHA256
