import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the deployment wiring of the Temporal worker.
 *
 * Every one of these assertions failed before this suite existed, and together
 * they meant no Temporal workflow had ever executed in production: milestone
 * escrow was never auto-released after 14 days, dispute resolution and team
 * formation never ran. Nothing surfaced it, because starting a workflow and
 * executing it are separate concerns - `client.workflow.start()` returned fine
 * and the work simply sat on a task queue nobody polled.
 *
 * The workflow code itself was correct the whole time, and unit-testing it
 * would still have passed. Only the wiring was broken, so only wiring is
 * asserted here.
 */

const SERVICE_DIR = path.resolve(__dirname, '../..')
const REPO_ROOT = path.resolve(SERVICE_DIR, '../..')

const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), 'utf8')

const prodCompose = read('docker-compose.prod.yml')
const dockerfile = read('apps/project-service/Dockerfile')
const pkg = JSON.parse(read('apps/project-service/package.json'))

const WORKER_ENTRYPOINT = 'src/workers/temporal-worker.ts'

describe('temporal worker deployment', () => {
  it('has a production service that runs the worker', () => {
    expect(prodCompose).toContain(WORKER_ENTRYPOINT)
  })

  it('runs the worker under bun, not a package that is not installed', () => {
    // Both scripts used `node --import tsx`, and tsx is a dependency of no
    // package in the monorepo, so either would have exited immediately.
    const scripts: string[] = [pkg.scripts['start:temporal'], pkg.scripts['dev:temporal']]
    for (const script of scripts) {
      expect(script).toContain('bun')
      expect(script).not.toContain('tsx')
    }
  })

  it('ships src/ in the image, because the worker bundles workflows from source', () => {
    // `bun run build` emits only the bundled HTTP entrypoint, so a runner stage
    // copying just dist/ has no worker file and no workflows to bundle.
    expect(dockerfile).toMatch(/COPY .*apps\/project-service\/src \.\/src/)
  })

  it('gives the worker a memory limit above the HTTP service default', () => {
    // Measured steady-state RSS is ~350M: Temporal's Rust core plus a V8 isolate
    // per workflow. project-service's 160M would OOM-loop.
    const workerBlock = prodCompose.slice(prodCompose.indexOf('project-worker:'))
    const limit = workerBlock.match(/memory:\s*(\d+)M/)
    expect(limit).not.toBeNull()
    expect(Number(limit?.[1])).toBeGreaterThanOrEqual(384)
  })
})

describe('temporal workflow registration', () => {
  const workflowIndex = read('apps/project-service/src/workflows/index.ts')

  it('registers every workflow the routes start', () => {
    // A workflow started by a route but absent from the worker's bundle would be
    // accepted by the server and then fail with "workflow type not registered".
    const routeDir = 'apps/project-service/src/routes'
    const started = new Set<string>()
    for (const file of ['milestones.ts', 'disputes.ts', 'projects.ts']) {
      const src = read(path.join(routeDir, file))
      for (const [, name] of src.matchAll(/client\.workflow\.start\(\s*(\w+)/g)) {
        started.add(name)
      }
    }

    expect(started.size).toBeGreaterThan(0)
    for (const name of started) {
      expect(workflowIndex).toContain(name.replace(/Workflow$/, ''))
    }
  })
})

describe('dev/prod temporal parity', () => {
  const devCompose = read('docker-compose.yml')

  it('creates the namespace the services connect to in both environments', () => {
    // TEMPORAL_NAMESPACE defaults to `kerjacus` (packages/config), but dev's
    // auto-setup registered only `default`, so dev could not run a workflow at
    // all until the namespace was created by hand.
    for (const compose of [devCompose, prodCompose]) {
      expect(compose).toContain('DEFAULT_NAMESPACE: kerjacus')
    }
  })
})
