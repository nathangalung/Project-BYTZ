import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NativeConnection, Worker } from '@temporalio/worker'
import * as activities from '../activities'
import { env } from '../lib/env'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function run() {
  const { TEMPORAL_URL, TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE } = env

  console.log(`[temporal-worker] connecting to ${TEMPORAL_URL} namespace=${TEMPORAL_NAMESPACE}`)
  const connection = await NativeConnection.connect({ address: TEMPORAL_URL })

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowsPath: path.resolve(__dirname, '../workflows'),
    activities,
  })

  console.log(`[temporal-worker] starting on task queue '${TEMPORAL_TASK_QUEUE}'`)
  await worker.run()
}

run().catch((err) => {
  console.error('[temporal-worker] fatal:', err)
  process.exit(1)
})
