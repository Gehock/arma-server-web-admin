var express = require('express')
var bodyParser = require('body-parser')
var morgan = require('morgan')
var path = require('path')
var serveStatic = require('serve-static')

var config = require('./config')
var setupBasicAuth = require('./lib/setup-basic-auth')
var Manager = require('./lib/manager')
var Missions = require('./lib/missions')
var SteamMods = require('./lib/steam_mods')
var Logs = require('./lib/logs')

var app = express()
var server = require('http').Server(app)
var io = require('socket.io')(server)

setupBasicAuth(config, app)

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

morgan.token('user', function (req) { return req.auth ? req.auth.user : 'anon' })
app.use(morgan(config.logFormat || 'dev'))

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
