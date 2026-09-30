using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
namespace Aura.Windows;
internal sealed class CallWindow : Window {
 const string Origin="https://aura.windows.local/";
 readonly WebView2 browser=new();readonly GatewayClient gateway;
 readonly CancellationTokenSource lifetime=new();
 readonly TextBox invite=new() {MaxLength=100,MinWidth=300};readonly TextBlock state=new() {TextWrapping=TextWrapping.Wrap};
 readonly Button create=new(){Content="Crear llamada"},join=new(){Content="Unirme con invitación"};
 string? room,participant;bool ready,closed;Task? poll;
 public CallWindow(bool selfTest=false,string? resultPath=null){
  gateway=new(selfTest?new ConnectionSettings():ConnectionStore.Load());Title="Llamadas · AURA Windows";Width=960;Height=850;Background=new SolidColorBrush(Color.FromRgb(17,25,34));Foreground=Brushes.White;
  var grid=new Grid();Content=grid;grid.RowDefinitions.Add(new(){Height=GridLength.Auto});grid.RowDefinitions.Add(new());
  var top=new StackPanel {Margin=new Thickness(18)};grid.Children.Add(top);var row=new WrapPanel();row.Children.Add(create);row.Children.Add(join);var copy=new Button{Content="Copiar invitación"};row.Children.Add(copy);top.Children.Add(row);top.Children.Add(invite);top.Children.Add(state);Grid.SetRow(browser,1);grid.Children.Add(browser);
  create.Click+=async(_,_)=>await Start(false);join.Click+=async(_,_)=>await Start(true);copy.Click+=(_,_)=>{if(!string.IsNullOrWhiteSpace(invite.Text)){try{Clipboard.SetText(invite.Text);state.Text="Invitación copiada. Compártela solo con la persona que esperas.";}catch(Exception ex){state.Text=ex.Message;}}};
  Loaded+=async(_,_)=>{
   try {
    string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AuraWindows",selfTest?"WebViewTest":"WebViewCalls");
    var environment=await CoreWebView2Environment.CreateAsync(null,profile);await browser.EnsureCoreWebView2Async(environment);
    if(closed)return;
    var core=browser.CoreWebView2;core.Settings.AreHostObjectsAllowed=false;core.Settings.AreDevToolsEnabled=false;core.Settings.AreDefaultContextMenusEnabled=false;core.Settings.IsStatusBarEnabled=false;
    core.SetVirtualHostNameToFolderMapping("aura.windows.local",Path.Combine(AppContext.BaseDirectory,"CallAssets"),CoreWebView2HostResourceAccessKind.DenyCors);
    core.NavigationStarting+=(_,e)=>{if(e.Uri!=Origin+"call.html")e.Cancel=true;};
    core.NewWindowRequested+=(_,e)=>e.Handled=true;core.DownloadStarting+=(_,e)=>e.Cancel=true;
    core.PermissionRequested+=(_,e)=>{e.State=CoreWebView2PermissionState.Deny;if(!selfTest&&e.Uri.StartsWith(Origin,StringComparison.Ordinal)&&e.PermissionKind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Camera){e.State=MessageBox.Show(this,$"¿Permitir {e.PermissionKind} para esta llamada?","AURA · Permiso",MessageBoxButton.YesNo,MessageBoxImage.Question)==MessageBoxResult.Yes?CoreWebView2PermissionState.Allow:CoreWebView2PermissionState.Deny;}e.SavesInProfile=false;};
    core.WebMessageReceived+=async(_,e)=>{
     if(e.Source!=Origin+"call.html"||closed||e.WebMessageAsJson.Length>262144)return;
     try{using var doc=JsonDocument.Parse(e.WebMessageAsJson);var m=doc.RootElement;string? kind=m.GetProperty("kind").GetString();
      if(kind=="testResult"&&selfTest){File.WriteAllText(resultPath!,m.GetRawText());Application.Current.Shutdown(m.GetProperty("ok").GetBoolean()?0:1);return;}
      if(kind=="hangup"){Close();return;}
      if(kind=="signal"&&room!=null&&participant!=null)await gateway.Post("v1/calls/send",new{roomId=room,payload=m.GetProperty("payload").Clone()},lifetime.Token,participant);
     }catch(Exception ex){if(!closed)state.Text="Señalización: "+ex.Message;}
    };
    core.NavigationCompleted+=async(_,e)=>{ready=e.IsSuccess;if(selfTest&&ready)await core.ExecuteScriptAsync("window.rtcSelfTest()");};
    core.Navigate(Origin+"call.html");
   }catch(Exception ex){state.Text="Llamadas no disponibles: "+ex.Message+". Comprueba WebView2 Runtime.";if(selfTest){File.WriteAllText(resultPath!,JsonSerializer.Serialize(new{ok=false,error=ex.Message}));Application.Current.Shutdown(1);}}
  };
  Closed+=(_,_)=>{closed=true;lifetime.Cancel();browser.Dispose();_ = LeaveAndDispose();};
 }
 async Task Start(bool joining){
  if(!ready||room!=null){state.Text="Espera a que cargue el panel; para otra llamada abre una nueva ventana.";return;}
  create.IsEnabled=join.IsEnabled=false;
  try{
   var data=await gateway.Post(joining?"v1/calls/join":"v1/calls/create",joining?new{invite=invite.Text.Trim()}:(object)new{},lifetime.Token,joining?"":null);
   room=data.GetProperty("roomId").GetString();participant=data.GetProperty("participantToken").GetString();
   if(closed){await LeaveAndDispose();return;}
   if(!joining)invite.Text=data.GetProperty("invite").GetString();
   browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{kind="config",initiator=data.GetProperty("initiator").GetBoolean(),iceServers=data.GetProperty("iceServers").Clone()}));
   state.Text=joining?"Dentro de la sala. Activa audio o video.":"Invitación lista. Compártela y activa audio o video.";
   poll=Poll();
  }catch(Exception ex){if(!closed){state.Text=ex.Message;create.IsEnabled=join.IsEnabled=true;}}
 }
 async Task Poll(){int cursor=0;try{while(!lifetime.IsCancellationRequested){var data=await gateway.Post("v1/calls/poll",new{roomId=room,after=cursor},lifetime.Token,participant);if(closed)return;foreach(var signal in data.GetProperty("signals").EnumerateArray())browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{kind="signal",payload=signal.GetProperty("payload").Clone()}));cursor=data.GetProperty("cursor").GetInt32();await Task.Delay(1000,lifetime.Token);}}catch(OperationCanceledException){}catch(Exception ex){if(!closed){state.Text="Llamada interrumpida: "+ex.Message;browser.CoreWebView2.PostWebMessageAsJson("{\"kind\":\"stop\"}");}}}
 async Task LeaveAndDispose(){try{if(room!=null&&participant!=null)await gateway.Post("v1/calls/leave",new{roomId=room},CancellationToken.None,participant);}catch{}finally{gateway.Dispose();}}
}
