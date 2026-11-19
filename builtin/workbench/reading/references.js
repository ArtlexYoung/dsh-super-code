/** 片段本身未变时跟随插行移动；出现多个候选时不猜测目标。 */
export function resolveExcerpt(ref, text) {
  text = text.replace(/\r(?!\n)/g, '\n');
  const quote = ref.quote ?? ref.text;
  const lines = text.split('\n');
  if (ref.toLine <= lines.length && lines.slice(ref.fromLine - 1, ref.toLine).join('\n') === quote) return ref;
  if (!quote) return null;
  let match = -1, offset = text.indexOf(quote);
  while (offset >= 0) {
    const end = offset + quote.length;
    if ((offset === 0 || text[offset - 1] === '\n') && (end === text.length || text[end] === '\n')) {
      if (match >= 0) return null;
      match = offset;
    }
    offset = text.indexOf(quote, offset + 1);
  }
  if (match < 0) return null;
  const fromLine = text.slice(0, match).split('\n').length;
  return { ...ref, fromLine, toLine: fromLine + quote.split('\n').length - 1 };
}

export function rebaseReading(state, texts, complete = false) {
  let stale = complete ? false : state.stale;
  const resolve = ref => {
    if (!texts.has(ref.file)) return ref;
    const result = resolveExcerpt(ref, texts.get(ref.file));
    if (!result) stale = true;
    return result || ref;
  };
  const sources = state.sources.map(resolve), planSources = state.planSources.map(resolve);
  const plan = state.plan && { ...state.plan, steps: state.plan.steps.map(step => ({ ...step, refs: step.refs.map(resolve) })) };
  const sections = state.sections.map(section => ({ ...section, refs: section.refs.map(resolve) }));
  return { sources, planSources, plan, sections, stale };
}
