using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class SuperCodeWindow : Form {
    private readonly WebView2 web = new WebView2();
    private readonly string profile = Path.Combine(Path.GetTempPath(), "SuperCode.Window-" + Guid.NewGuid().ToString("N"));
    private int result;
    private bool loaded;
    private SuperCodeWindow() {
        Text = "Super Code"; Width = 1180; Height = 800; MinimumSize = new System.Drawing.Size(520, 360);
        web.Dock = DockStyle.Fill; Controls.Add(web);
        Shown += async (sender, args) => { await Start(); };
        FormClosed += (sender, args) => web.Dispose();
        FormClosing += async (sender, args) => {
            if (!loaded || result != 0 || web.CoreWebView2 == null) return;
            args.Cancel = true;
            try {
                if (await web.CoreWebView2.ExecuteScriptAsync("globalThis.__superCodeCloseWindow?.() ?? false") == "false") { loaded = false; Close(); }
            }
            catch { result = 3; Close(); }
        };
    }
    private async Task Start() {
        try {
            Uri url;
            if (!Uri.TryCreate(Environment.GetEnvironmentVariable("SC_WINDOW_URL"), UriKind.Absolute, out url)
                || url.Scheme != "http" || url.Host != "127.0.0.1" || url.IsDefaultPort) throw new ArgumentException();
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false; core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.NavigationStarting += (sender, args) => {
                Uri next;
                args.Cancel = !Uri.TryCreate(args.Uri, UriKind.Absolute, out next) || next.GetLeftPart(UriPartial.Authority) != url.GetLeftPart(UriPartial.Authority);
            };
            core.NewWindowRequested += (sender, args) => args.Handled = true;
            core.PermissionRequested += (sender, args) => args.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (sender, args) => args.Cancel = true;
            core.ProcessFailed += (sender, args) => { result = 4; Close(); };
            core.NavigationCompleted += (sender, args) => { loaded = args.IsSuccess; if (!args.IsSuccess) { result = 3; Close(); } };
            core.Navigate(url.AbsoluteUri);
        } catch { result = 2; Close(); }
    }
    [STAThread]
    private static int Main() {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        var window = new SuperCodeWindow(); Application.Run(window);
        // WebView 退出需要先释放句柄，重试只清理本窗口新建的临时目录。
        for (int attempt = 0; attempt < 20; attempt++) {
            try { if (Directory.Exists(window.profile)) Directory.Delete(window.profile, true); break; }
            catch (IOException) { System.Threading.Thread.Sleep(100); }
            catch (UnauthorizedAccessException) { break; }
        }
        return window.result;
    }
}
