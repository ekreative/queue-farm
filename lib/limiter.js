const assert = require('assert').strict
const EventEmitter = require('events')

class Limiter extends EventEmitter {
  constructor (concurrent) {
    super()
    assert.ok(concurrent > 0)
    this.concurrent = concurrent
    this.active = 0
    this.waiting = []
    this.queue = []
  }

  push (fn) {
    const wait = new Promise(resolve => {
      this.queue.push([fn, resolve])
      if (this.dequeue()) {
        resolve()
      }
    })
    return wait
  }

  dequeue () {
    if (this.active >= this.concurrent) {
      return false
    }
    if (this.queue.length < 1) {
      return false
    }
    this.active++
    const [fn, resolve] = this.queue.shift()
    fn()
      .then(result => {
        this.emit('result', result)

        return result
      })
      .catch(err => {
        this.emit('error', err)
      })
      .then(result => {
        this.active--
        resolve(result)
        this.dequeue()
        if (this.active === 0) {
          this.emit('empty')
        }
      })

    return this.active < this.concurrent
  }

  drain () {
    return new Promise(resolve => {
      if (this.active === 0) {
        resolve()
      } else {
        this.once('empty', resolve)
      }
    })
  }
}

module.exports.Limiter = Limiter
module.exports.createLimiter = concurrent => new Limiter(concurrent)
