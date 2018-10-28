/* eslint-env mocha */
const assert = require('assert').strict
const limiter = require('../lib/limiter')
const sleep = require('../lib/sleep')

describe('Limiter', () => {
  it('should execute in order when concurrency=1', async () => {
    let limit = limiter.createLimiter(1)

    let resultCount = 0

    limit.on('result', () => {
      resultCount++
    })

    let order = 0
    let fn = (i) => async () => {
      await sleep(Math.random() * 100)
      assert.equal(order++, i)

      return i
    }

    for (let i = 0; i < 10; i++) {
      let j = await limit.push(fn(i))
      assert.equal(i, j)
    }
    await limit.drain()
    assert.equal(order, 10)
    assert.equal(resultCount, 10)
  })

  it('should execute all jobs', async () => {
    let limit = limiter.createLimiter(10)

    let resultCount = 0

    limit.on('result', () => {
      resultCount++
    })

    let count = 0
    let allSet = false
    let fn = (i) => async () => {
      await sleep(100)
      assert.equal(allSet, true)
      count++
    }

    for (let i = 0; i < 9; i++) {
      await limit.push(fn(i))
    }
    allSet = true
    await limit.drain()
    assert.equal(count, 9)
    assert.equal(resultCount, 9)
  })

  it('should execute all jobs that throw errors', async () => {
    let limit = limiter.createLimiter(10)

    let resultCount = 0
    let errorCount = 0

    limit.on('result', () => {
      resultCount++
    })

    limit.on('error', () => {
      errorCount++
    })

    let count = 0
    let allSet = false
    let fn = (i) => async () => {
      await sleep(Math.random() * 100)
      assert.equal(allSet, true)
      count++

      throw new Error()
    }

    for (let i = 0; i < 9; i++) {
      await limit.push(fn(i))
    }
    allSet = true
    await limit.drain()
    assert.equal(count, 9)
    assert.equal(resultCount, 0)
    assert.equal(errorCount, 9)
  })

  it('should execute all jobs only 2 at a time', async () => {
    let limit = limiter.createLimiter(2)

    let resultCount = 0

    limit.on('result', () => {
      resultCount++
    })

    let count = 0
    let active = 0
    let fn = (i) => async () => {
      active++
      await sleep(Math.random() * 100)
      active--
      assert.ok(active <= 2)
      count++
    }

    for (let i = 0; i < 10; i++) {
      await limit.push(fn(i))
    }

    await limit.drain()
    assert.equal(active, 0)
    assert.equal(count, 10)
    assert.equal(resultCount, 10)
  })

  it('should execute all jobs only 20 at a time', async () => {
    let limit = limiter.createLimiter(20)

    let resultCount = 0

    limit.on('result', () => {
      resultCount++
    })

    let count = 0
    let active = 0
    let fn = (i) => async () => {
      active++
      await sleep(Math.random() * 100)
      active--
      assert.ok(active <= 20)
      count++
    }

    for (let i = 0; i < 100; i++) {
      await limit.push(fn(i))
    }

    await limit.drain()
    assert.equal(active, 0)
    assert.equal(count, 100)
    assert.equal(resultCount, 100)
  })
})
