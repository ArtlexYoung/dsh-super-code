export const saveDelays = ['manual', 'immediate', '15', '30', '60'];

export function createAutosave(save, fail, clock = globalThis) {
  const timers = new Map();
  let delay = 'manual', disposed = false;
  function cancel(path) { if (timers.has(path)) { clock.clearTimeout(timers.get(path)); timers.delete(path); } }
  return {
    configure(value) { delay = value; for (const path of timers.keys()) cancel(path); },
    change(path) {
      cancel(path);
      if (disposed || delay === 'manual') return;
      timers.set(path, clock.setTimeout(() => { timers.delete(path); void save(path).catch(fail); }, delay === 'immediate' ? 0 : Number(delay) * 1000));
    },
    cancel,
    dispose() { disposed = true; for (const path of timers.keys()) cancel(path); },
  };
}
