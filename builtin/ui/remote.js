// 保留界面状态，把服务替换限制在调用边界；断连后只拒绝新调用，不重放旧调用。
function connectRemote(ctx, contribution) {
  const name = contribution.descriptors[0].service
  let current
  ctx.inject(['remote.' + name], owner => {
    const api = owner.remote[name]
    current = api
    owner.effect(() => () => { if (current === api) current = undefined })
  })
  return Object.fromEntries(contribution.descriptors.map(({ method }) => [method, async (...args) => {
    const api = current
    if (!api) throw new Error(name + ' is unavailable')
    return api[method](...args)
  }]))
}
export { connectRemote }
