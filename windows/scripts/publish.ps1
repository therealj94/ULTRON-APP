$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot/.."
# El Centro (la página de WebView2): se arma antes de publicar para que viaje en CentroAssets.
Push-Location centro
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Centro: npm ci failed' }
node build.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Centro build failed' }
npx --no-install tsc -p tsconfig.json
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Centro typecheck failed' }
npm test
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Centro tests failed' }
Pop-Location
dotnet run --project tests/Aura.Windows.Tests.csproj -c Release
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
# En el CI, el .exe lleva su commit (para la actualización por el aire) y el número de build en la versión.
$extra = @()
if ($env:GITHUB_SHA) { $extra += "-p:SourceRevisionId=$env:GITHUB_SHA" }
if ($env:GITHUB_RUN_NUMBER) { $extra += "-p:Version=2.0.$env:GITHUB_RUN_NUMBER" }
dotnet publish src/Aura.Windows/Aura.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o artifacts/win-x64 @extra
if ($LASTEXITCODE -ne 0) { throw 'Publish failed' }
Get-FileHash artifacts/win-x64/Aura.Windows.exe -Algorithm SHA256
