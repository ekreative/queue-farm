const queues = require('../index')

const worker = queues.createWorker('example', async (queue, job) => {
  console.log(`Worker: Handling a job`, queue, job)
})

worker.listen().then(() => {
  console.log('finished listening')
  worker.redis.quit()
}).catch(err => {
  console.log('caught', err)
})

worker.on('no-active-queues', () => {
  console.log('Sleeping with no active queues')
})

worker.on('all-empty', () => {
  console.log('Sleeping because all queues are empty')
})

process.on('SIGINT', () => {
  worker.stop()
})
