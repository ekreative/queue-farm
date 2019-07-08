/* eslint-env mocha */
const assert = require('assert').strict
const EventEmitter = require('events')
const logger = require('../lib/logger')

describe('Logger', () => {
  it('should listen to all events', () => {
    let onCount = 0
    const manager = {
      on (event, handler) {
        onCount++
      }
    }
    const log = logger.createLogger(manager, {})
    log.on()

    assert.equal(onCount, 8)
  })

  it('should stop listening to all events', () => {
    let onCount = 0
    const manager = {
      off (event, handler) {
        onCount++
      }
    }
    const log = logger.createLogger(manager, {})
    log.off()

    assert.equal(onCount, 8)
  })

  it('should log push events', () => {
    let pushCount = 0
    const manager = new EventEmitter()
    manager.namespace = 'namespace'
    manager.id = 'managerId'
    const queue = 'queue'
    const jobId = 'job id'
    const job = { some: 'job' }
    const options = {}

    const log = logger.createLogger(manager, {
      info (msg, meta) {
        pushCount++
        assert.equal(msg, 'Job pushed')
        assert.deepEqual(meta, { jobId, options, queue, namespace: 'namespace', id: 'managerId' })
      }
    })
    log.on()
    manager.emit('push', queue, jobId, job, options)

    assert.equal(pushCount, 1)
  })

  it('should log push events with job', () => {
    let pushCount = 0
    const manager = new EventEmitter()
    manager.namespace = 'namespace'
    manager.id = 'managerId'
    const queue = 'queue'
    const jobId = 'job id'
    const job = { some: 'job' }
    const options = {}

    const log = logger.createLogger(manager, {
      info (msg, meta) {
        pushCount++
        assert.equal(msg, 'Job pushed')
        assert.deepEqual(meta, { job, jobId, options, queue, namespace: 'namespace', id: 'managerId' })
      }
    }, {
      includeJobs: true
    })
    log.on()
    manager.emit('push', queue, jobId, job, options)

    assert.equal(pushCount, 1)
  })

  it('should log start events with jobs', () => {
    let pushCount = 0
    const manager = new EventEmitter()
    manager.namespace = 'namespace'
    manager.id = 'workerId'
    const queue = 'queue'
    const jobIds = ['job id', 'job id 2']
    const jobs = [{ some: 'job' }, { some: 'other job' }]

    const log = logger.createLogger(manager, {
      info (msg, meta) {
        pushCount++
        assert.equal(msg, 'Jobs started')
        assert.deepEqual(meta, { jobs, jobIds, queue, namespace: 'namespace', id: 'workerId' })
      }
    }, {
      includeJobs: true
    })
    log.on()
    manager.emit('start', queue, jobIds, jobs)

    assert.equal(pushCount, 1)
  })
})
