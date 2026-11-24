import React from '../ui/react.js'
import { ActionButton, SelectControl } from '../ui/controls.js'
import { text } from '../ui/locale.js'

export function conversationQuestions(records) {
  const questions = []
  for (const record of records) {
    const type = record.entry?.event?.type
    if (type === 'user/message') questions.push({ seq: record.seq, text: record.text })
    if (type === 'assistant/message' && questions.length) questions.at(-1).replySeq = record.seq
  }
  return questions
}

export function questionAtPosition(log, questions, destination) {
  const bounds = log.getBoundingClientRect(), target = destination && log.querySelector(`[data-message-seq="${destination.seq}"]`)
  // A short final exchange cannot always align with the top of the log.
  // Keep the requested question selected while its destination stays in view.
  if (target) {
    const selected = target.getBoundingClientRect()
    if (selected.bottom > bounds.top && selected.top < bounds.bottom) return destination.question
  }
  let active = questions[0]?.seq
  for (const item of questions) if ((log.querySelector(`[data-message-seq="${item.seq}"]`)?.getBoundingClientRect().top ?? Infinity) <= bounds.top + 32) active = item.seq
  return active
}

export function QuestionNavigation({ questions, selected, jump, t }) {
  if (!questions.length) return null
  const current = questions.find(item => String(item.seq) === selected) || questions[0]
  return React.createElement('nav', { className: 'sc-wb-question-nav', 'aria-label': text(t, 'workbench.questions') },
    React.createElement(SelectControl, { label: text(t, 'workbench.questions'), value: String(current.seq),
      choices: questions.map((item, index) => [String(item.seq), `${index + 1}. ${item.text.replace(/\s+/g, ' ').slice(0, 72)}`]),
      onChange: value => jump(Number(value), Number(value)) }),
    React.createElement(ActionButton, { type: 'button', disabled: current.replySeq === undefined,
      title: text(t, current.replySeq === undefined ? 'workbench.noReply' : 'workbench.replyHint'),
      onClick: () => jump(current.replySeq, current.seq) }, text(t, 'workbench.viewReply')))
}
