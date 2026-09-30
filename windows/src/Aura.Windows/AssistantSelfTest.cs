using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Aura.Windows.Core;
namespace Aura.Windows;
public partial class MainWindow {
 ConnectionSettings? testConnection;
 internal static async Task VerifyAssistant(string output){
  MainWindow? window=null;
  try{
   window=new MainWindow(true);window.testConnection=new("http://127.0.0.1:18787/","windows-protocol-test-00000000000000000000");window.Show();window.Expand(true);window.ReadAloud.IsChecked=false;
   using(var client=new GatewayClient(window.testConnection)){for(int i=0;i<15;i++){try{await client.Health(System.Threading.CancellationToken.None);break;}catch when(i<14){await Task.Delay(200);}}}
   window.ConversationInput.Text="Hola AURA";await window.SendAssistant();
   if(window.lastResponse!="Windows gateway protocol OK"||window.history.Count!=2||!window.SendButton.IsEnabled)throw new Exception("Unified conversation did not complete");
   window.ConversationInput.Text="abre calculadora";await window.SendAssistant();
   if(window.ApprovalActions.Visibility!=Visibility.Visible)throw new Exception("Action was not proposed");
   window.Input.Text="abre documentos";
   if(window.ApprovalActions.Visibility==Visibility.Visible)throw new Exception("Edited proposal not revoked");
   window.PauseAll();window.ConversationInput.Text="No enviar durante pausa";await window.SendAssistant();
   if(window.history.Count!=2||window.SendButton.IsEnabled)throw new Exception("Pause allowed conversation");
   Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);File.WriteAllText(output,JsonSerializer.Serialize(new{ok=true,unifiedChat=true,actionProposal=true,pause=true,editedApproval=true,model="fixture-only"}));
   window.dirty=false;window.Close();Application.Current.Shutdown(0);
  }catch(Exception ex){Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);File.WriteAllText(output,JsonSerializer.Serialize(new{ok=false,error=ex.ToString()}));if(window!=null){window.dirty=false;window.Close();}Application.Current.Shutdown(1);}
 }
}
