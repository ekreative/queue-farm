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

  describe('#put(queue, job)', () => {
    it('should put the job in redis list', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      let jobId = await m.push('my:queue', { some: 'data' })
      assert.equal(1, await r.llen('test:queue:my:queue'))
      assert.equal(jobId, await r.lindex('test:queue:my:queue', 0))
      assert.equal('{"some":"data"}', await r.hget(`test:job:${jobId}`, 'data'))
      assert.deepEqual(await r.smembers('test:active'), ['my:queue'])
    })
  })

  describe('#del(queue, job)', () => {
    it('should delete the job', async () => {
      const m = queues.createManager({ namespace: 'test', redis: r })
      let jobId = await m.push('my:queue', { some: 'data' })
      await m.del('my:queue', jobId)
      assert.equal(0, await r.llen('test:queue:my:queue'))
      assert.deepEqual({}, await r.hgetall(`test:job:${jobId}`))
      assert.deepEqual(await r.smembers('test:active'), ['my:queue'])
    })
  })
})
