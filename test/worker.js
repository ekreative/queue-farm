/* eslint-env mocha */
const assert = require('assert').strict
const Redis = require('ioredis')
const queues = require('../index')
const sleep = require('../lib/sleep')

describe('Worker', () => {
  let r

  beforeEach(async () => {
    r = new Redis()
    await r.flushall()
  })

  afterEach(async () => {
    await r.quit()
  })

  describe('#listen()', () => {
    it('should emit the job in the queue', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      const jobId = await m.push('my:queue', 'data')

      let count = 0
      let startCount = 0
      let finishCount = 0
      let allEmptyCount = 0

      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
        assert.equal(queue, 'my:queue')
        assert.equal(job, 'data')
      })

      w.on('start', (queue, eventJobId) => {
        startCount++
        assert.equal(eventJobId, jobId)
        assert.equal(queue, 'my:queue')
      })

      w.on('finish', (queue, eventJobId) => {
        finishCount++
        assert.equal(eventJobId, jobId)
        assert.equal(queue, 'my:queue')
      })

      w.on('all-empty', () => {
        allEmptyCount++
      })

      await w.drain()
      assert.equal(count, 1)
      assert.equal(startCount, 1)
      assert.equal(finishCount, 1)
      assert.equal(allEmptyCount, 1)
      assert.equal(await r.llen('test:queue:my:queue'), 0)
      assert.equal(await r.llen('test:active:my:queue'), 0)
      assert.deepEqual(await r.hgetall(`test:job:${jobId}`), {})
    })

    it('should emit the jobs from multiple queues', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      await m.push('my:queue', 'data')
      await m.push('another:queue', 'data2')

      let expecting = { 'my:queue': { job: 'data', count: 0 }, 'another:queue': { job: 'data2', count: 0 } }
      let count = 0

      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
        if (!expecting[queue]) {
          assert.fail('Unexpected queue')
        }
        assert.equal(job, expecting[queue].job)
        expecting[queue].count++
      })
      await w.drain()
      assert.equal(count, 2)
      assert.equal(expecting['my:queue'].count, 1)
      assert.equal(expecting['another:queue'].count, 1)
      assert.equal(await r.llen('test:queue:my:queue'), 0)
      assert.equal(await r.llen('test:queue:another:queue'), 0)
    })

    it('should emit the jobs from multiple queues in order', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      await m.push('my:queue', 0)
      await m.push('another:queue', 0)
      await m.push('my:queue', 1)
      await m.push('another:queue', 1)

      let expecting = { 'my:queue': 0, 'another:queue': 0 }
      let count = 0

      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
        await sleep(Math.random() * 10)
        if (expecting[queue] === null) {
          assert.fail('Unexpected queue')
        }
        assert.equal(job, expecting[queue])
        expecting[queue]++
      })
      await w.drain()
      assert.equal(count, 4)
      assert.equal(expecting['my:queue'], 2)
      assert.equal(expecting['another:queue'], 2)
      assert.equal(await r.llen('test:queue:my:queue'), 0)
      assert.equal(await r.llen('test:queue:another:queue'), 0)
    })

    it('should emit the jobs from multiple queues in order with concurrency', async function () {
      this.timeout(10000)

      const m = queues.createManager({ namespace: 'test', redis: r })
      let expecting = {}
      for (let i = 0; i < 20; i++) {
        expecting[`q:${i}`] = 0
        for (let j = 0; j < 100; j++) {
          await m.push(`q:${i}`, j)
        }
      }

      let count = 0
      let maxActive = 0
      let active = 0

      const w = queues.createWorker({ namespace: 'test', redis: r, concurrent: 10 }, async (queue, job) => {
        count++
        active++
        await sleep(Math.random() * 10)
        if (expecting[queue] === null) {
          assert.fail('Unexpected queue')
        }
        assert.equal(job, expecting[queue])
        assert.ok(active <= 10)
        if (maxActive < active) {
          maxActive = active
        }
        expecting[queue]++
        active--
      })
      await w.drain()
      assert.equal(count, 2000)
      assert.ok(maxActive > 1)
      for (let i = 0; i < 20; i++) {
        assert.equal(expecting[`q:${i}`], 100)
        assert.equal(await r.llen(`test:queue:q:${i}`), 0)
        assert.equal(await r.llen(`test:active:q:${i}`), 0)
      }
    })

    it('should emit the jobs in order to multiple workers', async function () {
      this.timeout(100000)

      const m = queues.createManager({ namespace: 'test', redis: r })
      let expecting = {}
      for (let i = 0; i < 10; i++) {
        expecting[`q:${i}`] = 0
        for (let j = 0; j < 100; j++) {
          await m.push(`q:${i}`, j)
        }
      }

      let count = 0

      const handler = async (queue, job) => {
        count++
        await sleep(Math.random() * 10)
        if (expecting[queue] === null) {
          assert.fail('Unexpected queue')
        }
        assert.equal(job, expecting[queue])
        expecting[queue]++
      }

      let workers = []
      for (let i = 0; i < 10; i++) {
        const w = queues.createWorker({ namespace: 'test', concurrent: 5 }, handler)
        workers.push(w)
      }
      await Promise.all(workers.map(w => w.drain()))

      assert.equal(count, 1000)
      for (let i = 0; i < 10; i++) {
        assert.equal(expecting[`q:${i}`], 100)
        assert.equal(await r.llen(`test:queue:q:${i}`), 0)
        assert.equal(await r.llen(`test:active:q:${i}`), 0)
      }

      workers.map(w => w.redis.quit())
    })

    it('should retry a failed job', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      await m.push('my:queue', 0)
      await m.push('my:queue', 1)

      let expecting = [0, 0]
      let count = 0
      let handlerErrorCount = 0

      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
        if (expecting[job] === 0) {
          expecting[job]++
          throw new Error('This job fails')
        }
      })

      w.on('handler-error', (queue, jobId, err) => {
        handlerErrorCount++
        assert.equal(queue, 'my:queue')
      })

      await w.drain()
      assert.equal(count, 4)
      assert.equal(handlerErrorCount, 2)
      assert.equal(await r.llen('test:queue:my:queue'), 0)
      assert.equal(await r.llen('test:active:my:queue'), 0)
    })

    it('should retry a failed job 3 times', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      const jobId = await m.push('my:queue', 0)

      let count = 0
      let handlerErrorCount = 0
      let retryErrorCount = 0

      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
        throw new Error('This job fails')
      })

      w.on('handler-error', (queue, jobId, err) => {
        handlerErrorCount++
        assert.equal(queue, 'my:queue')
      })

      w.on('retry-limit', (queue, jobId, job) => {
        retryErrorCount++
        assert.equal(queue, 'my:queue')
      })

      await w.drain()
      assert.equal(count, 3)
      assert.equal(handlerErrorCount, 3)
      assert.equal(retryErrorCount, 1)
      assert.equal(await r.llen('test:queue:my:queue'), 0)
      assert.equal(await r.llen('test:active:my:queue'), 0)
      assert.deepEqual(await r.hgetall(`test:job:${jobId}`), {})
    })

    it('should retry timeout jobs', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      await m.push('my:queue', 0)

      // Simulate taking it off the queue
      await r
        .multi()
        .rpoplpush('test:queue:my:queue', 'test:active:my:queue')
        .set('test:active:my:queue:fetchAt', Date.now() - 31000)
        .exec()

      let count = 0
      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
      })

      await w.drain()
      assert.equal(count, 1)
    })

    it('should retry timeout jobs when no fetchAt', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      await m.push('my:queue', 0)

      // Simulate taking it off the queue, but not writing fetchAt
      // This really cannot happen because of multi
      await r
        .multi()
        .rpoplpush('test:queue:my:queue', 'test:active:my:queue')
        .exec()

      let count = 0
      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
      })

      await w.drain()
      assert.equal(count, 1)
    })

    it('should emit no active queues', async () => {
      let count = 0
      let noActiveQueuesCount = 0

      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
      })

      w.on('no-active-queues', () => {
        noActiveQueuesCount++
      })

      await w.drain()
      assert.equal(noActiveQueuesCount, 1)
      assert.equal(count, 0)
    })

    it('should clear empty queues from active list', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      await m.push('my:queue', 0)

      let count = 0

      const w = queues.createWorker({ namespace: 'test', redis: r, checkEmptyIterations: 1 }, async (queue, job) => {
        count++
      })

      await w.drain()
      assert.equal(count, 1)
      assert.equal(await r.scard('test:active'), 0)
    })

    it('should emit an error when job data is missing', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      const jobId = await m.push('my:queue', 0)

      await r.del(`test:job:${jobId}`)

      let count = 0
      let errorCount = 0

      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
      })

      w.on('deleted-error', (queue, errJobId) => {
        errorCount++
        assert.equal(queue, 'my:queue')
        assert.equal(errJobId, jobId)
      })

      await w.drain()
      assert.equal(count, 0)
      assert.equal(errorCount, 1)
    })

    it('should not delete the job when deleting is disabled', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      const jobId = await m.push('my:queue', 'data')

      let count = 0

      const w = queues.createWorker({ namespace: 'test', redis: r, deleteJobs: false }, async (queue, job) => {
        count++
      })

      await w.drain()
      assert.equal(count, 1)
      assert.equal(await r.llen('test:queue:my:queue'), 0)
      assert.equal(await r.llen('test:active:my:queue'), 0)
      assert.equal(await r.llen('test:finish:my:queue'), 1)
      assert.ok(await r.hget(`test:job:${jobId}`, 'finishAt'))
    })
  })

  describe('#stop()', () => {
    it('should stop dequeuing jobs', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      await m.push('my:queue', 0)
      await m.push('my:queue', 1)

      let count = 0

      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
        if (count === 1) {
          w.stop()
        }
      })

      await w.listen()
      assert.equal(count, 1)
    })
  })
})
