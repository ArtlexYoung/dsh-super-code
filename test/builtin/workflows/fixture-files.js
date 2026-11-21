export const specFixtureFiles = {
  'openspec/changes/saved-search/proposal.md': '# 保存项目搜索条件\n\n## 为什么\n重复查找相同的文件时，不必每次重新填写筛选条件。\n\n## 变更范围\n- 保存关键词、目录与文件类型。\n- 在项目内恢复已保存的查询。\n\n## 验收\n关闭再打开页面后，仍可恢复同一组筛选条件。\n',
  'openspec/changes/saved-search/design.md': '# 设计\n\n以项目为单位保存筛选条件，文件类型与关键词分别记录。\n',
  'openspec/changes/saved-search/tasks.md': '# 实施任务\n\n- [x] 明确保存字段与数据结构\n- [x] 保存项目内的查询条件\n- [ ] 恢复筛选条件并验证搜索结果\n- [ ] 验证未保存的输入不被覆盖\n',
  'openspec/changes/saved-search/specs/search/filters/spec.md': '# 搜索筛选规格\n\n## Requirement: 恢复筛选条件\n\n重新打开项目后可恢复关键词、目录与文件类型。\n',
  'openspec/changes/archive/2026-11-19-sort-amounts/proposal.md': '# 金额排序\n\n金额按数值排序，订单编号保留为文本。\n',
};

export function fixtureFileApi(files) {
  return {
    async list(path, signal) {
      signal?.throwIfAborted();
      const prefix = path ? path + '/' : '', entries = new Map();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length), name = rest.split('/')[0];
        entries.set(name, { name, path: prefix + name, type: rest.includes('/') ? 'directory' : 'file' });
      }
      return { entries: [...entries.values()], truncated: false };
    },
    async read(path, signal) {
      signal?.throwIfAborted();
      if (!(path in files)) throw new Error('Missing file');
      return { path, text: files[path], version: 'fixture' };
    },
  };
}
