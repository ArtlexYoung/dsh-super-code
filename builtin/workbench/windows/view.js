/** 窗口各自保留导航位置，共用项目缓冲区；只借用原页面的项目索引。 */
export async function createWindowView(view, source, presentation) {
  const parent = document.createElement('div'), tooltips = document.createElement('div');
  parent.hidden = true; parent.append(tooltips); document.body.append(parent);
  const cleanups = [];
  let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; for (const cleanup of cleanups) cleanup(); view.dispose(); parent.remove(); };
  try {
    const snapshot = source.snapshot();
    await view.attach(parent, tooltips);
    const target = presentation.kind === 'file' ? { file: presentation.file, kind: presentation.editorKind } : snapshot.cursor || (snapshot.file ? { file: snapshot.file, kind: snapshot.editorKind } : null);
    if (presentation.kind === 'workbench') for (const tab of snapshot.tabs) { await view.visit({ file: tab.path, kind: tab.kind }); view.keepTab(tab.path); }
    if (target) { await view.visit(target); view.keepTab(target.file); }
    if (snapshot.closingFile && presentation.kind === 'closeFile') await view.closeFile(snapshot.closingFile);
    if (snapshot.assistant?.thread) view.assistant.open(snapshot.assistant.thread.id);
    if (snapshot.panel) {
      view.panel(snapshot.panel);
      const synchronize = (from, to) => {
        const next = from.snapshot().panel, current = to.snapshot().panel;
        if (current?.id !== snapshot.panel.id) return;
        if (!next) to.panel(null);
        else if (next.id === current.id && next !== current) to.panel(next);
      };
      cleanups.push(source.subscribe(() => synchronize(source, view)), view.subscribe(() => synchronize(view, source)));
    }
    let previous, cached;
    return { workbench: {
      ...view, reading: source.reading.forView({ currentFile: () => view.snapshot().file, visit: view.visit }),
      // 定向工具窗没有可见的代码区，定位结果应在原工作台中打开。
      visit: presentation.kind === 'panel' ? source.visit : view.visit,
      openFileWindow: (presentation, native) => source.openFileWindow(presentation, native),
      createPane() {
        const pane = view.createPane();
        return { ...pane, reading: source.reading.forView({ currentFile: () => pane.snapshot().file, visit: pane.visit }) };
      },
      snapshot() {
        const next = view.snapshot(), { indexed, indexing } = source.snapshot();
        if (previous !== next || cached.indexed !== indexed || cached.indexing !== indexing) { previous = next; cached = { ...next, indexed, indexing }; }
        return cached;
      },
      subscribe(listener) { const offView = view.subscribe(listener), offSource = source.subscribe(listener); return () => { offView(); offSource(); }; },
      async refresh() { await source.refresh(); await view.refresh(); },
    }, dispose };
  } catch (error) { dispose(); throw error; }
}
