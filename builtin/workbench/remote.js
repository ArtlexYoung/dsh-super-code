const schema = { parse(value) { if (typeof value !== 'string') throw new Error('Expected string'); return value; } };
const codec = { mode: 'strict', typeSymbol: 'string', schema, create: () => schema };
export const descriptors = Object.entries({ list: ['sessionId', 'path'], read: ['sessionId', 'path'], save: ['sessionId', 'content'], project: ['sessionId'], storeIndex: ['sessionId', 'content'], environments: ['sessionId', 'content'], languageSources: ['sessionId', 'content'], searchProject: ['sessionId', 'content'], fileOperation: ['sessionId', 'content'], directory: ['sessionId'], recoverDirectory: ['sessionId', 'content'], assist: ['sessionId', 'content'], translate: ['sessionId', 'content'], models: ['sessionId'], fonts: ['sessionId'], git: ['sessionId', 'content'], reading: ['sessionId', 'content'], openWindow: ['sessionId', 'native'], windowEvents: ['sessionId', 'id'], windowMessage: ['sessionId', 'id', 'content'], closeWindow: ['sessionId', 'id'] }).map(([method, names]) => ({
  id: `dsh-super-code:superCodeWorkbench/${method}`, service: 'superCodeWorkbench', namespace: 'superCodeWorkbench', method,
  ...(['assist', 'translate', 'git', 'reading', 'searchProject', 'languageSources', 'windowEvents'].includes(method) ? { mode: 'stream' } : {}),
  invocation: { kind: 'direct' }, parameters: names.map(name => ({ name, wire: name, source: 'json', codec })),
  cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
}));

export function workspaceApi(remote, sessionId) {
  async function call(method, args, signal) {
    const result = await remote[method](sessionId, ...args, signal);
    if (!result.ok) throw new Error(result.error?.message || 'WORKBENCH_REMOTE');
    return result.value;
  }
  async function response(method, content, signal) {
    let result;
    for await (const value of remote[method](sessionId, JSON.stringify(content), signal)) { signal?.throwIfAborted(); result = value; }
    signal?.throwIfAborted();
    if (!result) throw new Error('WORKBENCH_MODEL_INCOMPLETE');
    return result;
  }
  return {
    windows: {
      open: (native, signal) => call('openWindow', [String(native)], signal),
      events: (id, signal) => remote.windowEvents(sessionId, id, signal),
      send: (id, content, signal) => call('windowMessage', [id, content], signal),
      close: (id, signal) => call('closeWindow', [id], signal),
    },
    list: (path, signal) => call('list', [path], signal),
    read: (path, signal) => call('read', [path], signal),
    save: (content, signal) => call('save', [JSON.stringify(content)], signal),
    project: signal => call('project', [], signal),
    storeIndex: (entries, signal) => call('storeIndex', [JSON.stringify(entries)], signal),
    environments: (paths, signal) => call('environments', [JSON.stringify(paths)], signal),
    async *languageSources(content, signal) {
      let complete = false;
      for await (const event of remote.languageSources(sessionId, JSON.stringify(content), signal)) {
        signal?.throwIfAborted();
        if (complete) throw new Error('WORKBENCH_REMOTE');
        if (event.kind === 'done') complete = true;
        yield event;
      }
      if (!complete) throw new Error('WORKBENCH_REMOTE');
    },
    async *searchProject(content, signal) {
      let complete = false;
      for await (const event of remote.searchProject(sessionId, JSON.stringify(content), signal)) {
        signal?.throwIfAborted();
        if (complete) throw new Error('WORKBENCH_REMOTE');
        if (event.kind === 'done') complete = true;
        yield event;
      }
      signal?.throwIfAborted();
      if (!complete) throw new Error('WORKBENCH_REMOTE');
    },
    fileOperation: (content, signal) => call('fileOperation', [JSON.stringify(content)], signal),
    models: signal => call('models', [], signal),
    fonts: signal => call('fonts', [], signal),
    assist: (content, signal) => response('assist', content, signal),
    translate: (content, signal) => response('translate', content, signal),
    async *reading(content, signal) {
      let complete = false;
      for await (const value of remote.reading(sessionId, JSON.stringify(content), signal)) {
        signal?.throwIfAborted();
        if (complete) throw new Error('READING_FORMAT');
        if (value.kind === 'done') complete = true;
        yield value;
      }
      signal?.throwIfAborted();
      if (!complete) throw new Error('WORKBENCH_MODEL_INCOMPLETE');
    },
    async git(content, signal) {
      let result;
      for await (const value of remote.git(sessionId, JSON.stringify(content), signal)) result = value;
      if (!result) throw new Error('WORKBENCH_GIT_INCOMPLETE');
      return result;
    },
  };
}
