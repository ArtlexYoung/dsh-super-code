/** Recognize shell deletion at command positions, including common inline-script carriers. */
interface Word { readonly text: string; readonly quoted: boolean; readonly document?: boolean; readonly redirect?: boolean }
interface Commands { readonly commands: Word[][]; readonly substitutions: string[] }

function shellWords(input: string, powershell: boolean, mode: 'shell' | 'split' | 'document' = 'shell'): Commands {
  const commands: Word[][] = [], substitutions: string[] = []
  const splitString = mode === 'split', document = mode === 'document'
  let pipeline: Word[][] = []
  const documents: { delimiter: string; quoted: boolean; tabs: boolean; pipeline: Word[][]; target: Word[]; stdin: boolean }[] = []
  let words: Word[] = [], value = '', quote = '', quoted = false, started = false
  const word = (): void => {
    if (started) words.push({ text: value, quoted })
    value = ''; quoted = false; started = false
  }
  const command = (): void => { word(); if (words.length) { commands.push(words); pipeline.push(words) }; words = [] }
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    if (!powershell && mode === 'shell' && !quote && char === '<' && input[i + 1] === '<' && input[i - 1] !== '<' && input[i + 2] !== '<') {
      const descriptor = !quoted && /^\d*$/.test(value), redirect = descriptor ? value + '<<' : '<<'
      if (descriptor) { value = ''; started = false } else word()
      let end = i + 2, delimiter = '', innerQuote = '', literal = false, present = false
      const tabs = input[end] === '-'
      if (tabs) end++
      while (input[end] === ' ' || input[end] === '\t') end++
      for (; end < input.length; end++) {
        const next = input[end]!
        if (!innerQuote && /[\s;|&()<>]/.test(next)) break
        present = true
        if (next === '\\' && innerQuote !== "'") {
          if (input[end + 1] === '\n') { end++; continue }
          if (innerQuote === '"' && !['$', '`', '"', '\\', '\n'].includes(input[end + 1] ?? '')) delimiter += next
          else delimiter += input[++end] ?? ''
          literal = true; continue
        }
        if (innerQuote) { if (next === innerQuote) innerQuote = ''; else delimiter += next; continue }
        if (next === "'" || next === '"') { innerQuote = next; literal = true; continue }
        delimiter += next
      }
      words.push({ text: redirect, quoted: false, redirect: true }, { text: delimiter, quoted: true })
      if (present) documents.push({ delimiter, quoted: literal, tabs, pipeline, target: words, stdin: /^(?:0)?<<$/.test(redirect) })
      i = end - 1
      continue
    }
    if (!powershell && mode === 'shell' && !quote && ('<>'.includes(char) || char === '&' && input[i + 1] === '>')) {
      // Redirections are operators even without spaces: rm>log still invokes rm.
      const descriptor = char !== '&' && !quoted && /^\d*$/.test(value)
      const prefix = descriptor ? value : ''
      if (descriptor) { value = ''; started = false } else word()
      const operator = /^(?:&>>?|<<<|<>|<&|>&|>\||>>|<|>)/.exec(input.slice(i, i + 3))![0]
      words.push({ text: prefix + operator, quoted: false, redirect: true })
      i += operator.length - 1
      continue
    }
    if (splitString && char === '\\') {
      const next = input[i + 1] ?? ''
      if (quote === "'" && next !== "'" && next !== '\\') { value += char; started = true; continue }
      if (next === 'c' && !quote) break
      if (next === '_' && !quote) { word(); i++; continue }
      const escapes: Record<string, string> = { f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', _: ' ' }
      value += escapes[next] ?? next; started = true; i++; continue
    }
    if (!splitString && char === (powershell ? '`' : '\\') && quote !== "'") {
      if (document && !['\\', '$', '`', '\n'].includes(input[i + 1] ?? '')) { value += char; started = true; continue }
      if (input[i + 1] !== '\n') { value += input[i + 1] ?? ''; started = true }
      i++; continue
    }
    if (!splitString && !powershell && char === '`' && quote !== "'") {
      let end = i + 1
      while (end < input.length && input[end] !== '`') end++
      substitutions.push(input.slice(i + 1, end)); value += '$substitution'; started = true; i = end; continue
    }
    if (!splitString && char === '$' && input[i + 1] === '(' && quote !== "'") {
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
    if (!document && (char === "'" || char === '"')) { quote = char; quoted = true; started = true; continue }
    if (!document && char === '#' && !started) {
      if (splitString) break
      while (i + 1 < input.length && input[i + 1] !== '\n') i++
      continue
    }
    if (char === '&' && /[<>]$/.test(value)) { value += char; continue }
    if (!splitString && (';|&\n()'.includes(char) || '{}'.includes(char) && (powershell || !started && /[\s;|&()]|^$/.test(input[i + 1] ?? '')))) {
      command()
      if (char === '\n' && documents.length) {
        let start = i + 1
        for (const doc of documents) {
          let end = start, after = input.length
          for (; end < input.length;) {
            const newline = input.indexOf('\n', end), stop = newline < 0 ? input.length : newline
            const line = input.slice(end, stop)
            if ((doc.tabs ? line.replace(/^\t+/, '') : line) === doc.delimiter) { after = newline < 0 ? stop : stop + 1; break }
            end = newline < 0 ? input.length : stop + 1
          }
          const body = input.slice(start, end)
          // Quotes in literal input never change the outer shell's quote state.
          // Shells receiving that input inspect it as code; other tools receive data.
          if (doc.stdin) {
            const previous = doc.target.findIndex(word => word.document)
            if (previous >= 0) doc.target.splice(previous, 1)
            doc.target.push({ text: body, quoted: true, document: true })
          }
          if (!doc.quoted) substitutions.push(...shellWords(body, false, 'document').substitutions)
          start = after
        }
        // Only a plain cat forwards its document unchanged through a pipe.
        // Other commands may ignore or transform input; their output is opaque.
        for (const parts of new Set(documents.map(doc => doc.pipeline))) {
          let carried: Word | undefined
          for (const part of parts) {
            const own = part.find(word => word.document), body = own ?? carried
            if (body && !own) part.push(body)
            carried = part[0]?.text === 'cat' ? body : undefined
          }
        }
        documents.length = 0; i = start - 1
      }
      if (';&\n'.includes(char)) pipeline = []
      if (char === '&' && powershell) words.push({ text: '&', quoted: false })
      continue
    }
    if (/\s/.test(char)) { word(); continue }
    value += char; started = true
  }
  command()
  return { commands, substitutions }
}

function executable(word: string): string { return word.split(/[\\/]/).at(-1)!.toLowerCase().replace(/\.exe$/, '') }

const findValueOptions = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-lname', '-ilname',
  '-regex', '-iregex', '-regextype', '-type', '-xtype', '-fstype', '-uid', '-gid', '-user', '-group', '-size', '-links',
  '-inum', '-perm', '-newer', '-anewer', '-cnewer', '-samefile', '-mtime', '-mmin', '-atime', '-amin', '-ctime', '-cmin',
  '-used', '-maxdepth', '-mindepth', '-printf', '-fprint', '-fprint0', '-fls', '-files0-from', '-f'])

function findDeletes(args: readonly Word[], powershell: boolean, depth: number): boolean {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!.text
    if (value === '-fprintf') { index += 2; continue }
    if (findValueOptions.has(value) || /^-newer[acmBt][acmBt]$/.test(value)) { index++; continue }
    if (value === '-delete') return true
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(value)) continue
    let end = index + 1
    while (end < args.length && args[end]!.text !== ';'
      && !(args[end]!.text === '+' && args[end - 1]?.text === '{}')) end++
    const command = args.slice(index + 1, end)
    // find executes argv directly: preserve argument boundaries instead of
    // reparsing literal semicolons and quoted prose as a new shell program.
    if (command.length && commandsDelete([[{ ...command[0]!, quoted: false }, ...command.slice(1)]], powershell, depth + 1)) return true
    index = end
  }
  return false
}

function shellDeletes(name: string, args: readonly Word[], powershell: boolean, depth: number): boolean {
  const ps = ['pwsh', 'powershell'].includes(name)
  let stdin = false
  const stdinDeletes = (): boolean => args.some(arg => arg.document && deletionCommand(arg.text, powershell, depth + 1))
  for (let index = 0; index < args.length; index++) {
    if (args[index]!.document) return deletionCommand(args[index]!.text, powershell, depth + 1)
    const option = args[index]!.text.toLowerCase()
    if (powershell && !args[index]!.quoted && /^(?:\d*[<>]|&>)/.test(option)) { if (/[<>|]&?$/.test(option)) index++; continue }
    const encoded = ps && (option === '-e' || option === '-ec' || option.length >= 3 && '-encodedcommand'.startsWith(option))
    const code = ps ? ['-c', '-command'].includes(option)
      : name === 'cmd' ? (powershell ? ['/c', '/k'] : ['/c', '/k', '//c', '//k']).includes(option)
      : /^-[a-z]*c[a-z]*$/i.test(option)
    if (encoded) {
      const value = args[index + 1]?.text ?? ''
      return /^[a-z0-9+/]+={0,2}$/i.test(value) && deletionCommand(Buffer.from(value, 'base64').toString('utf16le'), true, depth + 1)
    }
    if (code) {
      // POSIX -c consumes one program; later words are $0 and positional data.
      const native = ps || name === 'cmd'
      const script = native ? args.slice(index + 1).map(arg => arg.text).join(' ') : args[index + 1]?.text
      return !!script && deletionCommand(script, native, depth + 1)
    }
    if (option === '--') return !ps && name !== 'cmd' && (stdin || !!args[index + 1]?.document) && stdinDeletes()
    if (ps && ['-f', '-file'].includes(option)) return false
    if (!ps && name !== 'cmd' && /^-[a-z]*s[a-z]*$/i.test(option)) stdin = true
    if (ps && ['-executionpolicy', '-ep', '-inputformat', '-inp', '-outputformat', '-o', '-configurationname', '-settingsfile', '-workingdirectory', '-wd'].includes(option)
      || !ps && name !== 'cmd' && ['-o', '+o', '--rcfile', '--init-file'].includes(option)) { index++; continue }
    // A script filename ends startup options; its arguments are not shell code.
    if (name !== 'cmd' && !option.startsWith('-') && !option.startsWith('+')) return stdin && stdinDeletes()
  }
  return false
}

function commandsDelete(commands: readonly Word[][], powershell: boolean, depth: number): boolean {
  if (depth > 12) return true
  for (const original of commands) {
    const documents = original.filter(word => word.document), words: Word[] = []
    // Shell redirects never occupy argv slots, including between -c and its program.
    // Explicit metadata keeps quoted filenames and env/find argv data untouched.
    for (let index = 0; index < original.length; index++) {
      const word = original[index]!
      if (word.redirect) { index++; continue }
      if (!word.document) words.push(word)
    }
    let invoked = false
    while (words.length) {
      const first = words[0]!, name = executable(first.text)
      if (powershell && !first.quoted && /^(?:\d*[<>]|&>)/.test(first.text)) {
        words.shift()
        if (/[<>|]&?$/.test(first.text)) words.shift()
        continue
      }
      if (/^[A-Za-z_][\w]*=/.test(first.text) || ['!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '&', '.'].includes(name)) { if (name === '&') invoked = true; words.shift(); continue }
      if (powershell && first.quoted && !invoked) break // A bare quoted PowerShell string is not a command.
      if (['rm', 'rmdir', 'unlink', 'shred'].includes(name) || powershell && ['remove-item', 'ri', 'rd', 'del', 'erase'].includes(name)) return true
      if (['command', 'builtin', 'exec', 'sudo', 'doas', 'env', 'nohup', 'nice', 'xargs', 'time', 'timeout', 'busybox'].includes(name)) {
        words.shift()
        if (name === 'command' && ['-v', '-V'].includes(words[0]?.text ?? '')) break
        const valued = ['sudo', 'doas'].includes(name) ? ['-u', '-g', '-h', '-p', '-C', '-D', '--user', '--group', '--chdir']
          : name === 'exec' ? ['-a']
          : name === 'xargs' ? ['-n', '-P', '-I', '-s', '-a', '-d', '-L', '-E', '--max-args', '--replace', '--arg-file', '--delimiter', '--max-procs', '--max-chars']
          : name === 'env' ? ['-u', '--unset', '-C', '--chdir'] : name === 'nice' ? ['-n', '--adjustment']
          : name === 'timeout' ? ['-s', '--signal', '-k', '--kill-after'] : name === 'time' ? ['-o', '-f', '--output', '--format'] : []
        // Arguments to common wrapper options are data, not executable names.
        while (words[0]?.text.startsWith('-')) {
          const option = words.shift()!.text
          if (option === '--') break
          if (name === 'env' && (option.startsWith('-S') || option === '--split-string' || option.startsWith('--split-string='))) {
            const argument = option === '-S' || option === '--split-string' ? words.shift()?.text ?? ''
              : option.startsWith('-S') ? option.slice(2) : option.slice('--split-string='.length)
            // env splits argv, not shell code. Operators and later arguments remain literal.
            const split = shellWords(argument, false, 'split').commands.flat()
            if (commandsDelete([[{ text: 'env', quoted: false }, ...split, ...words, ...documents]], powershell, depth + 1)) return true
            words.length = 0
            break
          }
          if (valued.includes(option)) words.shift()
        }
        if (name === 'timeout') words.shift() // Mandatory duration before the actual command.
        invoked = true
        continue
      }
      const args = words.slice(1)
      if (name === 'find' && findDeletes(args, powershell, depth)) return true
      if (['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd'].includes(name) && shellDeletes(name, [...args, ...documents], powershell, depth)) return true
      if (['eval', 'invoke-expression', 'iex'].includes(name) && deletionCommand(args.map(arg => arg.text).join(' '), powershell, depth + 1)) return true
      break
    }
  }
  return false
}

/** Static inspection is deliberately bounded; opaque external scripts are governed by the prompt. */
export function deletionCommand(input: string, powershell = false, depth = 0): boolean {
  if (depth > 12 || input.length > 262144) return true
  const parsed = shellWords(input, powershell)
  return parsed.substitutions.some(script => deletionCommand(script, powershell, depth + 1))
    || commandsDelete(parsed.commands, powershell, depth)
}
