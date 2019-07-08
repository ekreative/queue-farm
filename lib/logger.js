class Logger {
  constructor (manager, logger, options) {
    this.manager = manager
    this.logger = logger
    handleOptions.call(this, options)
    this.events = events
      .filter(([name]) => this.exceptEvents.indexOf(name) === -1)
      .map(([name, ...args]) => [name, createHandler.call(this, ...args)])
  }

  on () {
    for (let [name, handler] of this.events) {
      this.manager.on(name, handler)
    }
  }

  off () {
    for (let [name, handler] of this.events) {
      this.manager.off(name, handler)
    }
  }
}

function handleOptions (options = {}) {
  this.includeJobs = options.includeJobs || false
  this.exceptEvents = options.exceptEvents || ['all-empty', 'no-active-queues']
}

function createHandler (msg, level, argsSplit = () => []) {
  const logger = this
  return function (...args) {
    const manager = this
    const [meta = {}, extended = {}] = argsSplit.call(manager, ...args)
    meta.namespace = manager.namespace
    meta.id = manager.id
    if (logger.includeJobs) {
      Object.assign(meta, extended)
    }
    logger.logger[level](msg, meta)
  }
}

const events = [
  ['push', 'Job pushed', 'info', (queue, jobId, job, options) => [{ queue, jobId, options }, { job }]],
  ['delete', 'Job deleted', 'debug', (queue, jobId, success) => [{ queue, jobId, success }]],
  ['start', 'Jobs started', 'info', (queue, jobIds, jobs) => [{ queue, jobIds }, { jobs }]],
  ['finish', 'Jobs finished', 'info', (queue, jobIds, jobs) => [{ queue, jobIds }, { jobs }]],
  ['handler-error', 'Jobs error', 'error', (queue, jobIds, error, jobs) => [{ queue, jobIds, error }, { jobs }]],
  ['deleted-error', 'Jobs error', 'debug', (queue, jobIds, error) => [{ queue, jobIds, error }]],
  ['retry-limit', 'Jobs retry limit', 'warn', (queue, jobIds, datas, error) => [{ queue, jobIds, error }, { datas }]],
  ['invalid-data', 'Jobs data invalid', 'warn', (queue, jobIds, datas, error) => [{ queue, jobIds, error }, { datas }]],
  ['all-empty', 'All queues empty', 'debug', function () { return [{ allEmptySleep: this.allEmptySleep }] }],
  ['no-active-queues', 'No active queues', 'debug', function () { return [{ noActiveQueuesSleep: this.noActiveQueuesSleep }] }]
]

module.exports.Logger = Logger
module.exports.createLogger = (manager, logger, options) => new Logger(manager, logger, options)
