const schema = { parse(value) { if (typeof value !== 'string') throw new Error('Expected string'); return value; } };
const codec = { mode: 'strict', typeSymbol: 'string', schema, create: () => schema };
export const descriptors = Object.entries({ list: ['sessionId', 'path'], read: ['sessionId', 'path'], save: ['sessionId', 'content'], project: ['sessionId'], searchProject: ['sessionId', 'content'], fileOperation: ['sessionId', 'content'], directory: ['sessionId'], recoverDirectory: ['sessionId', 'content'], assist: ['sessionId', 'content'], translate: ['sessionId', 'content'], models: ['sessionId'], git: ['sessionId', 'content'], reading: ['sessionId', 'content'] }).map(([method, names]) => ({
  id: `dsh-super-code:superCodeWorkbench/${method}`, service: 'superCodeWorkbench', namespace: 'superCodeWorkbench', method,
  ...(['assist', 'translate', 'git', 'reading', 'searchProject'].includes(method) ? { mode: 'stream' } : {}),
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
    list: (path, signal) => call('list', [path], signal),
    read: (path, signal) => call('read', [path], signal),
    save: (content, signal) => call('save', [JSON.stringify(content)], signal),
    project: signal => call('project', [], signal),
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
