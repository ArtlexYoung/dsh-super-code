/** Reuse the host's public summaries; execution success never means acceptance. */
export function executionFacts(state, sessionId) {
  const node = state.byId?.[sessionId];
  const values = state.projectionsBySession?.[sessionId]?.values || node?.projectionValues || {};
  const feedback = values.superCodeFeedback;
  const current = values.superCodeTasks?.current;
  const task = current?.kind === 'task' ? current : null;
  const files = [...new Map((feedback?.files || []).map(file => [file.path, file])).values()];
  return {
    goal: task?.goal || (feedback?.goal?.kind === 'recorded' ? feedback.goal.text : '') || feedback?.request || '',
    title: task?.title || '', taskStatus: task?.status || '', next: task?.next || '', cwd: node?.cwd || values.workingDirectory || '',
    phase: feedback?.phase || 'idle', available: Boolean(feedback), todos: feedback?.todos || values.todos || [],
    activities: feedback?.activities || [], files,
    partial: Boolean(feedback?.omittedTodos || feedback?.omittedFiles || feedback?.omittedActivities),
  };
}
