const http = require('http')
const queues = require('../index')

const m = queues.createManager('example')

const server = http.createServer((req, res) => {
  let body = []
  req
    .on('data', (chunk) => {
      body.push(chunk)
    })
    .on('end', () => {
      body = Buffer.concat(body).toString()
      m.push(req.url, req.body)
      res.end()
    })
})
server.listen(8000)
