/**
 * Fail the build if the Temporal workflow bundle stops building.
 *
 * Worker.create runs webpack over src/workflows at worker startup, and nothing
 * else in CI touches that path: the service build target is src/index.ts and
 * start:temporal has no job. So a bundling break -- a workflow importing
 * something the sandbox forbids, or an SDK bump changing the bundler -- passes
 * tsc, passes bun build, passes every test, and first shows up when the worker
 * refuses to start. The workflows behind it are escrow release, team formation
 * and dispute resolution.
 *
 * bundleWorkflowCode needs no Temporal server, which is what makes this cheap
 * enough to gate on.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleWorkflowCode } from '@temporalio/worker'

const here = path.dirname(fileURLToPath(import.meta.url))
const workflowsPath = path.resolve(here, '../src/workflows')

const { code } = await bundleWorkflowCode({ workflowsPath })

// An empty bundle would still resolve.
if (code.length < 1000) {
  console.error(`Workflow bundle is ${code.length} bytes, which is not a bundle`)
  process.exit(1)
}

console.log(`Workflow bundle builds: ${code.length} bytes from ${workflowsPath}`)
