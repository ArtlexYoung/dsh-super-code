import { z } from 'zod/mini';

// 工作台关闭时也会注册宿主入口，等到读写会话时再构建校验规则。
const record = z.lazy(() => {
  const path = z.string().check(z.minLength(1), z.maxLength(4096), z.refine(value => !value.includes('\0')));
  const coordinate = z.int().check(z.minimum(0), z.maximum(1e9)), kind = z.enum(['file', 'markdown']);
  const location = z.object({ line: coordinate, character: coordinate, length: coordinate,
    viewport: z.optional(z.object({ line: coordinate, offset: z.number().check(z.minimum(0), z.maximum(1e6)), left: z.number().check(z.minimum(0), z.maximum(1e7)) })) });
  const tree = z.lazy(() => z.union([z.int().check(z.minimum(0), z.maximum(15)),
    z.object({ vertical: z.boolean(), ratio: z.number().check(z.minimum(.2), z.maximum(.8)), children: z.tuple([tree, tree]) })]));
  const tabs = z.array(z.object({ path, kind, pinned: z.boolean(), dirty: z.boolean(), location: z.optional(location) })).check(z.maxLength(50));
  const pane = z.object({ tabs, current: z.nullable(z.object({ file: path, kind })), recent: z.array(path).check(z.maxLength(50)) });
  return z.object({ version: z.literal(1), updatedAt: z.int().check(z.minimum(0)), tree, active: z.int().check(z.minimum(0)),
    panes: z.array(pane).check(z.minLength(1), z.maxLength(16)) });
});

function paneIndices(tree) {
  // 先限制树的大小，避免损坏的存储让递归校验无限深入。
  const queue = [tree];
  for (let index = 0; index < queue.length; index++) {
    if (queue.length > 31) throw new RangeError();
    if (Array.isArray(queue[index]?.children)) queue.push(...queue[index].children);
  }
  return queue.filter(node => typeof node === 'number');
}
function parse(value, capacityError = 'WORKBENCH_SESSION_INVALID') {
  let leaves, parsed;
  try {
    leaves = paneIndices(value?.tree);
    parsed = record.safeParse(value);
  } catch (error) {
    throw new Error(error instanceof RangeError ? capacityError : 'WORKBENCH_SESSION_INVALID');
  }
  if (!parsed.success) throw new Error(parsed.error.issues.some(issue => issue.code === 'too_big') ? capacityError : 'WORKBENCH_SESSION_INVALID');
  const result = parsed.data;
  if (result.active >= result.panes.length || leaves.length !== result.panes.length || new Set(leaves).size !== leaves.length || leaves.some(index => index >= result.panes.length)) throw new Error('WORKBENCH_SESSION_INVALID');
  return result;
}

/** 与布局设置使用同一客户端来源；只保存元数据，不保存源码、草稿或模型输出。 */
export function createWorkspaceSession(storage, sessionId) {
  const key = root => `dsh-super-code-workbench-session:${JSON.stringify([sessionId, root])}`;
  return {
    read(root) {
      let text;
      try { text = storage.getItem(key(root)); } catch { throw new Error('WORKBENCH_SESSION_READ'); }
      if (!text) return null;
      let value;
      try { if (text.length > 256 * 1024) throw new Error(); value = JSON.parse(text); } catch { throw new Error('WORKBENCH_SESSION_INVALID'); }
      return parse(value);
    },
    save(root, value) {
      const text = JSON.stringify(parse(value, 'WORKBENCH_SESSION_SIZE'));
      if (text.length > 256 * 1024) throw new Error('WORKBENCH_SESSION_SIZE');
      try { storage.setItem(key(root), text); } catch { throw new Error('WORKBENCH_SESSION_WRITE'); }
    },
  };
}
