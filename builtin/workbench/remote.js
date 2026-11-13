const schema = { parse(value) { if (typeof value !== 'string') throw new Error('Expected string'); return value; } };
const codec = { mode: 'strict', typeSymbol: 'string', schema, create: () => schema };
export const descriptors = Object.entries({ list: ['sessionId', 'path'], read: ['sessionId', 'path'], save: ['sessionId', 'content'], project: ['sessionId'], assist: ['sessionId', 'content'], git: ['sessionId', 'content'] }).map(([method, names]) => ({
  id: `dsh-super-code:superCodeWorkbench/${method}`, service: 'superCodeWorkbench', namespace: 'superCodeWorkbench', method,
  ...(['assist', 'git'].includes(method) ? { mode: 'stream' } : {}),
  invocation: { kind: 'direct' }, parameters: names.map(name => ({ name, wire: name, source: 'json', codec })),
  cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
}));

export function workspaceApi(remote, sessionId) {
  async function call(method, args, signal) {
    const result = await remote[method](sessionId, ...args, signal);
    if (!result.ok) throw new Error(result.error?.message || 'WORKBENCH_REMOTE');
    return result.value;
  }
  return {
    list: (path, signal) => call('list', [path], signal),
    read: (path, signal) => call('read', [path], signal),
    save: (content, signal) => call('save', [JSON.stringify(content)], signal),
    project: signal => call('project', [], signal),
    async git(content, signal) {
      let result;
      for await (const value of remote.git(sessionId, JSON.stringify(content), signal)) result = value;
      if (!result) throw new Error('WORKBENCH_GIT_INCOMPLETE');
      return result;
    },
    async assist(content, signal) {
      let result;
      // 使用宿主的逻辑流传递取消，避免桌面协议转发滞留普通 HTTP 请求。
      for await (const value of remote.assist(sessionId, JSON.stringify(content), signal)) result = value;
      if (!result) throw new Error('WORKBENCH_MODEL_INCOMPLETE');
      return result;
    },
  };
}
