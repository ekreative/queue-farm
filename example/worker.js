const queues = require('../index')

const worker = queues.createWorker({ namespace: 'example' }, async (queue, job) => {
  console.log(`Worker: Handling a job`, queue, job)
})
queues.createLogger(worker, console).on([])

worker.listen().then(() => {
  console.log('finished listening')
  worker.redis.quit()
}).catch(err => {
  console.log('caught', err)
})

process.on('SIGINT', () => {
  worker.stop()
})
