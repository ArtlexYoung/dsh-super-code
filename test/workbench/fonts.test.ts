import test from 'node:test'
import assert from 'node:assert/strict'
import { listSystemFonts } from '../../src/workbench/fonts.js'

test('系统字体仅返回去重的家族名，支持三平台的原生命令输出', async () => {
  const outputs = {
    darwin: JSON.stringify(['Menlo', 'Menlo', '苹方-简', '.Hidden']),
    win32: JSON.stringify(['Consolas', '@宋体', 'Microsoft YaHei', 'Consolas']),
    linux: 'DejaVu Sans Mono\nNoto Sans CJK SC\nDejaVu Sans Mono\n',
  }
  const commands: string[] = []
  for (const [platform, output] of Object.entries(outputs)) {
    const names = await listSystemFonts(new AbortController().signal, platform, async (file, args) => { commands.push(file); assert.ok(args.length); return output })
    assert.equal(names.length, 2)
    assert.equal(new Set(names).size, 2)
    assert.ok(names.every(name => !/^[.@]/.test(name)))
  }
  assert.deepEqual(commands, ['/usr/bin/osascript', 'powershell.exe', 'fc-list'])
})

test('系统字体空输出、取消、非法输出和命令错误不会被伪装成成功', async () => {
  const signal = new AbortController().signal
  assert.deepEqual(await listSystemFonts(signal, 'linux', async () => ''), [])
  assert.deepEqual(await listSystemFonts(signal, 'win32', async () => '[]'), [])
  await assert.rejects(listSystemFonts(signal, 'darwin', async () => 'invalid'), /WORKBENCH_FONTS_UNAVAILABLE/)
  await assert.rejects(listSystemFonts(signal, 'win32', async () => '[12]'), /WORKBENCH_FONTS_UNAVAILABLE/)
  await assert.rejects(listSystemFonts(signal, 'linux', async () => { throw new Error('not installed') }), /WORKBENCH_FONTS_UNAVAILABLE/)
  await assert.rejects(listSystemFonts(signal, 'freebsd', async () => ''), /WORKBENCH_FONTS_UNAVAILABLE/)
  const abort = new AbortController(); abort.abort()
  let called = false
  await assert.rejects(listSystemFonts(abort.signal, 'linux', async () => { called = true; return '' }), { name: 'AbortError' })
  assert.equal(called, false)
})

test('枚举完成后取消不会返回字体，输出中控制字符和空家族不进入列表', async () => {
  const abort = new AbortController()
  await assert.rejects(listSystemFonts(abort.signal, 'linux', async () => { abort.abort(); return 'Menlo' }), { name: 'AbortError' })
  assert.deepEqual(await listSystemFonts(new AbortController().signal, 'win32', async () => JSON.stringify(['', '  ', 'Bad\0Name', 'A'.repeat(257), 'Consolas'])), ['Consolas'])
})
