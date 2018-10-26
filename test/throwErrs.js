/* eslint-env mocha */
const assert = require('assert').strict
const throwErrs = require('../lib/throwErrs')

describe('throwsErrs(...err)', () => {
  it('should throw if any of err is not null', () => {
    assert.throws(() => {
      throwErrs(new Error())
    })
  })

  it('should throw if any of is not first', () => {
    assert.throws(() => {
      throwErrs(null, null, new Error())
    })
  })

  it('should not throw no errs', () => {
    assert.doesNotThrow(() => {
      throwErrs(null, null)
    })
  })
})
