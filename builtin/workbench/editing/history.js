import { ChangeSet, Text } from '@codemirror/state';
import { diffChars } from 'diff';

const GROUP_DELAY = 750, DIFF_TIMEOUT = 150;
export const asText = value => Text.of(value.split(/\r\n?|\n/));

export function textChanges(before, after) {
  if (before === after || before.eq(after)) return ChangeSet.empty(before.length);
  const parts = diffChars(before.toString(), after.toString(), { timeout: DIFF_TIMEOUT });
  if (!parts) throw new Error('WORKBENCH_UNDO_CONFLICT');
  let position = 0;
  const changes = [];
  for (const part of parts) {
    if (part.added) changes.push({ from: position, insert: part.value });
    else if (part.removed) { changes.push({ from: position, to: position + part.value.length }); position += part.value.length; }
    else position += part.value.length;
  }
  return ChangeSet.of(changes, before.length);
}

function overlap(first, second) {
  let conflict = false;
  first.iterChangedRanges((from, to) => second.iterChangedRanges((otherFrom, otherTo) => {
    if (from === to && otherFrom === otherTo ? from === otherFrom
      : from === to ? from > otherFrom && from < otherTo
        : otherFrom === otherTo ? otherFrom > from && otherFrom < to : from < otherTo && otherFrom < to) conflict = true;
  }));
  return conflict;
}

/** 只撤回该次修改的范围，其他会话或磁盘上的非重叠修改保留。 */
export function undoChanges(entry, current) {
  const external = textChanges(entry.after, current), inverse = entry.changes.invert(entry.before);
  return mapChanges(inverse, external);
}
export function mapChanges(changes, through) {
  if (overlap(changes, through)) throw new Error('WORKBENCH_UNDO_CONFLICT');
  return changes.map(through);
}

export function createHistory(release = () => {}) {
  const owners = new Map();
  let limit = 1000;
  const stack = owner => { if (!owners.has(owner)) owners.set(owner, { undo: [], redo: [] }); return owners.get(owner); };
  const discard = entries => { const tokens = entries.flatMap(entry => entry.token ? [entry.token] : []); if (tokens.length) release(tokens); };
  function trim(history) {
    let extra = history.undo.length + history.redo.length - limit;
    if (extra > 0) { const removed = history.undo.splice(0, extra); extra -= removed.length; if (extra > 0) removed.push(...history.redo.splice(0, extra)); discard(removed); }
  }
  return {
    limit(value) { limit = value; for (const history of owners.values()) trim(history); },
    record(owner, entry) {
      const history = stack(owner), previous = history.undo.at(-1), now = Date.now();
      discard(history.redo.splice(0));
      if (entry.kind === 'text' && entry.group && previous?.kind === 'text' && previous.group === entry.group && previous.path === entry.path && previous.after === entry.before && now - previous.time < GROUP_DELAY) {
        previous.after = entry.after; previous.changes = previous.changes.compose(entry.changes); previous.time = now;
      } else history.undo.push({ ...entry, time: now });
      trim(history);
    },
    peek(owner, direction, path) {
      const entries = stack(owner)[direction];
      return entries.findLast(entry => path && (entry.path === path || entry.kind === 'file' && path.startsWith(`${entry.path}/`))) || entries.at(-1) || null;
    },
    complete(owner, direction, entry, reverse) {
      const history = stack(owner), source = history[direction], position = source.indexOf(entry);
      if (position < 0) throw new Error('WORKBENCH_UNDO_CONFLICT');
      source.splice(position, 1); history[direction === 'undo' ? 'redo' : 'undo'].push(reverse); trim(history);
    },
    dispose() { for (const history of owners.values()) discard([...history.undo, ...history.redo]); owners.clear(); },
  };
}
