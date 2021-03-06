var express = require('express')
var multer = require('multer')
var upload = multer({ storage: multer.diskStorage({}) })
var async = require('async')

module.exports = function (missionsManager) {
  var router = express.Router()

  router.get('/', function (req, res) {
    missionsManager.list(function (err, missions) {
      if (err) {
        res.status(500).send(err)
      } else {
        res.json(missions)
      }
    })
  })

  router.post('/', upload.array('mission', 64), function (req, res) {
    async.parallelLimit(
      req.files.map(function (missionFile) {
        return function (next) {
          missionsManager.handleUpload(missionFile, next)
        }
      }),
      8,
      function (err) {
        if (err) {
          res.status(500).send(err)
        } else {
          res.status(200).json({success: true})
        }
      }
    )
  })

  router.get('/:mission', function (req, res) {
    var filename = req.params.mission

    res.download(missionsManager.missionPath(filename), decodeURI(filename))
  })

  router.delete('/:mission', function (req, res) {
    var filename = req.params.mission

    missionsManager.delete(filename, function (err) {
      if (err) {
        res.status(500).send(err)
      } else {
        res.json({success: true})
      }
    })
  })

  router.post('/workshop', function (req, res) {
    var id = req.body.id

    missionsManager.downloadSteamWorkshop(id, function (err, files) {
      if (err) {
        res.status(500).send(err)
      } else {
        res.json({success: true})
      }
    })
  })

  return router
}
