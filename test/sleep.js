/* eslint-env mocha */
const assert = require('assert').strict
const sleep = require('../lib/sleep')

describe('sleep(timeout)', () => {
  it('should resolve after timeout', async () => {
    let b = Date.now()
    await sleep(100)
    let a = Date.now()

    // Its a big unpredictable, so smaller check
    assert.ok(a - b > 50)
  })

  it('should not reject', () => {
    assert.doesNotReject(() => {
      return sleep(1)
    })
  })
})
