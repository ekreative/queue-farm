/* eslint-env mocha */
const assert = require('assert').strict
const Redis = require('ioredis')
const queues = require('../index')

describe('Manager', () => {
  let r

  beforeEach(async () => {
    r = new Redis()
    await r.flushall()
  })

  afterEach(async () => {
    await r.quit()
  })

  describe('#constructor', () => {
    it('should set the defaults', () => {
      const obj = queues.createManager({ redis: r })
      assert.equal(obj.namespace, 'queue-farm')
      assert.equal(obj.maxAttempts, 3)
      assert.equal(obj.timeout, 30000)
      assert.equal(obj.noActiveQueuesSleep, 30000)
      assert.equal(obj.allEmptySleep, 1000)
      assert.equal(obj.checkEmptyIterations, 50)
      assert.equal(obj.deleteJobs, true)
      assert.ok(obj.redis instanceof Redis)
    })

    it('should set the values', () => {
      const obj = queues.createManager({
        namespace: 'test',
        maxAttempts: 1,
        timeout: 2,
        noActiveQueuesSleep: 3,
        allEmptySleep: 4,
        checkEmptyIterations: 5,
        deleteJobs: false,
        redis: r
      })
      assert.equal(obj.namespace, 'test')
      assert.equal(obj.maxAttempts, 1)
      assert.equal(obj.timeout, 2)
      assert.equal(obj.noActiveQueuesSleep, 3)
      assert.equal(obj.allEmptySleep, 4)
      assert.equal(obj.checkEmptyIterations, 5)
      assert.equal(obj.deleteJobs, false)
      assert.equal(obj.redis, r)
    })
  })

  describe('#put(queue, job)', () => {
    it('should put the job in redis list', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      let jobId = await m.push('my:queue', { some: 'data' })
      assert.equal(await r.llen('test:queue:my:queue'), 1)
      assert.equal(await r.lindex('test:queue:my:queue', 0), jobId)
      assert.equal(await r.hget(`test:job:${jobId}`, 'data'), '{"some":"data"}')
      assert.deepEqual(await r.smembers('test:active'), ['my:queue'])
    })

    it('should set the job options', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      let jobId = await m.push('my:queue', { some: 'data' }, { maxAttempts: 1, timeout: 10000 })
      assert.equal(await r.hget(`test:job:${jobId}`, 'data'), '{"some":"data"}')
      assert.equal(await r.hget(`test:job:${jobId}`, 'maxAttempts'), '1')
      assert.equal(await r.hget(`test:job:${jobId}`, 'timeout'), '10000')
    })

    it('should set the job default options', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      let jobId = await m.push('my:queue', { some: 'data' })
      assert.equal(await r.hget(`test:job:${jobId}`, 'data'), '{"some":"data"}')
      assert.equal(await r.hget(`test:job:${jobId}`, 'maxAttempts'), '3')
      assert.equal(await r.hget(`test:job:${jobId}`, 'timeout'), '30000')
    })
  })

  describe('#del(queue, job)', () => {
    it('should delete the job', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      const jobId = await m.push('my:queue', { some: 'data' })
      const result = await m.del('my:queue', jobId)
      assert.equal(await r.llen('test:queue:my:queue'), 0)
      assert.deepEqual(await r.hgetall(`test:job:${jobId}`), {})
      assert.equal(result, true)
    })

    it('should delete the only job', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      await m.push('my:queue', { some: 'data' })
      const jobId = await m.push('my:queue', { some: 'more-data' })
      const result = await m.del('my:queue', jobId)
      assert.equal(await r.llen('test:queue:my:queue'), 1)
      assert.deepEqual(await r.hgetall(`test:job:${jobId}`), {})
      assert.equal(result, true)
    })

    it('should return false when job doesn\'t exist', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      const jobId = await m.push('my:queue', { some: 'data' })
      const result = await m.del('my:queue', 'another id')
      assert.equal(await r.llen('test:queue:my:queue'), 1)
      assert.notDeepEqual(await r.hgetall(`test:job:${jobId}`), {})
      assert.equal(result, false)
    })

    it('should not delete the job when deleting is disabled', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r, deleteJobs: false })
      const jobId = await m.push('my:queue', { some: 'data' })
      const result = await m.del('my:queue', jobId)
      assert.equal(await r.llen('test:queue:my:queue'), 0)
      assert.ok(await r.hget(`test:job:${jobId}`, 'deleteAt'))
      assert.equal(result, true)
    })
  })
})
