import { analyze } from './index.js';

/** 只移动代码分析的位置，不改变提示词、文件或模型行为。 */
export function createAnalyzer() {
  let worker, url, next = 0;
  const pending = new Map();
  const stop = error => {
    worker?.terminate(); worker = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  return {
    analyze(file, text, detail = true) {
      if (typeof __WORKBENCH_ANALYSIS_WORKER__ === 'undefined' || typeof Worker === 'undefined') return analyze(file, text, detail);
      if (!worker) {
        url = URL.createObjectURL(new Blob([__WORKBENCH_ANALYSIS_WORKER__], { type: 'text/javascript' }));
        try { worker = new Worker(url); }
        catch { stop(new Error('WORKBENCH_ANALYSIS')); return Promise.reject(new Error('WORKBENCH_ANALYSIS')); }
        worker.onmessage = ({ data }) => {
          const request = pending.get(data.id);
          if (!request) return;
          pending.delete(data.id);
          if (data.error) request.reject(new Error(data.error)); else request.resolve(data.value);
        };
        worker.onerror = () => stop(new Error('WORKBENCH_ANALYSIS'));
        worker.onmessageerror = worker.onerror;
      }
      return new Promise((resolve, reject) => {
        const id = ++next; pending.set(id, { resolve, reject });
        try { worker.postMessage({ id, file, text, detail }); }
        catch (error) { pending.delete(id); reject(error); }
      });
    },
    dispose() { stop(new DOMException('Analysis stopped', 'AbortError')); },
  };
}
