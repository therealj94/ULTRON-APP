using System;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
namespace Aura.Windows;
internal sealed class SettingsWindow : Window {
 public SettingsWindow() {
  Title="Conexión · AURA Windows";Width=540;Height=480;Background=new SolidColorBrush(Color.FromRgb(17,25,34));Foreground=Brushes.White;
  var box=new StackPanel {Margin=new Thickness(24)};Content=box;
  box.Children.Add(new TextBlock {Text="Tu servicio Windows",FontSize=24,Margin=new Thickness(0,0,0,12)});
  box.Children.Add(new TextBlock {Text="La conversación se enviará a este servicio. Sus claves de modelos permanecen en el servidor. Las acciones locales funcionan sin conexión.",TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,14)});
  ConnectionSettings current;try{current=ConnectionStore.Load();}catch{current=new();}
  box.Children.Add(new TextBlock {Text="Dirección del gateway"});var url=new TextBox {Text=current.Gateway,Margin=new Thickness(0,8,0,12)};box.Children.Add(url);
  box.Children.Add(new TextBlock {Text="Clave de acceso Windows"});var key=new PasswordBox {Password=current.Token,Padding=new Thickness(12),Margin=new Thickness(0,8,0,12)};box.Children.Add(key);
  var status=new TextBlock {TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,12,0,0)};
  var test=new Button {Content="Comprobar conexión"};test.Click+=async(_,_)=>{test.IsEnabled=false;try{using var c=new GatewayClient(new(url.Text.Trim(),key.Password));status.Text=await c.Health(CancellationToken.None);}catch(Exception ex){status.Text=ex.Message;}finally{test.IsEnabled=true;}};box.Children.Add(test);
  var save=new Button {Content="Guardar conexión"};save.Click+=(_,_)=>{try{ConnectionStore.Save(new(url.Text.Trim(),key.Password));DialogResult=true;}catch(Exception ex){status.Text=ex.Message;}};box.Children.Add(save);box.Children.Add(status);
 }
}
