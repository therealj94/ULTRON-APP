using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
namespace Aura.Windows;
// Original AURA 3D model rendered to compact, transparent animation atlases.
// Native playback avoids a browser/GPU process for a 58-pixel desktop companion.
public sealed class AvatarView : Image {
 readonly DispatcherTimer timer=new(){Interval=TimeSpan.FromMilliseconds(100)};
 readonly Dictionary<string,BitmapSource[]> clips=new();
 string state="idle";int frame;bool phoneme=true;
 public AvatarView(){
  foreach(var name in new[]{"idle","listening","thinking","speaking","happy"}){
   var bitmap=new BitmapImage(new Uri("pack://application:,,,/AvatarAssets/"+name+".png"));bitmap.Freeze();var list=new BitmapSource[24];
   for(int i=0;i<24;i++){var crop=new CroppedBitmap(bitmap,new Int32Rect(i%6*192,i/6*192,192,192));crop.Freeze();list[i]=crop;}clips[name]=list;
  }
  Source=clips[state][0];timer.Tick+=(_,_)=>{if(!IsVisible||!IsEnabled||!SystemParameters.ClientAreaAnimation)return;frame=(frame+1)%24;Source=clips[state=="speaking"&&!phoneme?"idle":state][frame];};
  Loaded+=(_,_)=>timer.Start();Unloaded+=(_,_)=>timer.Stop();
 }
 public void SetState(string value){value=clips.ContainsKey(value)?value:"idle";if(state==value)return;state=value;frame=0;Source=clips[state][0];}
 public void SetSpeech(bool active){phoneme=active;}
}
