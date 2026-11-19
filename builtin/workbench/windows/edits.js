import { ChangeSet, EditorSelection, Transaction } from '@codemirror/state';
import { mapChanges } from '../editing/history.js';

/** 原控制器保留事务；外部窗口只提交从已知版本产生的修改。 */
export function createEditHost(view, send) {
  let version = 0, first = 0, file = null, acknowledging = null;
  const history = [];
  return {
    initial(path) {
      file = path; version = 0; first = 0; history.length = 0;
      const editor = view();
      return { file, version, text: editor?.state.doc.toString() || '', selection: editor?.state.selection.toJSON(), readOnly: editor?.state.readOnly || false };
    },
    changed(event) {
      if (event.file !== file) return;
      if (event.update.docChanged) {
        history.push(event.update.changes); version++;
        if (history.length > 1000) { history.shift(); first++; }
      }
      send({ kind: 'edit', file, version, changes: event.update.docChanged ? event.update.changes.toJSON() : null,
        selection: event.update.state.selection.toJSON(), readOnly: event.update.state.readOnly, ack: acknowledging });
    },
    apply(input) {
      const editor = view();
      if (!editor || input.file !== file || !Number.isSafeInteger(input.version) || input.version < first || input.version > version) throw new Error('WORKBENCH_WINDOW_CONFLICT');
      let changes = ChangeSet.fromJSON(input.changes), through = ChangeSet.empty(changes.length);
      if (!changes.empty && editor.state.readOnly) throw new Error('WORKBENCH_FILE_BUSY');
      for (const change of history.slice(input.version - first)) through = through.compose(change);
      const remote = mapChanges(through, changes);
      changes = mapChanges(changes, through);
      const selection = EditorSelection.fromJSON(input.selection).map(remote);
      acknowledging = input.id;
      try { editor.dispatch({ changes, selection, userEvent: input.userEvent || 'input' }); }
      finally { acknowledging = null; }
    },
  };
}

/** 对未确认的本地事务做范围映射，重叠修改报冲突，不静默覆盖。 */
export function createEditPeer(send, apply) {
  let file = null, version = 0, sequence = 0, pending = [], inflight = false, stopped = false;
  let settled = [];
  const complete = () => { if (!pending.length) for (const item of settled.splice(0)) item.resolve(); };
  function next() {
    if (inflight || !pending.length || stopped) return;
    inflight = true; const first = pending[0];
    Promise.resolve(send({ ...first, changes: first.changes.toJSON(), selection: first.selection.toJSON(), file, version }))
      .catch(error => { stopped = true; for (const item of settled.splice(0)) item.reject(error); });
  }
  return {
    initial(value) {
      if (pending.length) throw new Error('WORKBENCH_WINDOW_CONFLICT');
      file = value.file; version = value.version; inflight = false; stopped = false;
    },
    local(update) {
      if (stopped || !file || !update.docChanged && !update.selectionSet) return;
      const previous = pending.at(-1);
      if (previous && (pending.length > 1 || !inflight)) {
        previous.changes = previous.changes.compose(update.changes); previous.selection = update.state.selection;
      } else pending.push({ id: ++sequence, changes: update.changes, selection: update.state.selection,
        userEvent: update.transactions[0]?.annotation(Transaction.userEvent) });
      next();
    },
    accept(value) {
      if (value.file !== file) return;
      version = value.version;
      if (value.ack !== null && value.ack === pending[0]?.id) { pending.shift(); inflight = false; }
      else if (value.changes) {
        let remote = ChangeSet.fromJSON(value.changes);
        for (const item of pending) {
          const mapped = mapChanges(item.changes, remote);
          remote = mapChanges(remote, item.changes); item.changes = mapped; item.selection = item.selection.map(remote);
        }
        apply({ changes: remote });
      }
      if (!pending.length && value.selection) apply({ selection: EditorSelection.fromJSON(value.selection) });
      complete(); next();
    },
    flush() { return stopped ? Promise.reject(new Error('WORKBENCH_WINDOW_CONFLICT')) : pending.length ? new Promise((resolve, reject) => settled.push({ resolve, reject })) : Promise.resolve(); },
    stop(error) { stopped = true; for (const item of settled.splice(0)) item.reject(error); },
  };
}
