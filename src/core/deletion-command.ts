/** Recognize shell deletion at command positions, including common inline-script carriers. */
interface Word { readonly text: string; readonly quoted: boolean }
interface Commands { readonly commands: Word[][]; readonly substitutions: string[] }

function shellWords(input: string, powershell: boolean): Commands {
  const commands: Word[][] = [], substitutions: string[] = []
  let words: Word[] = [], value = '', quote = '', quoted = false, started = false
  const word = (): void => {
    if (started) words.push({ text: value, quoted })
    value = ''; quoted = false; started = false
  }
  const command = (): void => { word(); if (words.length) commands.push(words); words = [] }
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    if (char === (powershell ? '`' : '\\') && quote !== "'") {
      if (input[i + 1] !== '\n') { value += input[i + 1] ?? ''; started = true }
      i++; continue
    }
    if (!powershell && char === '`' && quote !== "'") {
      let end = i + 1
      while (end < input.length && input[end] !== '`') end++
      substitutions.push(input.slice(i + 1, end)); value += '$substitution'; started = true; i = end; continue
    }
    if (char === '$' && input[i + 1] === '(' && quote !== "'") {
      let end = i + 2, depth = 1, innerQuote = ''
      for (; end < input.length; end++) {
        const next = input[end]!
        if (next === (powershell ? '`' : '\\')) { end++; continue }
        if (innerQuote) { if (next === innerQuote) innerQuote = ''; continue }
        if (next === "'" || next === '"') { innerQuote = next; continue }
        if (next === '(') depth++
        if (next === ')' && --depth === 0) break
      }
      substitutions.push(input.slice(i + 2, end)); value += '$substitution'; started = true; i = end; continue
    }
    if (quote) {
      if (char === quote) quote = ''
      else value += char
      continue
    }
    if (char === "'" || char === '"') { quote = char; quoted = true; started = true; continue }
    if (char === '#' && !started) { while (i + 1 < input.length && input[i + 1] !== '\n') i++; continue }
    if (char === '&' && /[<>]$/.test(value)) { value += char; continue }
    if (';|&\n(){}'.includes(char)) { command(); if (char === '&' && powershell) words.push({ text: '&', quoted: false }); continue }
    if (/\s/.test(char)) { word(); continue }
    value += char; started = true
  }
  command()
  return { commands, substitutions }
}

function executable(word: string): string { return word.split(/[\\/]/).at(-1)!.toLowerCase().replace(/\.exe$/, '') }

/** Static inspection is deliberately bounded; opaque external scripts are governed by the prompt. */
export function deletionCommand(input: string, powershell = false, depth = 0): boolean {
  if (depth > 12 || input.length > 262144) return true
  const parsed = shellWords(input, powershell)
  if (parsed.substitutions.some(script => deletionCommand(script, powershell, depth + 1))) return true
  for (const original of parsed.commands) {
    const words = [...original]
    let invoked = false
    while (words.length) {
      const first = words[0]!, name = executable(first.text)
      if (/^\d*[<>]/.test(first.text)) {
        words.shift()
        if (/[<>]&?$/.test(first.text)) words.shift()
        continue
      }
      if (/^[A-Za-z_][\w]*=/.test(first.text) || ['!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '&', '.'].includes(name)) { if (name === '&') invoked = true; words.shift(); continue }
      if (powershell && first.quoted && !invoked) break // A bare quoted PowerShell string is not a command.
      if (['rm', 'rmdir', 'unlink', 'shred'].includes(name) || powershell && ['remove-item', 'ri', 'rd', 'del', 'erase'].includes(name)) return true
      if (['command', 'builtin', 'exec', 'sudo', 'doas', 'env', 'nohup', 'nice', 'xargs', 'time', 'timeout', 'busybox'].includes(name)) {
        words.shift()
        if (name === 'command' && ['-v', '-V'].includes(words[0]?.text ?? '')) break
        const valued = ['sudo', 'doas'].includes(name) ? ['-u', '-g', '-h', '-p', '-C', '-D', '--user', '--group', '--chdir']
          : name === 'xargs' ? ['-n', '-P', '-I', '-s', '-a', '-d', '-L', '--max-args', '--replace']
          : name === 'env' ? ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'] : name === 'nice' ? ['-n', '--adjustment']
          : name === 'timeout' ? ['-s', '--signal', '-k', '--kill-after'] : name === 'time' ? ['-o', '-f', '--output', '--format'] : []
        // Arguments to common wrapper options are data, not executable names.
        while (words[0]?.text.startsWith('-')) {
          const option = words.shift()!.text
          if (valued.includes(option)) {
            const argument = words.shift()
            if (name === 'env' && ['-S', '--split-string'].includes(option) && argument && deletionCommand('env ' + argument.text, powershell, depth + 1)) return true
          }
        }
        if (name === 'timeout') words.shift() // Mandatory duration before the actual command.
        continue
      }
      const args = words.slice(1)
      if (name === 'find') {
        if (args.some(arg => arg.text === '-delete')) return true
        const start = args.findIndex(arg => ['-exec', '-execdir', '-ok', '-okdir'].includes(arg.text))
        if (start >= 0 && deletionCommand(args.slice(start + 1).map(arg => arg.text).join(' '), powershell, depth + 1)) return true
      }
      if (['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd'].includes(name)) {
        const code = args.findIndex(arg => /^-[a-z]*c[a-z]*$/i.test(arg.text) || ['-command', '/c', '/k'].includes(arg.text.toLowerCase()))
        if (code >= 0 && deletionCommand(args.slice(code + 1).map(arg => arg.text).join(' '), ['pwsh', 'powershell', 'cmd'].includes(name), depth + 1)) return true
      }
      if (['eval', 'invoke-expression', 'iex'].includes(name) && deletionCommand(args.map(arg => arg.text).join(' '), powershell, depth + 1)) return true
      break
    }
  }
  return false
}
