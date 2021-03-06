var _ = require('lodash')
var events = require('events')
var fs = require('fs')
var Gamedig = require('gamedig')
var slugify = require('slugify')
var logger = require('./logger').getLogger('server')
var logWriter = require('./server-log-writer')

var ArmaServer = require('arma-server')

var config = require('../config.js')

var queryInterval = 5000
var queryTypes = {
  arma1: 'arma',
  arma2: 'arma2',
  arma2oa: 'arma2',
  arma3: 'arma3',
  arma3_x64: 'arma3',
  cwa: 'operationflashpoint',
  ofp: 'operationflashpoint',
  ofpresistance: 'operationflashpoint'
}

var createServerTitle = function (title) {
  if (config.prefix) {
    title = config.prefix + title
  }

  if (config.suffix) {
    title = title + config.suffix
  }

  return title
}

var Server = function (config, logsManager, modsManager, options) {
  this.config = config
  this.logsManager = logsManager
  this.modsManager = modsManager
  this.update(options)
  this.headlessClientInstances = [];
}

Server.prototype = new events.EventEmitter()

Server.prototype.generateId = function () {
  return slugify(this.title).replace(/\./g, '-')
}

Server.prototype.update = function (options) {
  this.admin_password = options.admin_password
  this.auto_start = options.auto_start
  this.battle_eye = options.battle_eye
  this.forcedDifficulty = options.forcedDifficulty || null
  this.max_players = options.max_players
  this.missions = options.missions
  this.mods = options.mods || []
  this.motd = options.motd || null
  this.number_of_headless_clients = options.number_of_headless_clients || 0
  this.password = options.password
  this.parameters = options.parameters
  this.persistent = options.persistent
  this.port = options.port || 2302
  this.title = options.title
  this.von = options.von
  this.verify_signatures = options.verify_signatures

  this.id = this.generateId()
  this.port = parseInt(this.port, 10) // If port is a string then gamedig fails
}

Server.prototype.queryStatus = function () {
  if (!this.instance) {
    return
  }

  var self = this
  Gamedig.query(
    {
      type: queryTypes[config.game],
      host: '127.0.0.1',
      port: self.port
    },
    function (state) {
      if (!self.instance) {
        return
      }

      if (state.error) {
        self.state = null
      } else {
        self.state = state
      }

      self.emit('state')
    }
  )
}

Server.prototype.getMods = function () {
  var self = this
  return this.mods.map(function (mod) {
    return self.modsManager.find(mod)
  }).filter(function (mod) {
    return mod
  }).map(function (mod) {
    return mod.path
  })
}

Server.prototype.getParameters = function () {
  var parameters = []

  if (config.parameters && Array.isArray(config.parameters)) {
    parameters = parameters.concat(config.parameters)
  }

  if (this.parameters && Array.isArray(this.parameters)) {
    parameters = parameters.concat(this.parameters)
  }

  return parameters
}

Server.prototype.start = function () {
  var mods = this.getMods()
  var parameters = this.getParameters()
  var server = new ArmaServer.Server({
    admins: config.admins,
    battleEye: this.battle_eye ? 1 : 0,
    config: this.id,
    disableVoN: this.von ? 0 : 1,
    game: config.game,
    forcedDifficulty: this.forcedDifficulty || null,
    headlessClients: this.number_of_headless_clients > 0 ? ['127.0.0.1'] : null,
    hostname: createServerTitle(this.title),
    localClient: this.number_of_headless_clients > 0 ? ['127.0.0.1'] : null,
    missions: this.missions,
    mods: mods,
    motd: (this.motd && this.motd.split('\n')) || null,
    parameters: parameters,
    password: this.password,
    passwordAdmin: this.admin_password,
    path: this.config.path,
    persistent: this.persistent ? 1 : 0,
    platform: this.config.type,
    players: this.max_players,
    port: this.port,
    serverMods: config.serverMods,
    verifySignatures: this.verify_signatures ? 2 : 0
  })
  server.writeServerConfig()
  var instance = server.start()
  var self = this

  var logStream = null
  if (this.config.type === 'linux') {
    logStream = fs.createWriteStream(this.logsManager.generateLogFilePath(), {
      'flags': 'a'
    })
  }

  var self = this

  instance.on('close', function (code) {

    clearInterval(self.queryStatusInterval)
    self.state = null
    self.pid = null
    self.instance = null

    self.stopHeadlessClients()

    self.emit('state')
  })

  instance.on('error', function (err) {
    logger.error(err)
  })

  this.pid = instance.pid
  this.instance = instance
  this.queryStatusInterval = setInterval(function () {
    self.queryStatus()
  }, queryInterval)

  this.startHeadlessClients()

  if (this.config.type === 'linux') {
    logWriter.setupFileLog(self)
  }

  this.emit('state')

  return this
}

Server.prototype.startHeadlessClients = function () {
  var mods = this.getMods()
  var parameters = this.getParameters()
  var self = this
  var headlessClientInstances = _.times(this.number_of_headless_clients, function (i) {
    var headless = new ArmaServer.Headless({
      game: config.game,
      host: '127.0.0.1',
      mods: mods,
      parameters: parameters,
      password: self.password,
      path: self.config.path,
      platform: self.config.type,
      port: self.port
    })
    var headlessInstance = headless.start()
    var name = 'HC_' + i
    var logPrefix = self.id + ' ' + name
    logger.info(logPrefix + ' starting')

    headlessInstance.on('close', function (code) {
      logger.info(logPrefix + ' exited: ' + code)

      var elementIndex = headlessClientInstances.indexOf(headlessInstance)
      if (elementIndex !== -1) {
        headlessClientInstances.splice(elementIndex, 1)
      }
    })

    headlessInstance.on('error', function (err) {
      logger.error(logPrefix + ' error: ' + err)
    })

    return headlessInstance
  })

  this.headlessClientInstances = headlessClientInstances
}

Server.prototype.stop = function (cb) {
  var handled = false

  this.instance.on('close', function (code) {
    if (!handled) {
      handled = true

      if (cb) {
        cb()
      }
    }
  })

  this.instance.kill()

  setTimeout(function () {
    if (!handled) {
      handled = true

      if (cb) {
        cb()
      }
    }
  }, 5000)

  return this
}

Server.prototype.stopHeadlessClients = function () {
  this.headlessClientInstances.map(function (headlessClientInstance) {
    headlessClientInstance.kill()
  })
  this.headlessClientInstances = [];
}

Server.prototype.toJSON = function () {
  return {
    admin_password: this.admin_password,
    auto_start: this.auto_start,
    battle_eye: this.battle_eye,
    id: this.id,
    forcedDifficulty: this.forcedDifficulty,
    max_players: this.max_players,
    missions: this.missions,
    motd: this.motd,
    mods: this.mods,
    number_of_headless_clients: this.number_of_headless_clients,
    parameters: this.parameters,
    password: this.password,
    persistent: this.persistent,
    pid: this.pid,
    port: this.port,
    state: this.state,
    title: this.title,
    von: this.von,
    verify_signatures: this.verify_signatures
  }
}

module.exports = Server
