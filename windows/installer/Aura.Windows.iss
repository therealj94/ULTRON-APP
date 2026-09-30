[Setup]
AppId={{771C9ED5-39B8-4A11-A1DE-606D406422A3}
AppName=AURA
AppVersion=2.0.0
AppPublisher=Orden Global
DefaultDirName={localappdata}\Programs\AuraWindows
DefaultGroupName=AURA
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\artifacts\installer
OutputBaseFilename=AURA-Windows-Setup-2.0.0-x64
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
Name: "startup"; Description: "Iniciar AURA cuando entre a Windows (el notch siempre a mano)"
[Files]
Source: "..\artifacts\win-x64\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\AURA"; Filename: "{app}\Aura.Windows.exe"
Name: "{autodesktop}\AURA"; Filename: "{app}\Aura.Windows.exe"; Tasks: desktopicon
Name: "{userstartup}\AURA"; Filename: "{app}\Aura.Windows.exe"; Tasks: startup
[Registry]
; El enlace ultronfp:// (la vuelta de Genesis ID) lo registra AURA al abrirse; al desinstalar se quita.
Root: HKCU; Subkey: "Software\Classes\ultronfp"; Flags: uninsdeletekey dontcreatekey

[Run]
Filename: "{app}\Aura.Windows.exe"; Description: "Abrir AURA"; Flags: nowait postinstall skipifsilent
; La actualización por el aire corre el instalador en silencio: al terminar, AURA vuelve a abrirse sola.
Filename: "{app}\Aura.Windows.exe"; Flags: nowait runasoriginaluser; Check: WizardSilent
