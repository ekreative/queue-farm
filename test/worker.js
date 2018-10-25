/* eslint-env mocha */
const assert = require('assert').strict
const Redis = require('ioredis')
const queues = require('../index')

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

      const w = queues.createWorker({ namespace: 'test', redis: r }, async (queue, job) => {
        count++
        assert.equal('my:queue', queue)
        assert.equal('data', job)
      })

      w.on('start', (queue, eventJobId) => {
        startCount++
        assert.equal(jobId, eventJobId)
        assert.equal('my:queue', queue)
      })

      w.on('finish', (queue, eventJobId) => {
        finishCount++
        assert.equal(jobId, eventJobId)
        assert.equal('my:queue', queue)
      })

      await w.drain()
      assert.equal(1, count)
      assert.equal(1, startCount)
      assert.equal(1, finishCount)
      assert.equal(0, await r.llen('test:queue:my:queue'))
      assert.equal(0, await r.llen('test:active:my:queue'))
      assert.deepEqual({}, await r.hgetall(`test:job:${jobId}`))
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
        assert.equal(expecting[queue].job, job)
        expecting[queue].count++
      })
      await w.drain()
      assert.equal(2, count)
      assert.equal(1, expecting['my:queue'].count)
      assert.equal(1, expecting['another:queue'].count)
      assert.equal(0, await r.llen('test:queue:my:queue'))
      assert.equal(0, await r.llen('test:queue:another:queue'))
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
        if (expecting[queue] === null) {
          assert.fail('Unexpected queue')
        }
        assert.equal(expecting[queue], job)
        expecting[queue]++
      })
      await w.drain()
      assert.equal(4, count)
      assert.equal(2, expecting['my:queue'])
      assert.equal(2, expecting['another:queue'])
      assert.equal(0, await r.llen('test:queue:my:queue'))
      assert.equal(0, await r.llen('test:queue:another:queue'))
    })

    it('should emit the jobs in order to multiple workers', async function () {
      this.timeout(5000)

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
        if (expecting[queue] === null) {
          assert.fail('Unexpected queue')
        }
        assert.equal(expecting[queue], job)
        expecting[queue]++
      }

      let workers = []
      for (let i = 0; i < 10; i++) {
        const w = queues.createWorker({ namespace: 'test' }, handler)
        workers.push(w)
      }
      await Promise.all(workers.map(w => w.drain()))

      assert.equal(1000, count)
      for (let i = 0; i < 10; i++) {
        assert.equal(100, expecting[`q:${i}`])
        assert.equal(0, await r.llen(`test:queue:q:${i}`))
        assert.equal(0, await r.llen(`test:active:q:${i}`))
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
        assert.equal('my:queue', queue)
      })

      await w.drain()
      assert.equal(4, count)
      assert.equal(2, handlerErrorCount)
      assert.equal(0, await r.llen('test:queue:my:queue'))
      assert.equal(0, await r.llen('test:active:my:queue'))
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
        assert.equal('my:queue', queue)
      })

      w.on('retry-limit', (queue, jobId, job) => {
        retryErrorCount++
        assert.equal('my:queue', queue)
      })

      await w.drain()
      assert.equal(3, count)
      assert.equal(3, handlerErrorCount)
      assert.equal(1, retryErrorCount)
      assert.equal(0, await r.llen('test:queue:my:queue'))
      assert.equal(0, await r.llen('test:active:my:queue'))
      assert.deepEqual({}, await r.hgetall(`test:job:${jobId}`))
    })

    it('should stop', async () => {
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
      assert.equal(1, count)
    })
  })
})
