using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Aura.Windows.Core;
namespace Aura.Windows;
public partial class MainWindow {
 readonly List<object> history=new();
 CancellationTokenSource? assistantRequest;
 SpeechSynthesizer? speaker;
 bool speaking,continuousSession;
 long assistantGeneration;
 string lastResponse="",savedDraft="";
 static string RecoveryPath=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AuraWindows","draft.bin");
 void InitializeAssistant(){
  if(!renderOnly){try{if(File.Exists(RecoveryPath)){Draft.Text=System.Text.Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(RecoveryPath),null,DataProtectionScope.CurrentUser));savedDraft=Draft.Text;dirty=false;}}catch{SetStatus("Borrador no disponible","No se pudo recuperar el borrador anterior. Puedes continuar con uno nuevo.");}
   try{if(!string.IsNullOrWhiteSpace(ConnectionStore.Load().Token))ConnectionHint.Text="Tu servidor AURA está configurado. Puedes conversar.";}catch{}
  }
  RefreshApps();
 }
 void SaveRecovery(){
  if(renderOnly || Draft.Text==savedDraft)return;
  try{Directory.CreateDirectory(Path.GetDirectoryName(RecoveryPath)!);var bytes=ProtectedData.Protect(System.Text.Encoding.UTF8.GetBytes(Draft.Text),null,DataProtectionScope.CurrentUser);File.WriteAllBytes(RecoveryPath+".tmp",bytes);File.Move(RecoveryPath+".tmp",RecoveryPath,true);savedDraft=Draft.Text;}catch{SetStatus("No se pudo recuperar automáticamente","Guarda el borrador como archivo antes de cerrar AURA.");}
 }
 void AddMessage(string who,string text){
  Welcome.Visibility=Visibility.Collapsed;
  var stack=new StackPanel();stack.Children.Add(new TextBlock{Text=who,Foreground=new SolidColorBrush(Color.FromRgb(226,203,160)),FontSize=11,FontWeight=FontWeights.SemiBold,Margin=new Thickness(0,0,0,7)});
  stack.Children.Add(new TextBox{Text=text,IsReadOnly=true,TextWrapping=TextWrapping.Wrap,BorderThickness=new Thickness(0),Background=Brushes.Transparent,Padding=new Thickness(0),FontSize=15});
  if(who=="AURA"){
   var row=new WrapPanel{Margin=new Thickness(0,12,0,0)};
   var use=new Button{Content="Usar como borrador",FontSize=12,Padding=new Thickness(10,6,10,6)};use.Click+=(_,_)=>UseDraft(text);row.Children.Add(use);
   var read=new Button{Content="Escuchar",FontSize=12,Padding=new Thickness(10,6,10,6)};read.Click+=(_,_)=>Speak(text);row.Children.Add(read);stack.Children.Add(row);
  }
  Messages.Children.Add(new Border{Child=stack,Background=new SolidColorBrush(who=="Tú"?Color.FromRgb(28,29,34):Color.FromRgb(17,18,21)),CornerRadius=new CornerRadius(15),Padding=new Thickness(15),Margin=new Thickness(who=="Tú"?28:0,8,who=="Tú"?0:12,4)});
  // Bound the in-memory view as well as model history.
  while(Messages.Children.Count>41)Messages.Children.RemoveAt(1);
  ConversationScroll.ScrollToEnd();
 }
 void UseDraft(string text){if(gate.Paused)return;if(dirty&&Draft.Text.Length>0&&MessageBox.Show(this,"¿Reemplazar el borrador actual?","AURA",MessageBoxButton.YesNo)!=MessageBoxResult.Yes)return;Draft.Text=text;Workspace.SelectedIndex=2;SaveRecovery();}
 void StartDraft(object sender,RoutedEventArgs e){Expand(true);Workspace.SelectedIndex=2;Draft.Focus();}
 async void SendConversation(object sender,RoutedEventArgs e)=>await SendAssistant();
 async void ConversationKeyDown(object sender,KeyEventArgs e){if(e.Key==Key.Enter&&Keyboard.Modifiers!=ModifierKeys.Shift){e.Handled=true;await SendAssistant();}}
 async Task SendAssistant(){
  string text=ConversationInput.Text.Trim();if(gate.Paused||assistantRequest!=null||text.Length==0)return;
  StopVoice();StopSpeaking();ClearApproval();
  var command=Commands.Parse(text);
  if(command.Kind!=ActionKind.None){ConversationInput.Clear();AddMessage("Tú",text);Input.Text=text;Prepare(this,new RoutedEventArgs());Avatar.SetState("happy");return;}
  ConnectionSettings settings;
  try{settings=testConnection??ConnectionStore.Load();if(string.IsNullOrWhiteSpace(settings.Token)){SetStatus("Conecta tu AURA","Abre Ajustes e introduce la dirección y el acceso de tu servidor Windows. Las acciones y borradores ya funcionan en este equipo.");return;}}
  catch(Exception){SetStatus("Revisa la conexión","Abre Ajustes para volver a guardar tu conexión.");return;}
  var cts=new CancellationTokenSource();assistantRequest=cts;long run=++assistantGeneration;UpdateControls();SendButton.IsEnabled=false;SetStatus("Pensando contigo","Puedes detener la respuesta en cualquier momento.");AddMessage("Tú",text);ConversationInput.Clear();
  try{
   using var client=new GatewayClient(settings);var turn=new{role="user",content=text};var reply=await client.Post("v1/chat",new{messages=history.TakeLast(12).Append<object>(turn).ToArray()},cts.Token);
   if(run!=assistantGeneration||gate.Paused)return;
   var answer=reply.GetProperty("content").GetString()??"";if(string.IsNullOrWhiteSpace(answer)||answer.Length>32000)throw new InvalidOperationException("La respuesta recibida no es válida.");
   lastResponse=answer;history.Add(turn);history.Add(new{role="assistant",content=answer.Length>8000?answer[..8000]:answer});while(history.Count>12)history.RemoveRange(0,2);
   AddMessage("AURA",answer);SetStatus("Aquí tienes","Puedes escuchar la respuesta o llevarla a tu borrador.");
   if(ReadAloud.IsChecked==true)Speak(answer);else if(continuousSession)_=Dispatcher.BeginInvoke(new Action(()=>BeginListening(true)));
  }catch(OperationCanceledException){if(run==assistantGeneration)SetStatus("Respuesta detenida","Puedes continuar cuando quieras.");}
  catch(Exception ex){if(run==assistantGeneration){SetStatus("No pude conectar con AURA",ex.Message+" Revisa Ajustes.");ConversationInput.Text=text;continuousSession=false;}}
  finally{if(ReferenceEquals(assistantRequest,cts)){assistantRequest=null;UpdateControls();}cts.Dispose();}
 }
 void StopSpeaking(){speaking=false;var old=speaker;speaker=null;if(old!=null){old.SpeakAsyncCancelAll();old.Dispose();}UpdateControls();}
 void Speak(string text){
  if(gate.Paused||renderOnly)return;StopVoice();StopSpeaking();
  try{
   var current=new SpeechSynthesizer();speaker=current;
   var voice=current.GetInstalledVoices().Where(v=>v.Enabled&&v.VoiceInfo.Culture.TwoLetterISOLanguageName=="es").OrderByDescending(v=>v.VoiceInfo.Gender==VoiceGender.Female).FirstOrDefault();
   if(voice==null){StopSpeaking();continuousSession=false;SetStatus("Falta la voz en español","Agrega una voz en Configuración de Windows → Hora e idioma → Voz. La respuesta está disponible en texto.");return;}
   current.SelectVoice(voice.VoiceInfo.Name);current.SetOutputToDefaultAudioDevice();
   current.SpeakCompleted+=(_,_)=>Dispatcher.BeginInvoke(new Action(()=>{if(!ReferenceEquals(speaker,current))return;StopSpeaking();if(continuousSession&&!gate.Paused)BeginListening(true);}));
   current.VisemeReached+=(_,args)=>Dispatcher.BeginInvoke(new Action(()=>{if(ReferenceEquals(speaker,current))Avatar.SetSpeech(args.Viseme!=0);}));
   speaking=true;UpdateControls();current.SpeakAsync(text.Length>8000?text[..8000]:text);
  }catch(Exception ex){StopSpeaking();continuousSession=false;SetStatus("No se pudo reproducir la voz",ex.Message);}
 }
 void BeginListening(bool followup=false){
  Expand(true);Workspace.SelectedIndex=0;if(gate.Paused||renderOnly)return;
  if(speech!=null){StopAssistant();return;}
  if(!followup)continuousSession=HandsFree.IsChecked==true;
  assistantGeneration++;assistantRequest?.Cancel();assistantRequest=null;StopSpeaking();ClearApproval();
  try{
   var installed=SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault(r=>r.Culture.TwoLetterISOLanguageName=="es");
   if(installed==null){continuousSession=false;SetStatus("Activa la voz en español","En Windows, agrega reconocimiento de voz en español. Puedes escribir mientras tanto.");return;}
   long generation=++voiceGeneration;var current=new SpeechRecognitionEngine(installed);speech=current;current.SetInputToDefaultAudioDevice();current.LoadGrammar(new DictationGrammar());current.InitialSilenceTimeout=TimeSpan.FromSeconds(8);current.BabbleTimeout=TimeSpan.FromSeconds(15);current.EndSilenceTimeout=TimeSpan.FromMilliseconds(750);
   string recognized="";
   current.SpeechRecognized+=(_,args)=>Dispatcher.BeginInvoke(new Action(()=>{if(generation!=voiceGeneration||gate.Paused)return;recognized=args.Result.Text;ConversationInput.Text=recognized;}));
   current.RecognizeCompleted+=(_,_)=>Dispatcher.BeginInvoke(new Action(async()=>{if(generation!=voiceGeneration)return;StopVoice();if(recognized.Length>0){ConversationInput.Text=recognized;await SendAssistant();}else{continuousSession=false;SetStatus("No alcancé a escucharte","Toca el micrófono para intentarlo otra vez o escribe tu mensaje.");}}));
   voiceDeadline=DateTimeOffset.UtcNow.AddSeconds(20);UpdateControls();SetStatus("Te escucho","Al terminar de hablar, AURA prepara la respuesta. Las acciones necesitan tu confirmación.");current.RecognizeAsync(RecognizeMode.Single);
  }catch(Exception ex){StopVoice();continuousSession=false;SetStatus("Revisa el micrófono",ex.Message);}
 }
 void StopAssistant(){continuousSession=false;assistantGeneration++;assistantRequest?.Cancel();assistantRequest=null;StopVoice();StopSpeaking();UpdateControls();}
 void StopConversation(object sender,RoutedEventArgs e){StopAssistant();ClearApproval();SetStatus("Detenido","Micrófono y respuesta detenidos. Puedes continuar cuando quieras.");}
 void EndHandsFree(object sender,RoutedEventArgs e){continuousSession=false;}
}
