/** Execute the frozen, complete official CLI. No model/agent implementation is extracted. */
import { spawn } from 'node:child_process'
import { executeNative } from './native-resume.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const [inputPath, outputPath] = process.argv.slice(2)
const input = JSON.parse(await readFile(inputPath,'utf8'))
const root = input.run_dir
if (typeof input.native_candidate_dir !== 'string') throw new Error('native_candidate_dir must point to the complete official CLI and its manifest')
const candidateRoot = pathToFileURL(resolve(input.native_candidate_dir) + '/')
const candidate = JSON.parse(await readFile(new URL('manifest.json',candidateRoot),'utf8'))
for (const [path,digest] of Object.entries(candidate.files)) {
  if (createHash('sha256').update(await readFile(new URL(path,candidateRoot))).digest('hex') !== digest) throw new Error('Native ZCode package changed: '+path)
}
const prompt = [
  'Solve the following SWE-bench issue in the current repository.', '',
  `Repository: ${input.repo}`, '', input.problem_statement, '',
  'Inspect the repository, edit the implementation, and run relevant tests. Do not edit tests or install packages.',
  'This is an offline evaluation. Work in /app in the assigned official task container. The only network endpoint is the model API relay. There are no repository remotes, target commit, evaluator files, or other task results. Do not attempt to access answer-bearing evaluation evidence.',
  'Use your native file and shell tools. Run relevant tests directly in /app using the preinstalled official task environment.',
  'Do not use shell heredocs, multiline standard input, or commands that wait for interactive input; use single-line commands or the file editing tools instead.',
  'Before finishing, remove test-generated files and ensure the Git diff contains only intentional solution changes.',
  'Continue until the implementation is complete or the time limit is exhausted.',
].join('\n')
await writeFile(join(root,'submitted-prompt.txt'),prompt+'\n')
const command = ['exec','--workdir','/app',
  '-e','ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=/opt/zcode/zcode-builtin.json',
  '-e','ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=/config/personal.json',
  input.container_name,'/opt/node/bin/node','/opt/zcode/glm/zcode.cjs',
  '--cwd','/app','--mode','yolo','--json','-p',prompt]
let execution
try {
  execution = await executeNative(input, command)
} catch (error) {
  await writeFile(join(root, 'session-outcome.json'), JSON.stringify({ status: 'failed',
    category: 'native-session-recovery-needs-inspection', pauseCandidate: true,
    preserve_native_session: true, at: new Date().toISOString() }, null, 2) + '\n')
  throw error
}
const { result, timedOut } = execution
// Freeze writers while retaining the --rm container for isolation inspection
// and a stable patch snapshot. The runner owns its subsequent stop/cleanup.
if (timedOut) await new Promise((resolve, reject) => {
  const pause = spawn('docker', ['pause', input.container_name], { stdio: 'ignore' })
  pause.once('error', reject)
  pause.once('close', code => code === 0 ? resolve() : reject(new Error('Unable to freeze native task container at work limit')))
})
await writeFile(outputPath,JSON.stringify({schema:1,runtime:'zcode-official-native-cli',preset:'zcode',candidate,
  cli_version:candidate.cli_version,desktop_version:candidate.desktop_version,
  model:{id:'glm-5.3-flash',reasoning_effort:'max',max_tokens:128000},
  native_result:result,elapsed_ms:execution.elapsedMs,time_budget_exhausted:timedOut,
  budget_policy:'effective-work-minus-confirmed-outages/v2',
  budget_cancellation_at_ms:execution.budgetCancelledAtMs??0,
  native_container_frozen_at_budget_limit:timedOut,
  session_recovery:execution.recovery,
  isolation:{policy:'base-only-official-container-and-responses-only-relay/v1',
    task_network:'internal',docker_socket_mounted:false,oracle_mounted:false},
  session_outcome:{status:timedOut?'time-budget-exhausted':'completed'}},null,2)+'\n')
