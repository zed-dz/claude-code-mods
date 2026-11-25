import { describe, expect, test } from 'claude-code/testing'

import {
  appendEntry,
  checkCommand,
  isCheckTool,
  judge,
  ledgerEntry,
  newTurn,
  replyExcerpt,
  shellWrites,
  shortPath,
} from '../hooks/core'
import { redact } from '../hooks/redact'

describe('what counts as a verification', () => {
  test('build/test/check commands count', () => {
    const yes = [
      'npm run build',
      'cd "C:/x y/app" && npm run typecheck',
      'npm test',
      'pnpm lint',
      'npx tsc --noEmit',
      'node node_modules/typescript/bin/tsc -p tsconfig.json',
      'npx vitest run',
      'npx playwright test',
      'python -m pytest -q',
      'python3 -m unittest discover',
      'ruff check .',
      'cargo clippy',
      './gradlew test',
      'mvn -q verify',
      'dotnet test',
      'make test',
      'npm run test:unit',
      'npx eslint src',
      'git fsck --full',
      'claude plugin validate --strict ./mod',
      'claude plugin test ./mod',
      'curl -s http://localhost:3000/health | jq .',
      'Invoke-WebRequest -Uri http://127.0.0.1:8080 -UseBasicParsing',
      'node --test',
      'deno test',
      'bazel test //...',
      'npx nx test app',
      'nx run app:test',
      'turbo run test',
      'npx turbo run build',
    ]
    for (const c of yes) expect(checkCommand(c), c).not.toBeNull()
  })

  test('look-alikes do not count', () => {
    const no = [
      'ls',
      'git status',
      'grep -n "npm run build" README.md',
      'echo npm test',
      'ls build/mods-tsc',
      'cd tools/ms-playwright && ls',
      'curl -s https://example.com/data.json',
      'npm install vitest',
      'pip install pytest',
      'which eslint',
      'export PLAYWRIGHT_BROWSERS_PATH=/x',
      'curl -s file.txt',
      'git commit -m "run npm test later"',
      'npm install',
      'grep "bazel test //..."',
      'grep "nx test"',
      'grep "turbo run test"',
    ]
    for (const c of no) expect(checkCommand(c), c).toBeNull()
  })

  test('check tools', () => {
    expect(isCheckTool('mcp__playwright__browser_navigate')).toBe(true)
    expect(isCheckTool('mcp__claude-in-chrome__read_page')).toBe(true)
    expect(isCheckTool('WebFetch')).toBe(false)
    expect(isCheckTool('mcp__db__query', { checks: [], tools: [/^mcp__db__/], ignore: [] })).toBe(true)
    expect(isCheckTool('Read')).toBe(false)
  })
})

describe('what counts as a shell write', () => {
  test('redirects and file commands', () => {
    expect(shellWrites('echo hi > notes.txt')).toEqual(['notes.txt'])
    expect(shellWrites('cat >> "C:/a b/log.md" <<EOF\n<div>x</div>\nEOF')).toEqual(['C:/a b/log.md'])
    expect(shellWrites('cp a.ts src/b.ts')).toEqual(['src/b.ts'])
    expect(shellWrites('Set-Content -Path app.json -Value 1')).toEqual(['app.json'])
    expect(shellWrites("sed -i 's/a/b/' src/x.ts")).toEqual(['src/x.ts'])
    expect(shellWrites('rm -f old.js')).toEqual(['old.js'])
  })

  test('not writes', () => {
    expect(shellWrites('npm run build 2>&1 | tail -5')).toEqual([])
    expect(shellWrites('ls > /dev/null')).toEqual([])
    expect(shellWrites('Get-ChildItem | Out-Null')).toEqual([])
    expect(shellWrites('echo "a > b"')).toEqual([])
    expect(shellWrites('node -e "const f = (x) => x"')).toEqual([])
    expect(shellWrites('echo x > "C:/Users/tester/AppData/Local/Temp/out.txt"')).toEqual([])
    expect(shellWrites('New-Item -ItemType Directory -Force src/lib')).toEqual([])
    expect(shellWrites('git status')).toEqual([])
  })
})

describe('the verdict', () => {
  test('edit with no check is unverified', () => {
    const t = newTurn('p', 0)
    t.files.set('src/a.ts', 1)
    expect(judge(t).kind).toBe('unverified')
  })

  test('check after the last edit is fresh', () => {
    const t = newTurn('p', 0)
    t.files.set('src/a.ts', 1)
    t.checks.push({ cmd: 'npm run build', seq: 2, ok: true })
    const v = judge(t)
    expect(v.kind).toBe('verified')
    expect(v.ran).toEqual(['npm run build'])
  })

  test('check before the last edit is stale', () => {
    const t = newTurn('p', 0)
    t.checks.push({ cmd: 'npm run build', seq: 1, ok: true })
    t.files.set('src/a.ts', 2)
    const v = judge(t)
    expect(v.kind).toBe('unverified')
    expect(v.stale).toEqual(['npm run build'])
  })

  test('the latest run of each command decides; a failure wins', () => {
    const t = newTurn('p', 0)
    t.files.set('src/a.ts', 1)
    t.checks.push({ cmd: 'npm run build', seq: 2, ok: false })
    t.checks.push({ cmd: 'npm run lint', seq: 3, ok: true })
    expect(judge(t)).toMatchObject({ kind: 'failed', cmd: 'npm run build' })
    t.checks.push({ cmd: 'npm run build', seq: 4, ok: true })
    expect(judge(t).kind).toBe('verified')
  })

  test('docs-only changes do not raise the flag', () => {
    const t = newTurn('p', 0)
    t.files.set('README.md', 1)
    expect(judge(t).kind).toBe('none')
  })

  test('a failing check with no edits is still failed', () => {
    const t = newTurn('p', 0)
    t.checks.push({ cmd: 'npm test', seq: 1, ok: false })
    expect(judge(t).kind).toBe('failed')
  })
})

describe('secrets never reach the log', () => {
  test('token shapes are hidden (made-up values)', () => {
    const s = redact(
      `gh ${'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'} gp ${'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnop'} ` +
        `sk ${'sk-ant-' + 'api03-AbCdEfGh0123456789'} hex ${'0123456789abcdef'.repeat(2)} ` +
        `b64 ${'Zm9vYmFy' + 'QmF6UXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUo='} password=${'hunter2'.repeat(2)}`,
    )
    for (const leak of ['ghp_ABC', 'github_pat_11', 'sk-ant', '0123456789abcdef0123', 'Zm9vYmFy', 'hunter2']) {
      expect(s, leak).not.toContain(leak)
    }
    expect(s).toContain('password=[hidden]')
  })

  test('compound names are hidden too; counts and paths stay', () => {
    const s = redact('DB_PASSWORD=' + 'Qx7pLm2vRt9k and app_db_pass: ' + 'Zz9yYx8wWv7u and tokens: 48,000 used')
    expect(s).not.toContain('Qx7pLm2vRt9k')
    expect(s).not.toContain('Zz9yYx8wWv7u')
    expect(s).toContain('tokens: 48,000 used')
    const p = 'docs/history/2026-10-04-header-fix-and-checkout-v2.md and C:/Users/tester/projects/shop-frontend'
    expect(redact(p)).toBe(p)
  })

  test('an entry', () => {
    const entry = ledgerEntry({
      endedAt: Date.UTC(2026, 9, 4, 10, 0),
      durationMs: 65000,
      sessionId: '00000000-1111-4222-8333-444444444444',
      cwd: 'C:/work/shop',
      prompt: 'Fix the login page.\nThen deploy.',
      files: ['C:/work/shop/app/src/a.ts'],
      calls: 5,
      verdict: { kind: 'verified', changed: 1, ran: ['npm run build'], stale: [], hasCode: true },
      answer: '✅ Done — login fixed\nsome detail\n⚠️ Needs your attention: none',
      isAborted: false,
    })
    expect(entry).toContain('Fix the login page. Then deploy.')
    expect(entry).toContain('`app/src/a.ts`')
    expect(entry).toContain('**Verified:** yes: `npm run build`')
    expect(entry).toContain('> ✅ Done — login fixed')
    expect(entry).not.toContain('some detail')
    expect(entry).toContain('1m 05s')
  })
})

describe('the ledger file', () => {
  test('a new file gets the header; an old one is appended to', () => {
    const ms = new Date(2026, 9, 4, 9, 30).getTime()
    const first = appendEntry(null, '## a\n', ms)
    expect(first.startsWith('# Work log 2026-10-04\n')).toBe(true)
    const second = appendEntry(first, '## b\n', ms)
    expect(second.startsWith(first.trimEnd())).toBe(true)
    expect(second.endsWith('## b\n')).toBe(true)
  })

  test('reply without report marks falls back to its head', () => {
    const long = 'x'.repeat(1000)
    const r = replyExcerpt(long)
    expect(r).toHaveLength(1)
    expect(r[0]!.length).toBeLessThanOrEqual(400)
  })

  test('short paths', () => {
    expect(shortPath('C:\\proj\\src\\a.ts', 'C:\\proj')).toBe('src/a.ts')
    expect(shortPath('C:/Users/tester/code/lib/core.ts', 'C:/other')).toBe('~/code/lib/core.ts')
    expect(shortPath('/home/tester/code/lib/core.ts', '/srv')).toBe('~/code/lib/core.ts')
  })
})
