using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
namespace Aura.Windows;
internal static class ProtocolSelfTest {
 public static async Task Run(string path){
  Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
  try{
   using var c=new GatewayClient(new("http://127.0.0.1:18787/","windows-protocol-test-00000000000000000000"));
   string health="";for(int i=0;i<10;i++){try{health=await c.Health(CancellationToken.None);break;}catch when(i<9){await Task.Delay(300);}}
   var chat=await c.Post("v1/chat",new{messages=new[]{new{role="user",content="Prueba de protocolo"}}},CancellationToken.None);
   if(chat.GetProperty("content").GetString()!="Windows gateway protocol OK")throw new Exception("Chat mismatch");
   var host=await c.Post("v1/calls/create",new{},CancellationToken.None);
   var guest=await c.Post("v1/calls/join",new{invite=host.GetProperty("invite").GetString()},CancellationToken.None,"");
   string room=host.GetProperty("roomId").GetString()!,token=host.GetProperty("participantToken").GetString()!;
   await c.Post("v1/calls/send",new{roomId=room,payload=new{type="offer",sdp="v=0\r\nfixture"}},CancellationToken.None,token);
   var poll=await c.Post("v1/calls/poll",new{roomId=room,after=0},CancellationToken.None,guest.GetProperty("participantToken").GetString());
   if(poll.GetProperty("signals").GetArrayLength()!=1)throw new Exception("Signal mismatch");
   await c.Post("v1/calls/leave",new{roomId=room},CancellationToken.None,token);
   byte[] secret={1,2,3,4};byte[] protectedValue=ProtectedData.Protect(secret,null,DataProtectionScope.CurrentUser);
   if(!System.Linq.Enumerable.SequenceEqual(secret,ProtectedData.Unprotect(protectedValue,null,DataProtectionScope.CurrentUser)))throw new Exception("DPAPI mismatch");
   File.WriteAllText(path,JsonSerializer.Serialize(new{ok=true,chat=true,signaling=true,dpapi=true,model="fixture-only",health}));Application.Current.Shutdown(0);
  }catch(Exception ex){File.WriteAllText(path,JsonSerializer.Serialize(new{ok=false,error=ex.Message}));Application.Current.Shutdown(1);}
 }
}
