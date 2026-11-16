
// Explicit public Remote contribution; no model tools or private transport hooks.
const remoteStringSchema = {
  parse(value) {
    if (typeof value !== 'string') throw new TypeError('Expected a string')
    return value
  },
}
const remoteStringCodec = { mode: 'strict', typeSymbol: 'string', schema: remoteStringSchema, create: () => remoteStringSchema }
const presetRemoteContribution = {
  package: 'dsh-super-code',
  descriptors: ['status', 'installPreset', 'reinstallPreset', 'synchronize'].map(method => ({
    id: `dsh-super-code:superCodePresets/${method}`, service: 'superCodePresets',
    namespace: 'superCodePresets', method, invocation: { kind: 'direct' },
    parameters: (method === 'reinstallPreset' ? ['previousId', 'id', 'name'] : method === 'installPreset' ? ['id', 'name'] : method === 'synchronize' ? ['language'] : []).map(name => ({
      name, wire: name, source: 'json', codec: remoteStringCodec,
    })),
    result: { mode: 'src-json' },
  })),
}
const memoryRemoteContribution = {
  package: 'dsh-super-code', descriptors: ['list', 'read', 'saveEntry', 'deleteEntry'].map(method => ({
    id: `dsh-super-code:superCodeMemory/${method}`, service: 'superCodeMemory', namespace: 'superCodeMemory', method, invocation: { kind: 'direct' },
    parameters: (method === 'list' ? ['sessionId', 'scope'] : method === 'saveEntry' ? ['sessionId', 'scope', 'topic', 'id', 'content'] : method === 'deleteEntry' ? ['sessionId', 'scope', 'topic', 'id', 'expected'] : ['sessionId', 'scope', 'topic', 'id']).map(name => ({ name, wire: name, source: 'json', codec: remoteStringCodec })), result: { mode: 'src-json' },
  })),
}

// Budget settings use the same public Remote transport as the preset settings.
const budgetRemoteContribution = {
  package: 'dsh-super-code', descriptors: ['readConfig', 'saveConfig', 'resetConfig', 'openSkillsDirectory', 'syncSkills'].map(method => ({
    id: `dsh-super-code:superCodeBudgets/${method}`, service: 'superCodeBudgets', namespace: 'superCodeBudgets', method, invocation: { kind: 'direct' },
    parameters: (method === 'saveConfig' ? ['content', 'expected'] : method === 'resetConfig' ? ['expected'] : [])
      .map(name => ({ name, wire: name, source: 'json', codec: remoteStringCodec })), result: { mode: 'src-json' },
  })),
}

const connectionRemoteContribution = {
  package: 'dsh-super-code', descriptors: ['readConfig', 'saveConfig', 'revealToken', 'rotateToken', 'overview', 'disconnectClient', 'directories', 'pickDirectory', 'browseDirectory', 'pendingDirectories', 'watchDirectories', 'resolveDirectory'].map(method => ({
    id: `dsh-super-code:superCodeConnection/${method}`, service: 'superCodeConnection', namespace: 'superCodeConnection', method, invocation: { kind: 'direct' },
    parameters: (method === 'saveConfig' ? ['content', 'expected'] : method === 'rotateToken' ? ['expected'] : method === 'resolveDirectory' ? ['id', 'decision'] : method === 'disconnectClient' ? ['id'] : method === 'browseDirectory' ? ['path'] : [])
      .map(name => ({ name, wire: name, source: 'json', codec: remoteStringCodec })), result: { mode: 'src-json' },
    ...(method === 'watchDirectories' ? { mode: 'stream', cancellation: { parameter: 'signal' } } : {}),
  })),
}

export { budgetRemoteContribution, connectionRemoteContribution, memoryRemoteContribution, presetRemoteContribution }
