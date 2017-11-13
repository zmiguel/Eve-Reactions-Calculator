var express = require('express');
var mongo = require('mongodb');
var request = require('request');
var async = require('async');
var router = express.Router();

var svurl = "mongodb://localhost:27017/eve-reactor";

function getCostIndex(id) {
    var esiIndyUrl = "https://esi.tech.ccp.is/latest/industry/systems/?datasource=tranquility"
    request(esiIndyUrl, function(err, res, body) {
        let data = JSON.parse(body);
        for (let i = 0; i < data.length; i++) {
            if (data[i].solar_system_id === id) {
                for (var ii = 0; ii < 6; ii++) {
                    if (data[i].cost_indices[ii].activity === "reaction") {
                        return data[i].cost_indices[ii].cost_index;
                    }
                }
            }
        }
    });
}

/* GET comp page. */
router.get('/', function(req, res, next) {
    //vars
    let lvid = 30000891;
    let costIndex = getCostIndex(lvid);
    let querry = ['items', 'bps'];

    async.map(querry, function(coll, callback) {
        mongo.connect(svurl, function(err, db) {
            if (err) {
                console.log(err);
            } else {
                db.collection(coll).find().toArray(function(err, res) {
                    callback(null, res);
                    db.close();
                });
            }
        });
    }, function(err, results) {
        let itemData = results[0];
        let bpsData = results[1];

        let calc = { //TODO
            "name": "Nanotransistors",
            "inputPrice": itemData.find(itemData._id === 16661)
        }

        res.render('comp', { title: 'Composite Reactions', comp: true, data: itemData });
    });
});

module.exports = router;