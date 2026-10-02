# Firma de código (Authenticode, SHA-256, con sello de tiempo) del .exe o del instalador.
#   · A mano:  ./sign.ps1 -CertificateThumbprint <huella> -File <archivo>   (certificado en CurrentUser\My)
#   · En el CI: ./sign.ps1 -File <archivo> -DesdeSecretos                   (secretos AURA_SIGN_PFX en base64 y AURA_SIGN_PFX_PASSWORD)
# Sin certificado (hoy: TODO, auditoría 1-oct H07) el modo -DesdeSecretos avisa y sale sin error: el build sigue,
# sin firma. Cuando haya certificado de firma de código: cargar los dos secretos en GitHub y nada más.
param(
  [string]$CertificateThumbprint,
  [Parameter(Mandatory=$true)][string]$File,
  [switch]$DesdeSecretos
)
$ErrorActionPreference = 'Stop'
if ($DesdeSecretos) {
  if (-not $env:AURA_SIGN_PFX) {
    Write-Host "::notice::Sin certificado de firma (secreto AURA_SIGN_PFX): $([IO.Path]::GetFileName($File)) queda SIN firmar."
    exit 0
  }
  $pfx = Join-Path ([IO.Path]::GetTempPath()) ("aura-firma-" + [Guid]::NewGuid().ToString('N') + '.pfx')
  try {
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:AURA_SIGN_PFX))
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($pfx, $env:AURA_SIGN_PFX_PASSWORD, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::UserKeySet)
  } finally { Remove-Item $pfx -Force -ErrorAction SilentlyContinue }
} else {
  if (-not $CertificateThumbprint) { throw 'Falta -CertificateThumbprint (o -DesdeSecretos).' }
  $cert = Get-Item "Cert:\CurrentUser\My\$CertificateThumbprint"
}
if (-not $cert.HasPrivateKey) { throw 'El certificado no tiene clave privada disponible.' }
if ($cert.NotAfter -lt (Get-Date)) { throw 'El certificado está vencido.' }
$usos = @($cert.Extensions | Where-Object { $_ -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension] } | ForEach-Object { $_.EnhancedKeyUsages } | ForEach-Object { $_.Value })
if (-not ($usos -contains '1.3.6.1.5.5.7.3.3')) { throw 'Se necesita un certificado de firma de código.' }
$result = Set-AuthenticodeSignature -FilePath $File -Certificate $cert -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
if ($result.Status -ne 'Valid') { throw "Firma inválida: $($result.Status)" }
Get-AuthenticodeSignature $File
