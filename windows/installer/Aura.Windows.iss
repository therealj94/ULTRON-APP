[Setup]
AppId={{771C9ED5-39B8-4A11-A1DE-606D406422A3}
AppName=AURA Windows
AppVersion=0.4.0
AppPublisher=Orden Global
DefaultDirName={localappdata}\Programs\AuraWindows
DefaultGroupName=AURA Windows
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\artifacts\installer
OutputBaseFilename=AURA-Windows-Setup-0.4.0-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\Aura.Windows.exe
[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; Flags: unchecked
Name: "startup"; Description: "Iniciar AURA cuando entre a Windows"; Flags: unchecked
[Files]
Source: "..\artifacts\win-x64\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\AURA Windows"; Filename: "{app}\Aura.Windows.exe"
Name: "{autodesktop}\AURA Windows"; Filename: "{app}\Aura.Windows.exe"; Tasks: desktopicon
Name: "{userstartup}\AURA Windows"; Filename: "{app}\Aura.Windows.exe"; Tasks: startup
[Run]
Filename: "{app}\Aura.Windows.exe"; Description: "Abrir AURA Windows"; Flags: nowait postinstall skipifsilent
