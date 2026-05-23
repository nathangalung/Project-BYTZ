import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NativeConnection, Worker } from '@temporalio/worker'
import * as activities from '../activities'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function run() {
  const address = process.env.TEMPORAL_URL || 'localhost:7233'
  const namespace = process.env.TEMPORAL_NAMESPACE || 'kerjacus'
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'project-service'

  console.log(`[temporal-worker] connecting to ${address} namespace=${namespace}`)
  const connection = await NativeConnection.connect({ address })

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../workflows'),
    activities,
  })

  console.log(`[temporal-worker] starting on task queue '${taskQueue}'`)
  await worker.run()
}

run().catch((err) => {
  console.error('[temporal-worker] fatal:', err)
  process.exit(1)
})
