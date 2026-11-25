// done-check: the pure logic. No `$` in here, so the tests can drive it directly.

import type { DoneCheckVerdict, DoneCheckTurn } from '../types'
import { redact } from './redact'

// ---------- what counts as a verification ----------

/** One shell segment (split on && || ; | and newlines) that is a check. */
const CHECK_PATTERNS: readonly RegExp[] = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test|lint|typecheck|type-check|check)(:[\w:-]+)?(\s|$)/i,
  /(^|[\s;&|(/\\])(tsc|vue-tsc|vitest|jest|mocha|ava|eslint|biome|nox|tox)(\.cmd|\.js)?(\s|$)/i,
  /(^|[\s;&|(])(npx\s+|bunx\s+|pnpm\s+(exec\s+)?)?(playwright|cypress)(\.cmd)?\s/i,
  /(^|[\s;&|(/\\])(pytest|mypy|pyright|ruff)(\.exe)?(\s|$)/i,
  /\bpython3?\s+-m\s+unittest\b/i,
  /\bnode(\.exe)?\s+--test\b/i,
  /\bdeno\s+(test|check|lint)\b/i,
  /\bcargo\s+(test|check|build|clippy|nextest)\b/i,
  /\bgo\s+(test|vet|build)\b/i,
  /\bdotnet\s+(test|build)\b/i,
  /(^|[\s;&|(/\\])(mvn|mvnw|gradle|gradlew)(\.cmd|\.bat)?\s.*\b(test|check|build|verify)\b/i,
  /(^|[\s;&|(/\\])bazel(\.exe|\.cmd)?\s+(test|build|run|coverage)\b/i,
  /(^|[\s;&|(/\\])(npx\s+|pnpm\s+(exec\s+)?|yarn\s+|bunx\s+)?nx\s+(test|build|lint|e2e)\b/i,
  /(^|[\s;&|(/\\])(npx\s+|pnpm\s+(exec\s+)?|yarn\s+|bunx\s+)?nx\s+run\s+[\w-]+:(test|build|lint|e2e)\b/i,
  /(^|[\s;&|(/\\])(npx\s+|pnpm\s+(exec\s+)?|yarn\s+|bunx\s+)?turbo(\.cmd)?\s+(run\s+)?(test|build|lint|check|typecheck)\b/i,
  /\b(make|just|rake|mix|swift|zig|flutter)\s+(test|tests|check|lint|build|verify|analyze)\b/i,
  /(^|[\s;&|(/\\])(rspec|phpunit|shellcheck|ctest)(\s|$)/i,
  /\bterraform\s+(validate|plan)\b/i,
  /\bgit\s+fsck\b/i,
  /\bclaude(\.cmd|\.exe)?\s+plugin\s+(validate|test)\b/i,
  // a request to your own running app
  /(^|[\s;&|(])(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)(\.exe)?\b[^\n]*https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i,
]

/** A segment led by one of these only mentions a check (grep "npm run build"). */
const MENTION_ONLY = /^\s*(grep|rg|egrep|echo|printf|cat|less|head|tail|Select-String|sls|Write-Host|Write-Output|which|where|git\s+(commit|log|show|grep|diff)|(npm|pnpm|yarn|bun|pip|pip3|brew|apt|apt-get|winget)\s+(i|install|add|remove|uninstall)\b)/i

/** Browser tools: looking at the running app is a check. */
const CHECK_TOOLS: readonly RegExp[] = [/^mcp__.*(playwright|chrome|puppeteer|browser)/i]

/** What config.json may add. */
export type Extra = { checks: RegExp[]; tools: RegExp[]; ignore: string[] }
export const NO_EXTRA: Extra = { checks: [], tools: [], ignore: [] }

/** A settings list as patterns; one that is not a valid pattern is dropped. */
export function patterns(list: readonly string[]): RegExp[] {
  const out: RegExp[] = []
  for (const source of list) {
    try {
      out.push(new RegExp(source, 'i'))
    } catch {
      // not a pattern
    }
  }
  return out
}

export function splitSegments(command: string): string[] {
  return stripHeredocs(command)
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** The check a shell command runs, as its first matching segment, or null. */
export function checkCommand(command: string, extra: Extra = NO_EXTRA): string | null {
  for (const seg of splitSegments(command)) {
    if (MENTION_ONLY.test(seg)) continue
    if (CHECK_PATTERNS.some((re) => re.test(seg)) || extra.checks.some((re) => re.test(seg))) return clip(seg.replace(/\s+/g, ' '), 120)
  }
  return null
}

export function isCheckTool(tool: string, extra: Extra = NO_EXTRA): boolean {
  return CHECK_TOOLS.some((re) => re.test(tool)) || extra.tools.some((re) => re.test(tool))
}

// ---------- what counts as a file change ----------

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

/** Scratch locations: writes there are not project changes. */
const SCRATCH = /(^|[\\/])(tmp|temp|scratchpad|\.cache|node_modules)([\\/]|$)|^\$(env:)?(TMP|TEMP|TMPDIR)\b|^%(TMP|TEMP)%|^\/tmp\b/i
const NULL_SINKS = /^(\/dev\/null|\$null|nul|&\d|con)$/i

export function isScratch(path: string, extra: Extra = NO_EXTRA): boolean {
  if (SCRATCH.test(path)) return true
  const flat = path.replace(/\\/g, '/').toLowerCase()
  return extra.ignore.some((part) => flat.includes(part.replace(/\\/g, '/').toLowerCase()))
}

const DOC_EXT = /\.(md|markdown|mdx|txt)$/i
export function isDoc(path: string): boolean {
  return DOC_EXT.test(path)
}

function stripHeredocs(cmd: string): string {
  return cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '<<$2$3')
    .replace(/@'[\s\S]*?\n'@/g, "''")
    .replace(/@"[\s\S]*?\n"@/g, '""')
}

/** The command with every quoted span's inside turned to '_' (same length). */
function maskQuotes(s: string): string {
  let out = ''
  let q = ''
  for (const ch of s) {
    if (q) {
      if (ch === q) {
        q = ''
        out += ch
      } else out += '_'
    } else {
      if (ch === '"' || ch === "'") q = ch
      out += ch
    }
  }
  return out
}

function unquote(t: string): string {
  return t.replace(/^["']|["']$/g, '')
}

/** Tokens of a segment, quotes kept together. */
function tokens(seg: string): string[] {
  return (seg.match(/"[^"]*"|'[^']*'|[^\s]+/g) || []).map(unquote)
}

const WRITE_CMDS: ReadonlyArray<[RegExp, 'last' | 'first' | 'flag']> = [
  [/^(cp|mv|Copy-Item|Move-Item|copy|move|cpi|mi)$/i, 'last'],
  [/^(rm|del|Remove-Item|ri|touch|tee|Out-File|Set-Content|Add-Content|sc|ac)$/i, 'flag'],
  [/^New-Item$/i, 'flag'],
]

/**
 * Files a shell command clearly writes: redirect targets, and the targets of
 * cp/mv/rm/tee/sed -i/Out-File/Set-Content/Add-Content/New-Item/Copy-Item/...
 * A write whose target cannot be read is listed as "(shell) <command>".
 */
export function shellWrites(command: string, extra: Extra = NO_EXTRA): string[] {
  const found: string[] = []
  const cmd = stripHeredocs(command)
  // redirects, outside quotes
  const masked = maskQuotes(cmd)
  const re = />>?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    const at = m.index
    const prev = at > 0 ? masked[at - 1] : ''
    if (prev && /[0-9&>=\-<]/.test(prev)) continue
    if (masked[at + m[0].length] === '&') continue
    const rest = cmd.slice(at + m[0].length)
    const t = rest.match(/^\s*("[^"]+"|'[^']+'|[^\s;&|)]+)/)
    if (!t || !t[1]) continue
    const target = unquote(t[1])
    if (!NULL_SINKS.test(target)) found.push(target)
  }
  for (const seg of splitSegments(cmd)) {
    const toks = tokens(seg)
    const head = toks[0] || ''
    const args = toks.slice(1)
    if (/^sed$/i.test(head) && args.some((a) => /^-i/.test(a))) {
      const last = args[args.length - 1]
      found.push(last && !last.startsWith('-') ? last : `(shell) ${clip(seg, 60)}`)
      continue
    }
    if (/^git$/i.test(head) && /^(apply|restore|checkout)$/i.test(args[0] || '') && (args[0] !== 'checkout' || args.includes('--'))) {
      found.push(`(shell) ${clip(seg, 60)}`)
      continue
    }
    const rule = WRITE_CMDS.find(([r]) => r.test(head))
    if (!rule) continue
    if (/^New-Item$/i.test(head) && /-ItemType\s+['"]?Directory/i.test(seg)) continue
    const plain = args.filter((a) => !a.startsWith('-'))
    let target: string | undefined
    if (rule[1] === 'last') target = plain[plain.length - 1]
    else {
      const flagAt = args.findIndex((a) => /^-(Path|LiteralPath|FilePath)$/i.test(a))
      target = flagAt >= 0 ? args[flagAt + 1] : plain[0]
    }
    found.push(target ? target : `(shell) ${clip(seg, 60)}`)
  }
  return [...new Set(found.filter((p) => p && !NULL_SINKS.test(p) && !isScratch(p, extra)))]
}

// ---------- one turn's record ----------

export type CheckRun = { cmd: string; seq: number; ok: boolean }

export type TurnRecord = {
  startedAt: number
  prompt: string
  calls: number
  /** path -> the seq of its last change */
  files: Map<string, number>
  checks: CheckRun[]
}

export function newTurn(prompt: string, startedAt: number): TurnRecord {
  return { startedAt, prompt, calls: 0, files: new Map(), checks: [] }
}

export type Verdict = Omit<DoneCheckVerdict, 'turn'> & {
  /** checks that count (fresh), for the ledger */
  ran: string[]
  /** checks that ran before the last edit */
  stale: string[]
  hasCode: boolean
}

/** Latest run per distinct command, in run order. */
function latestPerCmd(runs: readonly CheckRun[]): CheckRun[] {
  const by = new Map<string, CheckRun>()
  for (const r of runs) by.set(r.cmd, r)
  return [...by.values()].sort((a, b) => a.seq - b.seq)
}

export function judge(t: TurnRecord): Verdict {
  const paths = [...t.files.keys()]
  const changed = paths.length
  const lastEdit = changed ? Math.max(...t.files.values()) : -1
  const hasCode = paths.some((p) => !isDoc(p))
  const fresh = t.checks.filter((c) => c.seq > lastEdit)
  const staleRuns = t.checks.filter((c) => c.seq <= lastEdit)
  const latest = latestPerCmd(fresh)
  const ran = latest.map((c) => c.cmd)
  const stale = latestPerCmd(staleRuns).map((c) => c.cmd).filter((c) => !ran.includes(c))
  const failed = latest.filter((c) => !c.ok)
  const lastFailed = failed[failed.length - 1]
  if (lastFailed) return { kind: 'failed', changed, cmd: lastFailed.cmd, ran, stale, hasCode }
  if (hasCode && fresh.length === 0) return { kind: 'unverified', changed, ran, stale, hasCode }
  if (latest.length > 0) return { kind: 'verified', changed, ran, stale, hasCode }
  return { kind: 'none', changed, ran, stale, hasCode }
}

export function verifiedWord(v: Verdict): DoneCheckTurn['verified'] {
  if (v.kind === 'failed') return 'failed'
  if (v.kind === 'verified') return 'yes'
  if (v.kind === 'unverified') return v.stale.length ? 'stale' : 'no'
  return v.changed ? 'no' : 'n/a'
}

export function shouldLog(t: TurnRecord): boolean {
  return t.files.size > 0 || t.calls > 2
}

// ---------- the words ----------

function files(n: number): string {
  return `${n} file${n === 1 ? '' : 's'}`
}

/** The short status line. */
export function statusText(v: Pick<DoneCheckVerdict, 'kind' | 'changed' | 'cmd'>): string | null {
  if (v.kind === 'unverified') return `unverified · ${files(v.changed)} · /done`
  if (v.kind === 'failed') return `check failed: ${clip(v.cmd || 'a check', 40)}`
  return null
}

/** What the next prompt carries for Claude while the flag is up. */
export function nudgeText(v: Pick<DoneCheckVerdict, 'kind' | 'cmd'>): string | null {
  if (v.kind === 'unverified') {
    return 'done-check: your last turn changed code and ran no build, test or check afterwards. Run one before you say the work is done.'
  }
  if (v.kind === 'failed') {
    return `done-check: your last turn ended with a failing check (${clip(v.cmd || '', 120)}). Fix it, or say plainly that it fails, before you say the work is done.`
  }
  return null
}

/** What sends Claude back to work in insist mode, once per turn. */
export function insistText(v: Pick<DoneCheckVerdict, 'kind' | 'changed' | 'cmd'>): string | null {
  if (v.kind === 'unverified') {
    return `done-check: you changed ${files(v.changed)} and ran no build, test or check after the last change. Run the one that fits now and report its real result. If nothing here can check it, say "not verified" and why.`
  }
  if (v.kind === 'failed') {
    return `done-check: the last run of "${clip(v.cmd || 'a check', 120)}" failed. Fix it and run it again, or say plainly that it still fails and why.`
  }
  return null
}

// ---------- the ledger ----------

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local date YYYY-MM-DD for a time in ms. */
export function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function localTime(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function ledgerPath(ms: number, dir: string): string {
  return `${dir}/${localDate(ms)}.md`
}

export function ledgerHeader(ms: number): string {
  return `# Work log ${localDate(ms)}\n\nWritten by the done-check mod after every turn that changed files or made more than 2 tool calls.\n`
}

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** A path made short: relative to the session's folder or the home folder, else the tail. */
export function shortPath(path: string, cwd: string): string {
  if (path.startsWith('(shell)')) return path
  const p = path.replace(/\\/g, '/')
  const base = cwd.replace(/\\/g, '/').replace(/\/$/, '')
  if (base && p.toLowerCase().startsWith(base.toLowerCase() + '/')) return p.slice(base.length + 1)
  const home = p.match(/^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+\/(.*)$/i)
  if (home && home[1]) return '~/' + home[1]
  const parts = p.split('/').filter(Boolean)
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p
}

const REPORT_MARK = /✅|⚠/

/** The reply's report lines (✅/⚠️), up to 5; else its first 400 characters. */
export function replyExcerpt(answer: string): string[] {
  const clean = String(answer ?? '')
  const marked = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => REPORT_MARK.test(l))
    .slice(0, 5)
    .map((l) => clip(redact(l), 240))
  if (marked.length) return marked
  const head = oneLine(clean)
  return head ? [clip(redact(head), 400)] : []
}

export type LedgerInput = {
  endedAt: number
  durationMs: number
  sessionId: string
  cwd: string
  prompt: string
  files: readonly string[]
  calls: number
  verdict: Verdict
  answer: string
  isAborted: boolean
}

export function ledgerEntry(x: LedgerInput): string {
  const where = x.cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() || x.cwd
  const secs = Math.round(x.durationMs / 1000)
  const took = secs >= 60 ? `${Math.floor(secs / 60)}m ${pad2(secs % 60)}s` : `${secs}s`
  const head = `## ${localTime(x.endedAt)} · ${where} · session ${x.sessionId.slice(0, 8)} · ${x.calls} tool call${x.calls === 1 ? '' : 's'} · ${took}${x.isAborted ? ' · interrupted' : ''}`
  const prompt = clip(oneLine(redact(x.prompt)), 300) || '(no prompt text)'
  const shown = x.files
    .slice(0, 15)
    .map((f) => '`' + redact(shortPath(f, x.cwd)).replace(/`/g, "'") + '`')
  const more = x.files.length - Math.min(x.files.length, 15)
  const files = x.files.length ? `${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}` : 'none'
  const code = (c: string) => '`' + redact(c).replace(/`/g, "'") + '`'
  const v = x.verdict
  const okCmds = v.ran.map(code).join(', ')
  let verified: string
  if (v.kind === 'failed') verified = `failed: ${code(v.cmd || '')}${okCmds ? ` (ran: ${okCmds})` : ''}`
  else if (v.kind === 'verified') verified = `yes: ${okCmds}`
  else if (v.stale.length) verified = `no (only before the last edit: ${v.stale.map(code).join(', ')})`
  else verified = 'no'
  const reply = replyExcerpt(x.answer)
  const lines = [
    head,
    '',
    `- **Prompt:** ${prompt}`,
    `- **Files changed (${x.files.length}):** ${files}`,
    `- **Verified:** ${verified}`,
  ]
  if (reply.length) {
    lines.push('- **Reply:**')
    for (const r of reply) lines.push(`  > ${r}`)
  }
  return lines.join('\n') + '\n'
}

/** The ledger file's new text: the old one (or a header) plus the entry. */
export function appendEntry(existing: string | null, entry: string, ms: number): string {
  const base = existing === null ? ledgerHeader(ms) : existing
  return base.replace(/\s*$/, '\n') + '\n' + entry
}

// ---------- /done ----------

export type Mode = { on: boolean; insist: boolean; log: boolean }

export function turnsTable(turns: readonly DoneCheckTurn[], mode: Mode, path: string): string {
  const lines: string[] = []
  lines.push(`done-check is ${mode.on ? 'ON' : 'OFF'} · insist ${mode.insist ? 'ON' : 'off'} · work log ${mode.log ? path : 'off'}`)
  if (!turns.length) {
    lines.push('No finished turns in this session yet.')
    return lines.join('\n')
  }
  lines.push('')
  lines.push('  #  time   changed  verified  logged  prompt')
  for (const t of turns.slice(-25)) {
    lines.push(
      `${String(t.turn).padStart(3)}  ${t.at}  ${String(t.changed).padStart(7)}  ${t.verified.padEnd(8)}  ${(t.logged ? 'yes' : '-').padEnd(6)}  ${clip(t.prompt, 60)}`,
    )
  }
  const unverified = turns.filter((t) => t.verified === 'no' || t.verified === 'stale' || t.verified === 'failed').length
  lines.push('')
  lines.push(`${turns.length} turn${turns.length === 1 ? '' : 's'} · ${turns.filter((t) => t.changed > 0).length} changed something · ${unverified} not verified or failing`)
  return lines.join('\n')
}
