import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceApi } from '../../../builtin/workbench/remote.js'

test('字体目录是只读普通请求，支持全局设置并传递取消及错误', async () => {
  const signal = new AbortController().signal
  const remote = { async fonts(id: string, received: AbortSignal) { assert.equal(id, ''); assert.equal(received, signal); return { ok: true, value: ['Menlo', 'PingFang SC'] } } }
  assert.deepEqual(await workspaceApi(remote, '').fonts(signal), ['Menlo', 'PingFang SC'])
  await assert.rejects(workspaceApi({ async fonts() { return { ok: false, error: { message: 'WORKBENCH_FONTS_UNAVAILABLE' } } } }, '').fonts(signal), /WORKBENCH_FONTS_UNAVAILABLE/)
})

test('选区助手等待流完整结束后返回结果，流失败时不接受部分修改', async () => {
  const result = { kind: 'edit', replacement: 'count' }
  const remote = { async *assist() { yield result } }
  assert.deepEqual(await workspaceApi(remote, 'session').assist({}, new AbortController().signal), result)
  await assert.rejects(workspaceApi({ async *assist() {} }, 'session').assist({}), /WORKBENCH_MODEL_INCOMPLETE/)
  const failure = { async *assist() { yield result; throw new Error('connection closed') } }
  await assert.rejects(workspaceApi(failure, 'session').assist({}), /connection closed/)
})

test('选区助手把取消信号交给宿主流，取消后不返回修改', async () => {
  const started = Promise.withResolvers<void>(), abort = new AbortController()
  const remote = { async *assist(sessionId: string, content: string, signal: AbortSignal) {
    assert.equal(sessionId, 'session')
    assert.deepEqual(JSON.parse(content), { instruction: '修改' })
    started.resolve()
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    yield { kind: 'edit', replacement: 'late' }
  } }
  const pending = workspaceApi(remote, 'session').assist({ instruction: '修改' }, abort.signal)
  await started.promise
  abort.abort()
  await assert.rejects(pending)
})

test('Git 请求使用当前会话的流，空流或中途失败不返回成功状态', async () => {
  const signal = new AbortController().signal
  const result = { kind: 'state', state: { backend: 'builtin' } }
  const remote = { async *git(sessionId: string, content: string, received: AbortSignal) {
    assert.equal(sessionId, 'git-session'); assert.deepEqual(JSON.parse(content), { action: 'status' }); assert.equal(received, signal)
    yield result
  } }
  assert.deepEqual(await workspaceApi(remote, 'git-session').git({ action: 'status' }, signal), result)
  await assert.rejects(workspaceApi({ async *git() {} }, 's').git({ action: 'status' }), /WORKBENCH_GIT_INCOMPLETE/)
  await assert.rejects(workspaceApi({ async *git() { yield result; throw new Error('interrupted') } }, 's').git({ action: 'status' }), /interrupted/)
})

test('文件操作序列化当前会话与取消信号，后端失败不伪装成成功', async () => {
  const input = { action: 'createFile', path: '中文 文件.ts' }, signal = new AbortController().signal
  const remote = { async fileOperation(id: string, content: string, received: AbortSignal) {
    assert.equal(id, 'session'); assert.deepEqual(JSON.parse(content), input); assert.equal(received, signal)
    return { ok: true, value: { path: input.path } }
  } }
  assert.deepEqual(await workspaceApi(remote, 'session').fileOperation(input, signal), { path: input.path })
  await assert.rejects(workspaceApi({ async fileOperation() { return { ok: false, error: { message: 'WORKBENCH_FILE_EXISTS' } } } }, 's').fileOperation(input), /WORKBENCH_FILE_EXISTS/)
})

test('翻译复用可取消的逻辑流，只有完整结束后才返回；模型目录使用当前会话', async () => {
  const input = { instruction: '翻译“hello”为中文', history: [] }, signal = new AbortController().signal
  const remote = { async *translate(id: string, content: string, received: AbortSignal) {
    assert.equal(id, 'session'); assert.deepEqual(JSON.parse(content), input); assert.equal(received, signal)
    yield { kind: 'ask', text: '你好' }
  }, async models(id: string, received: AbortSignal) { assert.equal(id, 'session'); assert.equal(received, signal); return { ok: true, value: [] } } }
  assert.deepEqual(await workspaceApi(remote, 'session').translate(input, signal), { kind: 'ask', text: '你好' })
  assert.deepEqual(await workspaceApi(remote, 'session').models(signal), [])
  await assert.rejects(workspaceApi({ async *translate() {} }, 'session').translate(input), /WORKBENCH_MODEL_INCOMPLETE/)
  await assert.rejects(workspaceApi({ async *translate() { yield { kind: 'ask', text: 'partial' }; throw new Error('interrupted') } }, 'session').translate(input), /interrupted/)
})

test('项目搜索转发位置批次、缓冲身份与取消信号，缺少完成或完成后还有事件均报错', async () => {
  const query = { search: 'needle', replace: '', caseSensitive: false, locations: true, buffers: ['notes.txt'] }, signal = new AbortController().signal
  const batch = { kind: 'matches', path: 'notes.txt', version: 'v1', matches: [{ line: 1, character: 2, length: 6, lineText: '  needle' }] }
  const done = { kind: 'done', scanned: 1, skipped: 0 }
  const collect = async (remote: any) => { const events = []; for await (const event of workspaceApi(remote, 'demo').searchProject(query, signal)) events.push(event); return events }
  assert.deepEqual(await collect({ async *searchProject(id: string, content: string, received: AbortSignal) {
    assert.equal(id, 'demo'); assert.deepEqual(JSON.parse(content), query); assert.equal(received, signal); yield batch; yield done
  } }), [batch, done])
  await assert.rejects(collect({ async *searchProject() { yield batch } }), /WORKBENCH_REMOTE/)
  await assert.rejects(collect({ async *searchProject() { yield done; yield batch } }), /WORKBENCH_REMOTE/)
  await assert.rejects(collect({ async *searchProject() { yield batch; throw new Error('ACCESS_DENIED') } }), /ACCESS_DENIED/)
})


test('索引元数据走所选会话的普通请求，保留取消和持久化结果', async () => {
  const signal = new AbortController().signal, entries = [{ path: 'main.ts', version: 'v1', filter: [] }]
  const remote = { async storeIndex(id: string, content: string, received: AbortSignal) {
    assert.equal(id, 'session'); assert.equal(received, signal); assert.deepEqual(JSON.parse(content), entries)
    return { ok: true, value: { persisted: false } }
  } }
  assert.deepEqual(await workspaceApi(remote, 'session').storeIndex(entries, signal), { persisted: false })
})

test('语言环境与源码查询传递会话和配置，流缺少结束或结束后继续均拒绝',async()=>{
 const signal=new AbortController().signal,input={language:'python',module:'demo',paths:{python:'venv'}}
 const remote={async environments(id:string,content:string,active:AbortSignal){assert.equal(id,'session');assert.equal(active,signal);assert.deepEqual(JSON.parse(content),input.paths);return {ok:true,value:{environments:[],warnings:[]}}},async *languageSources(id:string,content:string,active:AbortSignal){assert.equal(id,'session');assert.equal(active,signal);assert.deepEqual(JSON.parse(content),input);yield {kind:'done',reason:'no-source'}}}
 const api=workspaceApi(remote,'session');assert.deepEqual(await api.environments(input.paths,signal),{environments:[],warnings:[]});assert.equal((await Array.fromAsync(api.languageSources(input,signal))).length,1)
 for(const events of [[],[{kind:'done'},{kind:'source'}]])await assert.rejects(async()=>Array.fromAsync(workspaceApi({async *languageSources(){yield*events}},'session').languageSources(input,signal)),/WORKBENCH_REMOTE/)
})
