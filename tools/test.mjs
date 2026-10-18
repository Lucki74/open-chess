// Wrapper so `npm test -- -q` works: vitest has no -q flag, the dot reporter is already quiet.
import { spawnSync } from 'node:child_process'
const args = process.argv.slice(2).filter((a) => a !== '-q' && a !== '--quiet')
const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=dot', ...args], { stdio: 'inherit' })
process.exit(r.status ?? 1)
