using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
namespace Aura.Windows;
internal sealed record ConnectionSettings(string Gateway = "http://127.0.0.1:8787/", string Token = "");
internal static class ConnectionStore {
 static readonly string FilePath=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AuraWindows","settings.bin");
 public static Uri Validate(string value) {
  if(!Uri.TryCreate(value,UriKind.Absolute,out var u) || (u.Scheme!="https" && !(u.Scheme=="http"&&u.IsLoopback)) || u.UserInfo.Length>0 || u.Query.Length>0 || u.Fragment.Length>0) throw new InvalidOperationException("Usa HTTPS; HTTP solo se permite en este equipo (localhost).");
  return new Uri(u.AbsoluteUri.TrimEnd('/')+"/");
 }
 public static ConnectionSettings Load() {
  if(!File.Exists(FilePath))return new();
  var bytes=ProtectedData.Unprotect(File.ReadAllBytes(FilePath),null,DataProtectionScope.CurrentUser);
  return JsonSerializer.Deserialize<ConnectionSettings>(bytes) ?? new();
 }
 public static void Save(ConnectionSettings settings) {
  Validate(settings.Gateway);Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
  var bytes=ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(settings),null,DataProtectionScope.CurrentUser);
  var tmp=FilePath+".tmp";File.WriteAllBytes(tmp,bytes);File.Move(tmp,FilePath,true);
 }
}
internal sealed class GatewayClient : IDisposable {
 readonly HttpClient http=new(new HttpClientHandler {AllowAutoRedirect=false}) {Timeout=TimeSpan.FromSeconds(75),MaxResponseContentBufferSize=524288};
 readonly ConnectionSettings settings;
 public GatewayClient(ConnectionSettings settings) {this.settings=settings;http.BaseAddress=ConnectionStore.Validate(settings.Gateway);}
 public async Task<JsonElement> Post(string path,object body,CancellationToken cancellation,string? token=null) {
  using var req=new HttpRequestMessage(HttpMethod.Post,path);req.Content=new StringContent(JsonSerializer.Serialize(body),Encoding.UTF8,"application/json");
  if(!string.IsNullOrEmpty(token ?? settings.Token))req.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token ?? settings.Token);
  using var response=await http.SendAsync(req,cancellation);
  if(!response.IsSuccessStatusCode)throw new InvalidOperationException(response.StatusCode switch {
   System.Net.HttpStatusCode.Unauthorized=>"Acceso rechazado. Revisa la clave o la invitación.",
   System.Net.HttpStatusCode.ServiceUnavailable=>"El servicio todavía no tiene un modelo configurado.",
   System.Net.HttpStatusCode.TooManyRequests=>"El servicio está ocupado. Espera un momento.",
   _=>$"El servicio respondió con error {(int)response.StatusCode}."});
  using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));return json.RootElement.Clone();
 }
 public async Task<string> Health(CancellationToken cancellation) {
  using var response=await http.GetAsync("health",cancellation);response.EnsureSuccessStatusCode();
  using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
  if(json.RootElement.GetProperty("product").GetString()!="aura-windows")throw new InvalidOperationException("Este servidor no es AURA Windows.");
  return json.RootElement.GetProperty("modelConfigured").GetBoolean()?"Servicio conectado. Modelo configurado en el servidor.":"Servicio conectado. Falta configurar el modelo en el servidor.";
 }
 public void Dispose()=>http.Dispose();
}
