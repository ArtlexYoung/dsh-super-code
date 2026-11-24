import { z } from 'zod/mini';

const MAX_BYTES = 2 * 1024 * 1024;
const coordinate = () => z.int().check(z.minimum(0), z.maximum(1e9));
const formats = {
  pins: z.lazy(() => {
    const thread = z.object({ id: z.string(), file: projectPath(), kind: z.enum(['code', 'translation']), language: z.optional(z.string()),
      line: coordinate(), character: coordinate(), from: coordinate(), to: coordinate(), original: z.string().check(z.minLength(1)), stale: z.boolean(),
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string(), mode: z.optional(z.enum(['ask', 'edit', 'translate'])) })) });
    return z.array(thread).check(z.refine(items => new Set(items.map(item => item.id)).size === items.length && items.every(item => item.from <= item.to)));
  }),
  reading: z.lazy(() => {
    const line = coordinate().check(z.minimum(1));
    const range = { file: projectPath(), fromLine: line, toLine: line };
    const orderedLines = z.refine(({ fromLine, toLine }) => fromLine <= toLine);
    const reference = z.object({ ...range, quote: z.string() }).check(orderedLines);
    const sources = z.array(z.object({ ...range, id: z.string(), text: z.string(), version: z.string() }).check(orderedLines));
    const refs = z.array(reference);
    const step = z.object({ title: z.string(), reason: z.string(), refs: refs.check(z.minLength(1)) });
    const plan = z.object({ title: z.string(), summary: z.string(), steps: z.array(step).check(z.minLength(1), z.maxLength(12)) });
    const explanation = z.object({ locale: z.string(), value: z.object({ sections: z.array(z.object({ title: z.string(), text: z.string(), refs })), sources, partial: z.boolean() }) });
    const index = coordinate();
    return z.object({ goal: z.string().check(z.minLength(1)), plan, planSources: sources, active: z.int().check(z.minimum(-1), z.maximum(1e9)),
      completed: z.array(index), explanations: z.array(z.tuple([index, explanation])) }).check(z.refine(value => value.active < value.plan.steps.length &&
        [...value.completed, ...value.explanations.map(([index]) => index)].every(index => index < value.plan.steps.length)));
  }),
};
const record = z.lazy(() => z.object({ version: z.literal(1), revision: coordinate().check(z.minimum(1)), text: z.string() }));

function projectPath() {
  return z.string().check(z.minLength(1), z.maxLength(4096), z.refine(value => !/[\\\0]/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..')));
}

function decode(kind, text) {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('WORKBENCH_STUDY_SIZE');
  try { return formats[kind].parse(JSON.parse(text)); }
  catch { throw new Error('WORKBENCH_STUDY_INVALID'); }
}

function open(factory) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('WORKBENCH_STUDY_STORAGE')); return; }
    const request = factory.open('dsh-super-code-workbench-study', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('artifacts');
    request.onsuccess = () => { const database = request.result; database.onversionchange = () => database.close(); resolve(database); };
    request.onerror = request.onblocked = () => reject(new Error('WORKBENCH_STUDY_STORAGE'));
  });
}

export function createStudyStore(sessionId, factory = globalThis.indexedDB) {
  let database;
  return (root, kind) => {
    const key = JSON.stringify([sessionId, root, kind]);
    async function transact(mode, action) {
      const connection = await (database ||= open(factory).catch(error => { database = null; throw error; }));
      return new Promise((resolve, reject) => {
        const transaction = connection.transaction('artifacts', mode), store = transaction.objectStore('artifacts');
        let failure, result;
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(failure || new Error('WORKBENCH_STUDY_STORAGE'));
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            const previous = request.result === undefined ? null : record.safeParse(request.result);
            if (previous && !previous.success) throw new Error('WORKBENCH_STUDY_INVALID');
            result = action(previous?.data, next => store.put(next, key));
          } catch (error) { failure = error; transaction.abort(); }
        };
      });
    }
    return {
      empty: kind === 'pins' ? '[]' : undefined,
      read: () => transact('readonly', previous => previous && { ...previous, data: decode(kind, previous.text) }),
      save(text, revision) {
        decode(kind, text);
        return transact('readwrite', (previous, write) => {
          if ((previous?.revision || 0) !== revision) throw new Error('WORKBENCH_STUDY_CHANGED');
          const next = revision + 1;
          write({ version: 1, revision: next, text }); return next;
        });
      },
    };
  };
}

/** 订阅当前工作台记录；换目录时捕获最后一份状态后再解绑。 */
export function connectStudy(slot, { restore, archive, subscribe }, report, after = Promise.resolve()) {
  let last, revision = 0, queued, timer, writing, closed = false, loaded = false;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(capture, 120); };
  const unsubscribe = subscribe(schedule);
  const ready = after.then(slot.read).then(saved => {
    if (closed) return;
    revision = saved?.revision || 0; last = saved?.text ?? slot.empty; loaded = true;
    if (saved) restore(saved.data);
    report();
    capture();
  }).catch(report);
  function capture() {
    if (!loaded) return;
    const data = archive();
    if (data === undefined) return;
    queued = JSON.stringify(data);
    if (!writing && queued !== last) writing = save().finally(() => { writing = null; });
  }
  async function save() {
    try {
      while (queued !== undefined && queued !== last) {
        const text = queued;
        revision = await slot.save(text, revision); last = text;
      }
      report();
    } catch (error) { report(error); }
  }
  return { ready, close() { closed = true; unsubscribe(); clearTimeout(timer); capture(); return writing; } };
}
