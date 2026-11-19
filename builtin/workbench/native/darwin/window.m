#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface SuperCodeWindow : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate>
@property NSWindow *window;
@property WKWebView *web;
@property NSURL *url;
@property int result;
@property BOOL loaded;
@end

@implementation SuperCodeWindow
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    self.url = [NSURL URLWithString:NSProcessInfo.processInfo.environment[@"SC_WINDOW_URL"] ?: @""];
    if (![self.url.scheme isEqualToString:@"http"] || ![self.url.host isEqualToString:@"127.0.0.1"] || !self.url.port) {
        self.result = 2; [NSApp terminate:nil]; return;
    }
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    config.preferences.javaScriptCanOpenWindowsAutomatically = NO;
    self.web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 1180, 800) configuration:config];
    self.web.navigationDelegate = self; self.web.UIDelegate = self;
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(160, 120, 1180, 800)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Super Code"; self.window.releasedWhenClosed = NO;
    self.window.minSize = NSMakeSize(520, 360); self.window.delegate = self;
    self.window.contentView = self.web; [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [self.web loadRequest:[NSURLRequest requestWithURL:self.url]];
}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))done {
    NSURL *url = action.request.URL;
    BOOL allowed = [url.scheme isEqualToString:self.url.scheme] && [url.host isEqualToString:self.url.host] && [url.port isEqualToNumber:self.url.port];
    done(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (WKWebView *)webView:(WKWebView *)web createWebViewWithConfiguration:(WKWebViewConfiguration *)config forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features { return nil; }
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { self.result = 3; [NSApp terminate:nil]; }
- (void)webView:(WKWebView *)web didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error { self.result = 3; [NSApp terminate:nil]; }
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)web { self.result = 4; [NSApp terminate:nil]; }
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)navigation { self.loaded = YES; }
- (BOOL)windowShouldClose:(NSWindow *)window {
    if (!self.loaded) return YES;
    [self.web evaluateJavaScript:@"globalThis.__superCodeCloseWindow?.() ?? false" completionHandler:^(id value, NSError *error) {
        if (error || ![value boolValue]) [NSApp terminate:nil];
    }];
    return NO;
}
- (void)windowWillClose:(NSNotification *)note { [NSApp terminate:nil]; }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app { return YES; }
- (void)applicationWillTerminate:(NSNotification *)note { [self.web stopLoading]; self.web = nil; }
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        SuperCodeWindow *delegate = [SuperCodeWindow new]; app.delegate = delegate;
        [app run]; return delegate.result;
    }
}
