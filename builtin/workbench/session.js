import { z } from 'zod';

const path = z.string().min(1).max(4096).refine(value => !value.includes('\0'));
const coordinate = z.number().int().min(0).max(1e9), kind = z.enum(['file', 'markdown']);
const location = z.object({ line: coordinate, character: coordinate, length: coordinate,
  viewport: z.object({ line: coordinate, offset: z.number().min(0).max(1e6), left: z.number().min(0).max(1e7) }).optional() });
const tree = z.lazy(() => z.union([z.number().int().min(0).max(15), z.object({ vertical: z.boolean(), ratio: z.number().min(.2).max(.8), children: z.tuple([tree, tree]) })]));
const record = z.object({ version: z.literal(1), updatedAt: z.number().int().min(0), tree, active: z.number().int().min(0),
  panes: z.array(z.object({ tabs: z.array(z.object({ path, kind, pinned: z.boolean(), dirty: z.boolean(), location: location.optional() })).max(50),
    current: z.object({ file: path, kind }).nullable(), recent: z.array(path).max(50) })).min(1).max(16) });

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
  try {
    const leaves = paneIndices(value?.tree), result = record.parse(value);
    if (result.active >= result.panes.length || leaves.length !== result.panes.length || new Set(leaves).size !== leaves.length || leaves.some(index => index >= result.panes.length)) throw new Error();
    return result;
  } catch (error) {
    if (error instanceof RangeError || error instanceof z.ZodError && error.issues.some(issue => issue.code === 'too_big')) throw new Error(capacityError);
    throw new Error('WORKBENCH_SESSION_INVALID');
  }
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
