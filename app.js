var express = require('express')
var bodyParser = require('body-parser')
var bunyanMiddleware = require('bunyan-middleware')
var path = require('path')
var serveStatic = require('serve-static')

var config = require('./config')
var log = require('./lib/logger')
var setupBasicAuth = require('./lib/setup-basic-auth')
var Manager = require('./lib/manager')
var Missions = require('./lib/missions')
var Logs = require('./lib/server-log-paths')
var SteamMods = require('./lib/steam_mods')

var app = express()
var server = require('http').Server(app)
var io = require('socket.io')(server)

setupBasicAuth(config, app)

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

app.use(bunyanMiddleware({
  logger: log.getLogger('http'),
  filter: function (req) {
    return req.path.indexOf('/api/') !== 0
  },
  additionalRequestFinishData: function (req, res) {
    return {user: req.auth ? req.auth.user : 'anon'}
  },
  excludeHeaders: [
    'accept', 'accept-language', 'accept-encoding', 'cookie', 'connection',
    'host', 'if-none-match', 'referer', 'user-agent', 'x-requested-with'
  ],
}))

app.use(serveStatic(path.join(__dirname, 'public')))

var logs = new Logs(config)

var missions = new Missions(config)
var mods = new SteamMods(config)
mods.updateMods()

var manager = new Manager(config, logs, mods)
manager.load()

app.use('/api/logs', require('./routes/logs')(logs))
app.use('/api/missions', require('./routes/missions')(missions))
app.use('/api/mods', require('./routes/mods')(mods))
app.use('/api/servers', require('./routes/servers')(manager, mods))
app.use('/api/settings', require('./routes/settings')(config))

io.on('connection', function (socket) {
  socket.emit('mods', mods.mods)
  socket.emit('servers', manager.getServers())
})

mods.on('mods', function (mods) {
  io.emit('mods', mods)
})

manager.on('servers', function () {
  io.emit('servers', manager.getServers())
})

server.listen(config.port, config.host)
