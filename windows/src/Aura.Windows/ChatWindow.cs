using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
namespace Aura.Windows;
internal sealed class ChatWindow : Window {
 readonly GatewayClient client;
 readonly List<object> history=new();
 readonly StackPanel messages=new();
 readonly TextBox input=new() {AcceptsReturn=true,TextWrapping=TextWrapping.Wrap,Height=85,MaxLength=8000};
 readonly Button send=new() {Content="Enviar"}, draft=new() {Content="Pasar respuesta al borrador",IsEnabled=false};
 readonly TextBlock state=new() {TextWrapping=TextWrapping.Wrap};
 CancellationTokenSource? request;long generation;string last="";
 readonly Action<string> toDraft;
 public ChatWindow(Action<string> toDraft) {
  this.toDraft=toDraft;client=new(ConnectionStore.Load());Title="Conversación · AURA Windows";Width=650;Height=740;MinWidth=440;MinHeight=480;Background=new SolidColorBrush(Color.FromRgb(17,25,34));Foreground=Brushes.White;
  var grid=new Grid {Margin=new Thickness(20)};Content=grid;grid.RowDefinitions.Add(new(){Height=GridLength.Auto});grid.RowDefinitions.Add(new());grid.RowDefinitions.Add(new(){Height=GridLength.Auto});
  var heading=new TextBlock {Text="Conversación con AURA\nLos mensajes se envían al gateway configurado. No ejecutan acciones en tu PC.",TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,16)};grid.Children.Add(heading);
  var scroll=new ScrollViewer {Content=messages,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};Grid.SetRow(scroll,1);grid.Children.Add(scroll);
  var bottom=new StackPanel();Grid.SetRow(bottom,2);grid.Children.Add(bottom);bottom.Children.Add(input);
  var buttons=new WrapPanel {Margin=new Thickness(0,10,0,0)};buttons.Children.Add(send);var stop=new Button {Content="Cancelar"};buttons.Children.Add(stop);var clear=new Button {Content="Nueva conversación"};buttons.Children.Add(clear);bottom.Children.Add(buttons);bottom.Children.Add(draft);bottom.Children.Add(state);
  send.Click+=async(_,_)=>{await Send();scroll.ScrollToEnd();};stop.Click+=(_,_)=>Cancel();
  clear.Click+=(_,_)=>{Cancel();history.Clear();messages.Children.Clear();last="";draft.IsEnabled=false;state.Text="Conversación borrada de esta ventana.";};
  draft.Click+=(_,_)=>{if(last.Length>0)toDraft(last);};
  Closed+=(_,_)=>{Cancel();client.Dispose();};
 }
 public void Cancel(){generation++;request?.Cancel();request?.Dispose();request=null;send.IsEnabled=true;state.Text="Solicitud cancelada. Las respuestas tardías se descartan.";}
 void Add(string who,string content){messages.Children.Add(new TextBlock {Text=who,Foreground=Brushes.Aquamarine,Margin=new Thickness(0,12,0,6)});messages.Children.Add(new TextBox {Text=content,IsReadOnly=true,TextWrapping=TextWrapping.Wrap,BorderThickness=new Thickness(0),Background=Brushes.Transparent});}
 async Task Send(){
  var text=input.Text.Trim();if(text.Length==0||request!=null)return;
  request=new();var cancellation=request.Token;long run=++generation;send.IsEnabled=false;state.Text="AURA está respondiendo…";
  var turn=new {role="user",content=text};Add("Tú",text);input.Clear();
  try {
   var payload=history.TakeLast(18).Append<object>(turn).ToArray();
   var reply=await client.Post("v1/chat",new {messages=payload},cancellation);
   if(run!=generation)return;
   last=reply.GetProperty("content").GetString() ?? "";
   if(last.Length>32000)throw new InvalidOperationException("Respuesta demasiado extensa.");
   history.Add(turn);history.Add(new {role="assistant",content=last});
   if(history.Count>18)history.RemoveRange(0,history.Count-18);
   Add("AURA",last);draft.IsEnabled=true;state.Text="Respuesta recibida. Revisa el texto antes de usarlo.";
  }catch(OperationCanceledException){if(run==generation)state.Text="Solicitud cancelada o tiempo agotado.";}
  catch(Exception ex){if(run==generation){state.Text="No se obtuvo respuesta: "+ex.Message;input.Text=text;}}
  finally{if(run==generation){request?.Dispose();request=null;send.IsEnabled=true;}}
 }
}
