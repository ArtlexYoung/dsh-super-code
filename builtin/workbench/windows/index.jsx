import React from 'react';
import { createRoot } from 'react-dom/client';
import { Workbench } from '../components/Workbench.jsx';
import { createWindowProxy } from './proxy.js';
import { encode, createMessageReader } from './protocol.js';
import { zh, en } from '../locales.js';
import { SafeMarkdown } from './markdown.jsx';
import { SelectControl as Select, ActionButton as Button } from '../../ui/controls.js';
import controlsStyle from '../../ui/style.css';
import stylesheet from '../style.css';
import fontStyles from '../fonts/style.js';

const token = location.hash.slice(1);
history.replaceState(null, '', '/');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const lifetime = new AbortController(), root = createRoot(document.getElementById('root'));
let proxy, presentation, mounted = false, heartbeat, outgoing = Promise.resolve();
let t = key => (navigator.language.startsWith('zh') ? zh : en)[key] || key;
globalThis.__superCodeCloseWindow = () => {
  if (lifetime.signal.aborted || !proxy) return false;
  void proxy.returnToHost().catch(disconnect); return true;
};
const style = document.createElement('style');
style.textContent = fontStyles + stylesheet + `html,body,#root{height:100%;margin:0}body{overflow:hidden}button,input,textarea{font:inherit}.sc-wb-native-notice{padding:24px;white-space:pre-wrap}.sc-wb-select{position:relative}.dsh-super-code-select{display:inline-flex}.dsh-super-code-select-trigger{border-color:var(--wb-line)!important}.dsh-super-code-select-trigger svg{width:16px;height:16px}.dsh-super-code-select-menu{position:fixed;z-index:2000000;overflow:auto;border:1px solid var(--wb-line);background:var(--wb-bg);box-shadow:0 4px 18px #0002;border-radius:6px;padding:4px}.dsh-super-code-select-option{display:flex;justify-content:space-between;gap:12px;cursor:pointer;padding:5px 9px}.dsh-super-code-select-option svg{width:16px;visibility:hidden}.dsh-super-code-select-option[aria-selected=true] svg{visibility:visible}.dsh-super-code-select-option[data-active=true]{background:var(--wb-hover)}`;
style.textContent += controlsStyle;
document.head.append(style);
root.render(<section className="sc-workbench sc-wb-native-notice" role="status">{t('windowLoading')}</section>);

function send(message) {
  const body = encode(message);
  // 保持草稿、编辑和返回操作的提交顺序，避免关窗先于最后一笔输入到达。
  outgoing = outgoing.then(async () => {
    lifetime.signal.throwIfAborted();
    const response = await fetch('/message', { method: 'POST', headers, body, signal: lifetime.signal });
    if (!response.ok) throw new Error('WORKBENCH_WINDOW_DISCONNECTED');
  });
  return outgoing;
}

function Conversation() {
  return <div className="sc-wb-native-notice"><p>{t('windowConversation')}</p><Button onClick={() => { void proxy.returnToHost(); }}>{t('windowReturn')}</Button></div>;
}

class WindowContent extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { disconnect(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

function disconnect(error) {
  if (lifetime.signal.aborted) return;
  clearInterval(heartbeat); lifetime.abort();
  const panes = proxy?.groups.snapshot().panes || [], snapshot = proxy?.snapshot();
  const buffers = panes.flatMap(({ pane }) => {
    const view = pane.workbench, file = view.snapshot()?.file, text = view.view()?.state.doc.toString();
    return file && text !== undefined ? [{ id: pane.id, file, text }] : [];
  });
  const drafts = panes.flatMap(({ pane }) => {
    const thread = pane.workbench.snapshot()?.assistant?.thread;
    return thread?.draft ? [{ id: pane.id, value: thread.draft }] : [];
  });
  proxy?.dispose();
  // 断连时不自动丢弃未确认的本地内容，仍可选中复制；原界面保留已确认状态。
  root.render(<section className="sc-workbench sc-wb-native-notice" data-palette={snapshot?.preferences.palette} style={{ height: '100%', boxSizing: 'border-box', overflow: 'auto' }}><p role="alert">{t(error.message === 'WORKBENCH_WINDOW_CONFLICT' ? 'WORKBENCH_WINDOW_CONFLICT' : 'WORKBENCH_WINDOW_FALLBACK')}</p>
    {buffers.map(({ id, file, text }) => <label key={id}>{file}<textarea readOnly value={text} style={{ width: '100%', height: buffers.length > 1 || drafts.length ? '40vh' : '70vh' }} aria-label={t('title')} /></label>)}
    {drafts.map(({ id, value }) => <label key={id}>{t('question')}<textarea readOnly value={value} style={{ width: '100%', minHeight: 100 }} aria-label={t('question')} /></label>)}</section>);
}

async function run() {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('WORKBENCH_WINDOW_PROTOCOL');
  // WebKit 可能等首条正文才交付接收流；握手不能反过来等待这个流。
  const [response] = await Promise.all([
    fetch('/events', { headers, signal: lifetime.signal }),
    send({ kind: 'hello' }),
  ]);
  if (!response.ok || !response.body) throw new Error('WORKBENCH_WINDOW_DISCONNECTED');
  heartbeat = setInterval(() => { void send({ kind: 'ping' }).catch(disconnect); }, 3000);
  const reader = response.body.getReader(), decoder = new TextDecoder(), readMessage = createMessageReader(); let buffer = '';
  for (;;) {
    const result = await reader.read();
    if (result.done) throw new Error('WORKBENCH_WINDOW_DISCONNECTED');
    buffer += decoder.decode(result.value, { stream: true });
    for (let position; (position = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, position); buffer = buffer.slice(position + 1);
      if (!line) continue;
      const message = readMessage(line);
      if (!message || message.kind === 'ping') continue;
      if (message.kind === 'init') {
        if (proxy) throw new Error('WORKBENCH_WINDOW_PROTOCOL');
        const metadata = message.metadata; t = key => metadata.translations[key] || key;
        presentation = metadata.presentation || { kind: 'workbench' };
        if (metadata.dark) document.body.setAttribute('data-ds-dark-theme', '');
        proxy = createWindowProxy(send, t, { canSplit: presentation.kind === 'workbench' });
      } else {
        if (!proxy) throw new Error('WORKBENCH_WINDOW_PROTOCOL');
        await proxy.accept(message);
        if (!mounted && message.kind === 'state') {
          mounted = true;
          root.render(<WindowContent><Workbench workbench={proxy} Button={Button} Select={Select} MarkdownText={SafeMarkdown} Conversation={Conversation} sessionId="window" presentation={presentation} t={t} /></WindowContent>);
        }
      }
    }
  }
}
window.addEventListener('unhandledrejection', event => { event.preventDefault(); disconnect(event.reason instanceof Error ? event.reason : new Error('WORKBENCH_WINDOW_DISCONNECTED')); });
void run().catch(disconnect);
