import { Text } from '@codemirror/state';

/** 输入时保留编辑器文档；仅在保存、提问或后台索引读取时生成全文。 */
export function createBuffer(file) {
  let text = file.text, original = file.text, materialized = null, state = null, clean = Text.of(original.split(/\r\n?|\n/));
  const separatorOf = value => value.includes('\r\n') ? '\r\n' : value.includes('\r') ? '\r' : '\n';
  let separator = separatorOf(text);
  let checked = null, dirty = false;
  return {
    path: file.path, version: file.version, writers: new Set(),
    get state() { return state; },
    set state(value) {
      if (value && !state && value.doc.eq(clean)) clean = value.doc;
      state = value; checked = null;
    },
    get text() {
      if (!this.dirty) return original;
      if (this.state && materialized !== this.state.doc) { materialized = this.state.doc; text = this.state.doc.sliceString(0, this.state.doc.length, separator); }
      return text;
    },
    set text(value) { text = value; separator = separatorOf(value); state = null; materialized = null; checked = null; },
    get original() { return original; },
    set original(value) { original = value; const next = separatorOf(value); if (next !== separator) { separator = next; materialized = null; } clean = Text.of(value.split(/\r\n?|\n/)); if (state?.doc.eq(clean)) clean = state.doc; checked = null; },
    get dirty() {
      if (!this.state) return text !== original;
      if (checked !== this.state.doc) { checked = this.state.doc; dirty = !checked.eq(clean); }
      return dirty;
    },
  };
}
