; AgentRuntime Inno Setup 安装脚本
; 编译前准备：
;   1. 运行 packaging\build.ps1 生成 dist\AgentRuntime\
;   2. 下载 nssm.exe 放到 packaging\ 目录（https://nssm.cc/download）
; 然后用 Inno Setup 打开本文件编译，生成 AgentRuntime-Setup.exe

#define MyAppName "AgentRuntime"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Your Company"
#define MyAppExeName "AgentRuntime.exe"

[Setup]
AppId={{8E5C1F2A-3B4D-4E5F-9A6B-7C8D9E0F1A2B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=output
OutputBaseFilename=AgentRuntime-Setup
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Dirs]
; 日志目录预创建
Name: "{commonappdata}\AgentRuntime\logs"

[Files]
; 打包产物（onedir 整个目录）
Source: "..\dist\AgentRuntime\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; NSSM
Source: "nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
; 配置模板（已存在则不覆盖，保留用户修改）
Source: "..\config.example.yaml"; DestDir: "{commonappdata}\AgentRuntime"; DestName: "config.yaml"; Flags: onlyifdoesntexist

[Run]
; 注册并启动 Windows 服务（开机自启）
Filename: "{app}\nssm.exe"; Parameters: "install AgentRuntime ""{app}\{#MyAppExeName}"""; StatusMsg: "正在注册 Windows 服务..."; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set AgentRuntime AppDirectory ""{app}"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set AgentRuntime AppEnvironmentExtra AGENTRUNTIME_CONFIG={commonappdata}\AgentRuntime\config.yaml"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set AgentRuntime AppStdout {commonappdata}\AgentRuntime\logs\service.out.log"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set AgentRuntime AppStderr {commonappdata}\AgentRuntime\logs\service.err.log"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set AgentRuntime Start SERVICE_AUTO_START"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set AgentRuntime DisplayName AgentRuntime MCP Server"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "start AgentRuntime"; StatusMsg: "正在启动服务..."; Flags: runhidden

[UninstallRun]
Filename: "{app}\nssm.exe"; Parameters: "stop AgentRuntime"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "remove AgentRuntime confirm"; Flags: runhidden
