/** 仅用于窗口边界，Map 和错误保留原语义；不会序列化控制器或编辑器对象。 */
import { uniqueId } from '../id.js';
const symbols = new Map();
export function encode(value) {
  return JSON.stringify(value, (_key, item) => item instanceof Map ? { $map: [...item] }
    : item instanceof Error ? { $error: item.message, name: item.name }
      : typeof item === 'symbol' ? symbolId(item) : item);
}
function symbolId(value) { if (!symbols.has(value)) symbols.set(value, `window:${uniqueId()}`); return symbols.get(value); }
export function decode(content) {
  return JSON.parse(content, (_key, item) => item && typeof item === 'object'
    ? Array.isArray(item.$map) && Object.keys(item).length === 1 ? new Map(item.$map)
      : typeof item.$error === 'string' ? Object.assign(new Error(item.$error), { name: item.name }) : item : item);
}

// 传输帧按字符分片，即使再次进行 JSON 转义，也低于后端的单条消息限制。
const FRAME_CHARS = 256 * 1024;
export function createMessageSender(send) {
  let outgoing = Promise.resolve();
  return value => {
    outgoing = outgoing.then(async () => {
      const content = encode(value);
      if (content.length <= FRAME_CHARS) { await send(content); return; }
      for (let at = 0; at < content.length; at += FRAME_CHARS) {
        await send(encode({ kind: 'chunk', content: content.slice(at, at + FRAME_CHARS), last: at + FRAME_CHARS >= content.length }));
      }
    });
    return outgoing;
  };
}
export function createMessageReader() {
  let parts = [];
  return content => {
    const message = decode(content);
    if (message.kind === 'ping') return message;
    if (message.kind !== 'chunk') {
      if (parts.length) throw new Error('WORKBENCH_WINDOW_PROTOCOL');
      return message;
    }
    if (typeof message.content !== 'string' || message.content.length > FRAME_CHARS || typeof message.last !== 'boolean') throw new Error('WORKBENCH_WINDOW_PROTOCOL');
    parts.push(message.content);
    if (!message.last) return null;
    const value = decode(parts.join('')); parts = [];
    if (value.kind === 'chunk') throw new Error('WORKBENCH_WINDOW_PROTOCOL');
    return value;
  };
}

export function createRequests(send) {
  let sequence = 0, closed = false;
  const pending = new Map();
  function request(method, args = [], { signal, progress, waitForCompletion = false } = {}) {
    if (closed) return Promise.reject(new Error('WORKBENCH_WINDOW_DISCONNECTED'));
    signal?.throwIfAborted();
    // JSON 数组会把 undefined 变为 null，省略尾部空参数才能保留默认参数语义。
    let length = args.length;
    while (length && args[length - 1] === undefined) length--;
    args = args.slice(0, length);
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        // 写入已经开始时，仍需接收成功项的进度，才能安全地继续处理剩余文件。
        if (!waitForCompletion) { pending.delete(id); reject(signal.reason); }
        void send({ kind: 'cancel', id }).catch(error => { if (pending.delete(id)) { cleanup(); reject(error); } });
      };
      const cleanup = () => signal?.removeEventListener('abort', cancel);
      pending.set(id, { resolve, reject, cleanup, progress }); signal?.addEventListener('abort', cancel, { once: true });
      Promise.resolve(send({ kind: 'call', id, method, args })).catch(error => {
        if (pending.delete(id)) { cleanup(); reject(error); }
      });
    });
  }
  return {
    request,
    accept(message) {
      const item = pending.get(message.id); if (!item) return;
      if (message.kind === 'progress') { item.progress?.(message.value); return; }
      pending.delete(message.id); item.cleanup();
      if (message.kind === 'error') item.reject(new Error(message.error)); else item.resolve(message.value);
    },
    close(error = new Error('WORKBENCH_WINDOW_DISCONNECTED')) {
      closed = true;
      for (const item of pending.values()) { item.cleanup(); item.reject(error); }
      pending.clear();
    },
  };
}
