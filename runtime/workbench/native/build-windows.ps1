param([Parameter(Mandatory=$true)][string] $WebView2Sdk)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$target=Join-Path $root 'builtin/workbench/native/win32'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$core=Join-Path $WebView2Sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$forms=Join-Path $WebView2Sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$executable=Join-Path $target 'SuperCode.Window.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ "/out:$executable" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/reference:$core" "/reference:$forms" (Join-Path $target 'Window.cs')
if ($LASTEXITCODE -ne 0) { throw 'Window compilation failed' }
Copy-Item -LiteralPath $core,$forms -Destination $target -Force
[IO.File]::WriteAllText((Join-Path $target 'SuperCode.Window.exe.config'), '<?xml version="1.0" encoding="utf-8"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.6.2"/></startup></configuration>', (New-Object Text.UTF8Encoding($false)))
foreach($arch in @('arm64','x64','x86')) {
    $relative="runtimes/win-$arch/native"
    New-Item -ItemType Directory -Force (Join-Path $target $relative) | Out-Null
    Copy-Item -LiteralPath (Join-Path $WebView2Sdk "$relative/WebView2Loader.dll") -Destination (Join-Path $target $relative) -Force
}
Copy-Item -LiteralPath (Join-Path $WebView2Sdk 'LICENSE.txt') -Destination (Join-Path $target 'WebView2.LICENSE.txt') -Force
