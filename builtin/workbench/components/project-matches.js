import { useEffect, useMemo, useRef, useState } from 'react';
import { searchQueryKey } from '../../../src/workbench/search-query.ts';

const noMatches = [];

export function useProjectMatches(workbench, query, enabled) {
  const key = searchQueryKey(query), [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null), stop = useRef(null);
  const active = enabled && !!query.search;
  const request = useMemo(() => ({ query, workbench }), [active, attempt, key, workbench]);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController(), matches = [];
    const publish = (status, extra) => setResult({ request, status, matches: matches.slice(), ...extra });
    const timer = setTimeout(async () => {
      let completion, published = 0, yielding = performance.now();
      try {
        for await (const event of request.workbench.searchProject({ ...request.query, locations: true }, abort.signal)) {
          if (abort.signal.aborted) return;
          if (event.kind === 'matches') {
            for (const item of event.matches) matches.push({ ...item, file: event.path, key: `location:${matches.length}` });
            if (!published || performance.now() - published >= 100) { published = performance.now(); publish('searching'); }
          }
          if (event.kind === 'done') completion = event;
          if (performance.now() - yielding >= 12) {
            await new Promise(resolve => setTimeout(resolve, 0)); yielding = performance.now();
            if (abort.signal.aborted) return;
          }
        }
        if (abort.signal.aborted) return;
        if (!completion) throw new Error('WORKBENCH_REMOTE');
        publish('done', completion);
      } catch (failure) {
        if (!abort.signal.aborted) publish('failed', { failure, matches: noMatches });
      } finally {
        if (!abort.signal.aborted) stop.current = null;
      }
    }, 180);
    stop.current = () => { clearTimeout(timer); abort.abort(); stop.current = null; publish('stopped'); };
    return () => { clearTimeout(timer); abort.abort(); stop.current = null; };
  }, [active, request]);
  const current = active && result?.request === request ? result : null;
  return { result: current ?? { status: active ? 'searching' : 'idle', matches: noMatches },
    key, attempt, stop: () => stop.current?.(), retry: () => setAttempt(previous => previous + 1) };
}
