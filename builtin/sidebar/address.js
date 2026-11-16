
function agentDetailAddress(node) {
  const address = new URL('dsh-resource://super-agent/' + encodeURIComponent(node.id))
  if (node.parentId && node.mode) {
    address.searchParams.set('parent', node.parentId)
    address.searchParams.set('mode', node.mode)
  }
  return address.href
}

function agentDetailTarget(address) {
  const url = new URL(address)
  if (url.protocol !== 'dsh-resource:' || url.hostname !== 'super-agent') throw new Error('Invalid Agent address')
  const id = decodeURIComponent(url.pathname.slice(1))
  if (!id) throw new Error('Missing Agent identity')
  const parent = url.searchParams.get('parent'), mode = url.searchParams.get('mode')
  if (parent && (mode === 'one-shot' || mode === 'continuable')) return { kind: 'subagent', parentSessionId: parent, childSessionId: id, mode }
  return { kind: 'session', sessionId: id }
}

function agentPath(view, id) {
  const path = [], seen = new Set()
  while (id && !seen.has(id)) {
    seen.add(id)
    const node = view.nodes.get(id)
    path.unshift({ id, title: node?.title || node?.displayTitle || id })
    id = node?.parentId
  }
  return path
}

export { agentDetailAddress, agentDetailTarget, agentPath }
