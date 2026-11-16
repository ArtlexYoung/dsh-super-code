import { createBudgetEditors } from './budgets.js'
import { createConnectionAutosave } from './connection.js'
import { createSettingsEditors } from './editors.js'
import { budgetRemoteContribution, connectionRemoteContribution, presetRemoteContribution } from './remote.js'
import { connectRemote } from '../ui/remote.js'

// 编辑器属于设置页生命周期，Remote 替换时保留草稿；断连不会自动重放保存。
function createSettingsServices(ctx) {
  const api = connectRemote(ctx, presetRemoteContribution)
  const budgetApi = createBudgetEditors(connectRemote(ctx, budgetRemoteContribution))
  const connectionApi = connectRemote(ctx, connectionRemoteContribution)
  const connectionSettings = createSettingsEditors(connectionApi, { connection: createConnectionAutosave })
  return { api, budgetApi, connectionApi, connectionSettings }
}

export { createSettingsServices }
