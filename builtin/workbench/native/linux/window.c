#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>

/* 只链接 libc，运行时复用系统 GTK3/WebKitGTK；缺组件直接交回内嵌。 */
static void *gtk, *webkit;
static char *origin;
static void (*quit)(void);
static void close_result(void *web, void *result, void *window) {
    void *(*finish)(void *, void *, void **) = dlsym(webkit, "webkit_web_view_evaluate_javascript_finish");
    int (*boolean)(void *) = dlsym(webkit, "jsc_value_to_boolean");
    void (*unref)(void *) = dlsym(gtk, "g_object_unref");
    void (*destroy)(void *) = dlsym(gtk, "gtk_widget_destroy");
    void *value = finish(web, result, NULL);
    if (!value || !boolean(value)) destroy(window);
    if (value) unref(value);
}
static int close_window(void *window, void *event, void *web) {
    void (*evaluate)(void *, const char *, long, const char *, const char *, void *, void *, void *) = dlsym(webkit, "webkit_web_view_evaluate_javascript");
    if (!evaluate) return 0;
    evaluate(web, "globalThis.__superCodeCloseWindow?.() ?? false", -1, NULL, NULL, NULL, close_result, window); return 1;
}
static void stopped(void *view, int reason, void *unused) { quit(); }
static int permission(void *view, void *request, void *unused) {
    void (*deny)(void *) = dlsym(webkit, "webkit_permission_request_deny"); deny(request); return 1;
}
static void download(void *item, void *unused) {
    void (*cancel)(void *) = dlsym(webkit, "webkit_download_cancel"); cancel(item);
}
static int policy(void *view, void *decision, int type, void *unused) {
    if (type == 2) return 0;
    void *(*request_of)(void *) = dlsym(webkit, "webkit_navigation_policy_decision_get_request");
    const char *(*uri_of)(void *) = dlsym(webkit, "webkit_uri_request_get_uri");
    const char *uri = uri_of(request_of(decision));
    size_t length = strlen(origin);
    if (type == 1 || !uri || strncmp(uri, origin, length) || (uri[length] != '/' && uri[length] != '\0')) {
        void (*ignore)(void *) = dlsym(webkit, "webkit_policy_decision_ignore"); ignore(decision); return 1;
    }
    return 0;
}
int main(int argc, char **argv) {
    const char *url = getenv("SC_WINDOW_URL");
    if (!url || strncmp(url, "http://127.0.0.1:", 17)) return 2;
    char *end; long port = strtol(url + 17, &end, 10);
    if (port < 1 || port > 65535 || *end != '/') return 2;
    origin = strndup(url, end - url);
    gtk = dlopen("libgtk-3.so.0", RTLD_NOW | RTLD_LOCAL);
    webkit = dlopen("libwebkit2gtk-4.1.so.0", RTLD_NOW | RTLD_LOCAL);
    if (!webkit) webkit = dlopen("libwebkit2gtk-4.0.so.37", RTLD_NOW | RTLD_LOCAL);
    if (!gtk || !webkit) { free(origin); return 4; }
    int (*init)(int *, char ***) = dlsym(gtk, "gtk_init_check");
    if (!init(&argc, &argv)) { free(origin); return 3; }
    void *(*ephemeral)(void) = dlsym(webkit, "webkit_web_context_new_ephemeral");
    void *(*create)(void *) = dlsym(webkit, "webkit_web_view_new_with_context");
    void (*load)(void *, const char *) = dlsym(webkit, "webkit_web_view_load_uri");
    void *(*new_window)(int) = dlsym(gtk, "gtk_window_new");
    void (*title)(void *, const char *) = dlsym(gtk, "gtk_window_set_title");
    void (*size)(void *, int, int) = dlsym(gtk, "gtk_window_set_default_size");
    void (*add)(void *, void *) = dlsym(gtk, "gtk_container_add");
    void (*connect)(void *, const char *, void *, void *, void *, int) = dlsym(gtk, "g_signal_connect_data");
    void (*unref)(void *) = dlsym(gtk, "g_object_unref");
    void (*show)(void *) = dlsym(gtk, "gtk_widget_show_all");
    void (*run)(void) = dlsym(gtk, "gtk_main"); quit = dlsym(gtk, "gtk_main_quit");
    if (!ephemeral || !create || !load) { free(origin); return 4; }
    void *context = ephemeral(), *web = create(context), *window = new_window(0);
    title(window, "Super Code"); size(window, 1180, 800); add(window, web);
    connect(window, "destroy", quit, NULL, NULL, 0);
    connect(window, "delete-event", close_window, web, NULL, 0);
    connect(web, "decide-policy", policy, NULL, NULL, 0);
    connect(web, "permission-request", permission, NULL, NULL, 0);
    connect(web, "web-process-terminated", stopped, NULL, NULL, 0);
    connect(context, "download-started", download, NULL, NULL, 0);
    unref(context); load(web, url); show(window); run();
    free(origin); return 0;
}
