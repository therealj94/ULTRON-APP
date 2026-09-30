using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
namespace Aura.Windows;
internal sealed record InstalledApp(string Name,string Path);
public partial class MainWindow {
 readonly List<InstalledApp> installedApps=new();
 void RefreshApps(){
  if(renderOnly)return;
  foreach(var root in new[]{Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu)}){
   try{foreach(var file in Directory.EnumerateFiles(root,"*.lnk",SearchOption.AllDirectories).Take(800)){var name=Path.GetFileNameWithoutExtension(file);if(!name.Contains("uninstall",StringComparison.OrdinalIgnoreCase)&&!name.Contains("desinstal",StringComparison.OrdinalIgnoreCase))installedApps.Add(new(name,file));}}catch{}
  }
  FilterApps(this,new TextChangedEventArgs(TextBox.TextChangedEvent,UndoAction.None));
 }
 void FilterApps(object sender,TextChangedEventArgs e){if(AppList==null)return;AppList.ItemsSource=installedApps.Where(a=>a.Name.Contains(AppSearch.Text,StringComparison.OrdinalIgnoreCase)).DistinctBy(a=>a.Path).OrderBy(a=>a.Name).Take(80).ToArray();}
 void LaunchApp(object sender,RoutedEventArgs e){if(gate.Paused||renderOnly||AppList.SelectedItem is not InstalledApp app)return;
  if(MessageBox.Show(this,"¿Abrir "+app.Name+" desde su acceso del menú Inicio?","AURA",MessageBoxButton.YesNo,MessageBoxImage.Question)!=MessageBoxResult.Yes||gate.Paused)return;
  try{if(!File.Exists(app.Path))throw new IOException("La aplicación ya no está disponible en el menú Inicio.");Process.Start(new ProcessStartInfo(app.Path){UseShellExecute=true});SetStatus("Aplicación abierta",app.Name);}catch(Exception ex){SetStatus("No pude abrir la aplicación",ex.Message);}
 }
}
