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
# UNA versión para todo (auditoría 1-oct, H06): el .exe (FileVersion/ProductVersion), el instalador (ISCC /DAppVer)
# y la ficha aura-windows.json dicen lo mismo. En el CI: 2.0.<número de build>; a mano: 2.0.0 (no se actualiza solo).
$version = if ($env:AURA_VERSION) { $env:AURA_VERSION } elseif ($env:GITHUB_RUN_NUMBER) { "2.0.$env:GITHUB_RUN_NUMBER" } else { '2.0.0' }
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Versión inválida: $version" }
# En el CI, el .exe lleva además su commit (tras el «+» de ProductVersion).
$extra = @("-p:Version=$version")
if ($env:GITHUB_SHA) { $extra += "-p:SourceRevisionId=$env:GITHUB_SHA" }
dotnet publish src/Aura.Windows/Aura.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o artifacts/win-x64 @extra
if ($LASTEXITCODE -ne 0) { throw 'Publish failed' }
Set-Content artifacts/version.txt $version -NoNewline

# ONNX Runtime va al lado del .exe (el target OnnxAlLadoDelExe del .csproj lo saca del paquete de un solo archivo)
# y necesita el runtime de Visual C++ 2015-2022 (MSVCP140.dll, MSVCP140_1.dll, VCRUNTIME140.dll, VCRUNTIME140_1.dll),
# que .NET autocontenido NO trae. Sin él, en un equipo que no lo tenga instalado (o con uno viejo), el modelo propio
# «Hey AURA» no arranca (auditoría 1-oct, H05). Se copia «app-local», como Microsoft permite redistribuir esos
# archivos, desde la carpeta Redist de Visual Studio del runner.
if (-not (Test-Path artifacts/win-x64/onnxruntime.dll)) { throw 'onnxruntime.dll no quedó junto al .exe (revisa el target OnnxAlLadoDelExe)' }
$crt = $null
$vswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
if (Test-Path $vswhere) {
  $vs = & $vswhere -latest -products * -property installationPath
  if ($vs) {
    $crt = Get-ChildItem "$vs/VC/Redist/MSVC/*/x64/Microsoft.VC14*.CRT" -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName 'msvcp140_1.dll') } |
      Sort-Object { $_.Parent.Parent.Name } -Descending | Select-Object -First 1
  }
}
if ($crt) {
  foreach ($dll in 'msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll') {
    Copy-Item (Join-Path $crt.FullName $dll) artifacts/win-x64/ -Force
  }
  Write-Host "Runtime de Visual C++ app-local desde $($crt.FullName)"
} elseif ($env:GITHUB_ACTIONS) {
  throw 'No encontré el runtime de Visual C++ (Redist de Visual Studio) para copiarlo junto a onnxruntime.dll'
} else {
  Write-Warning 'Sin el runtime de Visual C++ junto al .exe: el modelo propio dependerá del que tenga instalado cada equipo.'
}
Get-FileHash artifacts/win-x64/Aura.Windows.exe -Algorithm SHA256
