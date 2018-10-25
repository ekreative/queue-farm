const queues = require('../index')

async function fill () {
  const m = queues.createManager('example')

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 100; j++) {
      await m.push(`q:${i}`, `data ${j}`)
    }
  }

  await m.redis.quit()
}

fill()
  .then(() => {
    console.log('finished')
  })
  .catch(err => {
    console.log('caught e', err)
  })
