const queues = require('../index')

for (let i = 0; i < 5; i++) {
  const id = i
  const worker = queues.createWorker('example', async (queue, job) => {
    console.log(`Worker ${id}: Handling a job`, queue, job)
  })

  worker.listen().then(() => {
    console.log('finished listening ??')
  }).catch(err => {
    console.log('caught', err)
  })
}
