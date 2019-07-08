const queues = require('../index')
const sleep = require('../lib/sleep')

for (let i = 0; i < 1; i++) {
  const id = i
  const worker = queues.createWorker({ namespace: 'example' }, async (queue, job) => {
    console.log(`Worker ${id}: Handling a job`, queue, job)
    await sleep(10000)
    console.log(`Worker ${id}: Finishing handling a job`, queue, job)
  })
  queues.createLogger(worker, console, { exceptEvents: [] }).on()

  worker.listen().then(() => {
    console.log('finished listening ??')
  }).catch(err => {
    console.log('caught', err)
  })
}
