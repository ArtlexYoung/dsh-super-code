import { createWindowHost } from './host.js';
import { zh, en } from '../locales.js';

const OPEN_TIMEOUT_MS = 16000;

/** 每个连接独立清理；关掉或失败的窗口不能影响主页面和其他窗口。 */
export function createWindowRoute(workbench, api, t, createView = async presentation => {
  if (presentation.kind === 'file') {
    await workbench.visit({ file: presentation.file, ...(presentation.editorKind ? { kind: presentation.editorKind } : {}) });
    workbench.keepTab?.(presentation.file);
  }
  return { workbench, dispose() {} };
}) {
  const windows = new Set();
  let disposed = false;
  function publish() {
    const all = [...windows], current = all.findLast(state => state.ready) || all.at(-1);
    workbench.keepAlive(!!current);
    workbench.windowState(current ? { state: current.ready ? 'active' : 'opening', presentation: current.presentation, count: all.length } : null);
  }
  function closeWindow(previous, error) {
    if (!windows.delete(previous)) return;
    const preserveText = error && previous.ready;
    clearTimeout(previous.timer); previous.host?.dispose(); previous.view?.dispose();
    // 就绪后的异常断连让外部窗口显示只读副本，不能抢先关闭而丢失未确认输入。
    if (!preserveText) {
      previous.popup?.close();
      // 未就绪时先主动关窗，再断开流，避免后端把空白窗口当作只读副本保留。
      const closing = previous.id ? api.close(previous.id) : Promise.resolve();
      void closing.catch(() => {}).finally(() => previous.abort.abort());
    } else previous.abort.abort();
    publish();
    if (error && error.message !== 'WORKBENCH_WINDOW_CLOSED' && error.name !== 'AbortError') workbench.fail(new Error('WORKBENCH_WINDOW_FALLBACK', { cause: error }));
  }
  const close = error => { for (const state of [...windows]) closeWindow(state, error); };
  return {
    async open(request, native = false) {
      if (disposed) return;
      const presentation = typeof request === 'string' ? { kind: 'file', file: request } : request || { kind: 'workbench' };
      const opening = [...windows].find(state => !state.ready && JSON.stringify(state.presentation) === JSON.stringify(presentation));
      if (opening) { opening.popup?.focus(); return; }
      let popup = null;
      if (!native) try {
        const opened = window.open('', '_blank', 'popup,width=1180,height=800');
        if (opened && !opened.closed) popup = opened;
      } catch { /* 宿主禁止创建浏览器窗口时继续用系统窗口。 */ }
      const state = { popup, presentation, ready: false, abort: new AbortController(), timer: null, id: null, host: null, view: null };
      windows.add(state); publish();
      const finish = error => closeWindow(state, error);
      state.timer = setTimeout(() => finish(new Error('WORKBENCH_WINDOW_TIMEOUT')), OPEN_TIMEOUT_MS);
      try {
        state.view = await createView(presentation);
        if (!windows.has(state)) { state.view.dispose(); return; }
        async function openAddress(native) {
          const address = await api.open(native, state.abort.signal);
          if (!windows.has(state)) { void api.close(address.id).catch(() => {}); return; }
          state.id = address.id;
          return address;
        }
        let address = await openAddress(!state.popup);
        if (!address) return;
        if (state.popup) {
          try {
            if (state.popup.closed) throw new Error('WORKBENCH_WINDOW_CLOSED');
            state.popup.location.replace(address.url);
          } catch {
            state.popup.close(); state.popup = null;
            await api.close(address.id);
            state.id = null;
            address = await openAddress(true);
            if (!address) return;
          }
        }
        let queue = Promise.resolve();
        const send = content => { queue = queue.then(() => api.send(address.id, content, state.abort.signal)); return queue; };
        state.host = createWindowHost(state.view.workbench, send, finish, {
          translations: Object.fromEntries(Object.keys({ ...zh, ...en }).map(key => [key, t(key)])),
          dark: document.body.hasAttribute('data-ds-dark-theme'),
          presentation,
        }, () => { state.ready = true; clearTimeout(state.timer); state.timer = null; publish(); });
        for await (const event of api.events(address.id, state.abort.signal)) {
          if (!windows.has(state)) break;
          if (event.kind === 'closed') {
            finish(state.ready && event.reason === 'WORKBENCH_WINDOW_CLOSED' ? undefined : new Error(event.reason)); break;
          }
          if (event.kind === 'ping') await send('');
          else void state.host.accept(event.content).catch(finish);
        }
        finish(new Error('WORKBENCH_WINDOW_DISCONNECTED'));
      } catch (error) { finish(error); }
    },
    close,
    dispose() { disposed = true; close(); },
  };
}
