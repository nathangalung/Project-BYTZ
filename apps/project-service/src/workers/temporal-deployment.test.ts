import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Workflow code was correct, wiring was not.

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
    // tsx is nobody's dependency here
    const scripts: string[] = [pkg.scripts['start:temporal'], pkg.scripts['dev:temporal']]
    for (const script of scripts) {
      expect(script).toContain('bun')
      expect(script).not.toContain('tsx')
    }
  })

  it('ships src/ in the image, because the worker bundles workflows from source', () => {
    // Build emits only the HTTP entrypoint
    expect(dockerfile).toMatch(/COPY .*apps\/project-service\/src \.\/src/)
  })

  it('gives the worker a memory limit above the HTTP service default', () => {
    // Measured RSS ~350M, 160M would OOM
    const workerBlock = prodCompose.slice(prodCompose.indexOf('project-worker:'))
    const limit = workerBlock.match(/memory:\s*(\d+)M/)
    expect(limit).not.toBeNull()
    expect(Number(limit?.[1])).toBeGreaterThanOrEqual(384)
  })
})

describe('temporal workflow registration', () => {
  const workflowIndex = read('apps/project-service/src/workflows/index.ts')

  it('registers every workflow the routes start', () => {
    // Unregistered types fail at execution
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

  /**
   * A registered workflow nobody starts is dead weight that reads as a feature.
   *
   * escrowSaga sat here for exactly that reason: registered, never started, and
   * its reserveEscrow activity wrote an outbox event no service consumed, so
   * anyone reading it would think escrow was orchestrated. The real path is
   * checkout to the Midtrans webhook to the payment-service ledger.
   */
  it('starts every workflow it registers', () => {
    const started = new Set<string>()
    const routeDir = path.resolve(SERVICE_DIR, 'src/routes')
    for (const file of readdirSync(routeDir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(path.join(routeDir, file), 'utf8')
      for (const [, name] of src.matchAll(/client\.workflow\.start\(\s*(\w+)/g)) {
        started.add(name)
      }
    }

    const registered = [...workflowIndex.matchAll(/from '\.\/(\w+)'/g)].map(([, m]) => m)
    expect(registered.length).toBeGreaterThan(0)

    const unstarted = registered.filter(
      (module) => ![...started].some((name) => name.toLowerCase().startsWith(module.toLowerCase())),
    )
    expect(unstarted).toEqual([])
  })
})

describe('dev/prod temporal parity', () => {
  const devCompose = read('docker-compose.yml')

  it('creates the namespace the services connect to in both environments', () => {
    // Config defaults to kerjacus, not default
    for (const compose of [devCompose, prodCompose]) {
      expect(compose).toContain('DEFAULT_NAMESPACE: kerjacus')
    }
  })
})
