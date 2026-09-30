param([Parameter(Mandatory=$true)][string]$CertificateThumbprint,[Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference = 'Stop'
$cert = Get-Item "Cert:\CurrentUser\My\$CertificateThumbprint"
if (-not $cert.HasPrivateKey) { throw 'El certificado no tiene clave privada disponible.' }
if ($cert.NotAfter -lt (Get-Date)) { throw 'El certificado está vencido.' }
if (-not ($cert.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3')) { throw 'Se necesita un certificado de firma de código.' }
$result = Set-AuthenticodeSignature -FilePath $File -Certificate $cert -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
if ($result.Status -ne 'Valid') { throw "Firma inválida: $($result.Status)" }
Get-AuthenticodeSignature $File
