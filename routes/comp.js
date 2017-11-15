var express = require('express');
var mongo = require('mongodb');
var request = require('request');
var async = require('async');
var numeral = require('numeral');
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

function getItem(data, id) {
    for (let i = 0; i < data.length; i++) {
        if (data[i]._id === id) {
            return data[i];
        }
    }
}

/* GET comp page. */
router.get('/', function(req, res, next) {
    //querry opts
    let opt = req.query;
    console.log("opt:", opt);
    if (opt.i) { var imeth = opt.i; }
    if (opt.o) { var ometh = opt.o; }
    if (opt.s) { var skill = parseInt(opt.s); }
    if (opt.f) { var facility = opt.f; }
    if (opt.r) { var rig = parseInt(opt.r); var rige = true; }
    if (opt.space) { var space = opt.space; }
    var matb = 1;
    var time = 180;
    var bonus = {};

    //calc bonus with opts
    //default is Skill (Reactions) 5, Large facility & T1 rig in NullSec
    if (skill && facility && rige && space) { // S F R SPACE
        //calc material bonus
        if (rig === 1 && space === "null") {
            matb = 1 - (2 * 1.1) / 100
        } else if (rig === 1 && space === "low") {
            matb = 1 - 2 / 100
        } else if (rig === 2 && space === "null") {
            matb = 1 - (2.4 * 1.1) / 100
        } else if (rig === 2 && space === "low") {
            matb = 1 - 2.4 / 100
        } else {
            matb = 1;
        }
        //calc time bonus
        let time = 180 * (1 - (4 * skill) / 100); //skill bonus
        //facility bonus
        if (facility === "med") {
            time = time * (1 - 0)
        } else if (facility === "large") {
            time = time * (1 - (25 / 100))
        }
        //rig bonus
        if (rig === 1 && space === "null") {
            time = time * (1 - (20 * 1.1 / 100))
        } else if (rig === 1 && space === "low") {
            time = time * (1 - (20 / 100))
        } else if (rig === 2 && space === "null") {
            time = time * (1 - (24 * 1.1 / 100))
        } else if (rig === 2 && space === "low") {
            time = time * (1 - (24 / 100))
        } else {
            time = time
        }
        //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (skill && facility && rige) { // S F R
        //calc material bonus
        if (rig === 1) {
            matb = 1 - (2 * 1.1) / 100
        } else if (rig === 2) {
            matb = 1 - (2.4 * 1.1) / 100
        } else {
            matb = 1;
        }
        //calc time bonus
        let time = 180 * (1 - (4 * skill) / 100); //skill bonus
        //facility bonus
        if (facility === "med") {
            time = time * (1 - 0)
        } else if (facility === "large") {
            time = time * (1 - (25 / 100))
        }
        //rig bonus
        if (rig === 1) {
            time = time * (1 - (20 * 1.1 / 100))
        } else if (rig === 2) {
            time = time * (1 - (24 * 1.1 / 100))
        } else {
            time = time
        }
        //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (skill && facility && !rige) { // S F
        //calc material bonus
        matb = 1 - (2 * 1.1) / 100
            //calc time bonus
            //skill bonus
        let time = 180 * (1 - (4 * skill) / 100);
        //facility bonus
        if (facility === "med") {
            time = time * (1 - 0)
        } else if (facility === "large") {
            time = time * (1 - (25 / 100))
        }
        //rig bonus
        time = time * (1 - (20 * 1.1 / 100))
            //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (skill && !facility && rige && space) { // S R SPACE
        //calc material bonus
        if (rig === 1 && space === "null") {
            matb = 1 - (2 * 1.1) / 100
        } else if (rig === 1 && space === "low") {
            matb = 1 - 2 / 100
        } else if (rig === 2 && space === "null") {
            matb = 1 - (2.4 * 1.1) / 100
        } else if (rig === 2 && space === "low") {
            matb = 1 - 2.4 / 100
        } else {
            matb = 1;
        }
        //calc time bonus
        let time = 180 * (1 - (4 * skill) / 100); //skill bonus
        //facility bonus
        time = time * (1 - (25 / 100))
            //rig bonus
        if (rig === 1 && space === "null") {
            time = time * (1 - (20 * 1.1 / 100))
        } else if (rig === 1 && space === "low") {
            time = time * (1 - (20 / 100))
        } else if (rig === 2 && space === "null") {
            time = time * (1 - (24 * 1.1 / 100))
        } else if (rig === 2 && space === "low") {
            time = time * (1 - (24 / 100))
        } else {
            time = time
        }
        //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (skill && !facility && rige) { // S R
        //calc material bonus
        if (rig === 1) {
            matb = 1 - (2 * 1.1) / 100
        } else if (rig === 2) {
            matb = 1 - (2.4 * 1.1) / 100
        } else {
            matb = 1;
        }
        //calc time bonus
        let time = 180 * (1 - (4 * skill) / 100); //skill bonus
        //facility bonus
        time = time * (1 - (25 / 100))
            //rig bonus
        if (rig === 1) {
            time = time * (1 - (20 * 1.1 / 100))
        } else if (rig === 2) {
            time = time * (1 - (24 * 1.1 / 100))
        } else {
            time = time
        }
        //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (!skill && facility && rige && space) { // F R SPACE
        //calc material bonus
        if (rig === 1 && space === "null") {
            matb = 1 - (2 * 1.1) / 100
        } else if (rig === 1 && space === "low") {
            matb = 1 - 2 / 100
        } else if (rig === 2 && space === "null") {
            matb = 1 - (2.4 * 1.1) / 100
        } else if (rig === 2 && space === "low") {
            matb = 1 - 2.4 / 100
        } else {
            matb = 1;
        }
        //calc time bonus
        let time = 180 * (1 - (4 * 5) / 100); //skill bonus
        //facility bonus
        if (facility === "med") {
            time = time * (1 - 0)
        } else if (facility === "large") {
            time = time * (1 - (25 / 100))
        }
        //rig bonus
        if (rig === 1 && space === "null") {
            time = time * (1 - (20 * 1.1 / 100))
        } else if (rig === 1 && space === "low") {
            time = time * (1 - (20 / 100))
        } else if (rig === 2 && space === "null") {
            time = time * (1 - (24 * 1.1 / 100))
        } else if (rig === 2 && space === "low") {
            time = time * (1 - (24 / 100))
        } else {
            time = time
        }
        //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (!skill && facility && rige) { // F R
        //calc material bonus
        if (rig === 1) {
            matb = 1 - (2 * 1.1) / 100
        } else if (rig === 2) {
            matb = 1 - (2.4 * 1.1) / 100
        } else {
            matb = 1;
        }
        //calc time bonus
        let time = 180 * (1 - (4 * 5) / 100); //skill bonus
        //facility bonus
        if (facility === "med") {
            time = time * (1 - 0)
        } else if (facility === "large") {
            time = time * (1 - (25 / 100))
        }
        //rig bonus
        if (rig === 1) {
            time = time * (1 - (20 * 1.1 / 100))
        } else if (rig === 2) {
            time = time * (1 - (24 * 1.1 / 100))
        } else {
            time = time
        }
        //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (skill && !facility && !rige) { // S
        //calc material bonus
        matb = 1 - (2 * 1.1) / 100
            //calc time bonus
        let time = 180 * (1 - (4 * skill) / 100); //skill bonus
        //facility bonus
        time = time * (1 - (25 / 100))
            //rig bonus
        time = time * (1 - (20 * 1.1 / 100))
            //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (!skill && facility && !rige) { // F
        //calc material bonus
        matb = 1 - (2 * 1.1) / 100
            //calc time bonus
        let time = 180 * (1 - (4 * 5) / 100); //skill bonus
        //facility bonus
        if (facility === "med") {
            time = time * (1 - 0)
        } else if (facility === "large") {
            time = time * (1 - (25 / 100))
        }
        //rig bonus
        time = time * (1 - (20 * 1.1 / 100))
            //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (!skill && !facility && rige && space) { // R SPACE
        //calc material bonus
        if (rig === 1 && space === "null") {
            matb = 1 - (2 * 1.1) / 100
        } else if (rig === 1 && space === "low") {
            matb = 1 - 2 / 100
        } else if (rig === 2 && space === "null") {
            matb = 1 - (2.4 * 1.1) / 100
        } else if (rig === 2 && space === "low") {
            matb = 1 - 2.4 / 100
        } else {
            matb = 1;
        }
        //calc time bonus
        let time = 180 * (1 - (4 * 5) / 100); //skill bonus
        //facility bonus
        time = time * (1 - (25 / 100))
            //rig bonus
        if (rig === 1 && space === "null") {
            time = time * (1 - (20 * 1.1 / 100))
        } else if (rig === 1 && space === "low") {
            time = time * (1 - (20 / 100))
        } else if (rig === 2 && space === "null") {
            time = time * (1 - (24 * 1.1 / 100))
        } else if (rig === 2 && space === "low") {
            time = time * (1 - (24 / 100))
        } else {
            time = time
        }
        //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else if (!skill && !facility && rige) { // R
        //calc material bonus
        if (rig === 1) {
            matb = 1 - (2 * 1.1) / 100
        } else if (rig === 2) {
            matb = 1 - (2.4 * 1.1) / 100
        } else {
            matb = 1;
        }
        //calc time bonus
        let time = 180 * (1 - (4 * 5) / 100); //skill bonus
        //facility bonus
        time = time * (1 - (25 / 100))
            //rig bonus
        if (rig === 1) {
            time = time * (1 - (20 * 1.1 / 100))
        } else if (rig === 2) {
            time = time * (1 - (24 * 1.1 / 100))
        } else {
            time = time
        }
        //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    } else { // None
        //calc material bonus
        matb = 1 - (2 * 1.1) / 100
            //calc time bonus
        let time = 180 * (1 - (4 * 5) / 100); //skill bonus
        //facility bonus
        time = time * (1 - (25 / 100))
            //rig bonus
        time = time * (1 - (20 * 1.1 / 100))
            //final result
        bonus = {
            "mat": matb,
            "time": time
        }
    }
    //var cycles = Math.floor(43200 / bonus.time);
    var cycles = 1;

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

        let calc = [];
        let reac = bpsData[0].reaction;
        //START build new BP array with prices
        for (let i = 0; i < reac.length; i++) {
            let tempin = [];
            for (let inp = 0; inp < reac[i].inputs.length; inp++) {
                let tmpPrc = {
                    "id": reac[i].inputs[inp].id,
                    "buy": getItem(itemData, reac[i].inputs[inp].id).buy * reac[i].inputs[inp].qt * cycles,
                    "sell": getItem(itemData, reac[i].inputs[inp].id).sell * reac[i].inputs[inp].qt * cycles
                }
                tempin.push(tmpPrc);
            }
            let tempout = {
                "id": reac[i].output.id,
                "sell": getItem(itemData, reac[i].output.id).sell * reac[i].output.qt * cycles,
                "buy": getItem(itemData, reac[i].output.id).buy * reac[i].output.qt * cycles
            }
            let ttmp = {
                "id": reac[i].id,
                "name": reac[i].name,
                "chain": "No",
                "inputs": tempin,
                "output": tempout
            }
            calc.push(ttmp);
        }
        //END build new BP array with prices
        //START build array with total input cost, output cost & profits
        let prof = [];
        var temp = {};
        for (let i = 0; i < calc.length; i++) {
            let rin = calc[i].inputs;
            let rout = calc[i].output;
            let tisell = 0;
            let tibuy = 0;
            for (let ii = 0; ii < rin.length; ii++) {
                tisell += rin[ii].sell;
                tibuy += rin[ii].buy;
            }
            if (imeth === "buy" && ometh === "sell") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "chain": calc[i].chain,
                    "i": numeral(tibuy * bonus.mat).format('0,0.00'),
                    "o": numeral(rout.sell).format('0,0.00'),
                    "prof": numeral(rout.sell - tibuy * bonus.mat).format('0,0.00'),
                    "per": numeral(((rout.sell - tibuy * bonus.mat) / rout.sell)).format('0.00%')
                }
                if (((rout.sell - tibuy * bonus.mat) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - tibuy * bonus.mat) / rout.sell) < 0) {
                    temp.neg = true;
                }
            } else if (imeth === "buy" && ometh === "buy") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "chain": calc[i].chain,
                    "i": numeral(tibuy * bonus.mat).format('0,0.00'),
                    "o": numeral(rout.buy).format('0,0.00'),
                    "prof": numeral(rout.buy - tibuy * bonus.mat).format('0,0.00'),
                    "per": numeral(((rout.buy - tibuy * bonus.mat) / rout.buy)).format('0.00%')
                }
                if (((rout.buy - tibuy * bonus.mat) / rout.buy) > 0) {
                    temp.pos = true;
                } else if (((rout.buy - tibuy * bonus.mat) / rout.buy) < 0) {
                    temp.neg = true;
                }
            } else if (imeth === "sell" && ometh === "sell") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "chain": calc[i].chain,
                    "i": numeral(tisell * bonus.mat).format('0,0.00'),
                    "o": numeral(rout.sell).format('0,0.00'),
                    "prof": numeral(rout.sell - tisell * bonus.mat).format('0,0.00'),
                    "per": numeral(((rout.sell - tisell * bonus.mat) / rout.sell)).format('0.00%')
                }
                if (((rout.sell - tisell * bonus.mat) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - tisell * bonus.mat) / rout.sell) < 0) {
                    temp.neg = true;
                }
            } else if (imeth === "sell" && ometh === "buy") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "chain": calc[i].chain,
                    "i": numeral(tisell * bonus.mat).format('0,0.00'),
                    "o": numeral(rout.buy).format('0,0.00'),
                    "prof": numeral(rout.buy - tisell * bonus.mat).format('0,0.00'),
                    "per": numeral(((rout.buy - tisell * bonus.mat) / rout.buy)).format('0.00%')
                }
                if (((rout.buy - tisell * bonus.mat) / rout.buy) > 0) {
                    temp.pos = true;
                } else if (((rout.buy - tisell * bonus.mat) / rout.buy) < 0) {
                    temp.neg = true;
                }
            } else if (ometh === "buy") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "chain": calc[i].chain,
                    "i": numeral(tibuy * bonus.mat).format('0,0.00'),
                    "o": numeral(rout.buy).format('0,0.00'),
                    "prof": numeral(rout.buy - tibuy * bonus.mat).format('0,0.00'),
                    "per": numeral(((rout.buy - tibuy * bonus.mat) / rout.buy)).format('0.00%')
                }
                if (((rout.buy - tibuy * bonus.mat) / rout.buy) > 0) {
                    temp.pos = true;
                } else if (((rout.buy - tibuy * bonus.mat) / rout.buy) < 0) {
                    temp.neg = true;
                }
            } else if (imeth === "sell") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "chain": calc[i].chain,
                    "i": numeral(tisell * bonus.mat).format('0,0.00'),
                    "o": numeral(rout.sell).format('0,0.00'),
                    "prof": numeral(rout.sell - tisell * bonus.mat).format('0,0.00'),
                    "per": numeral(((rout.sell - tisell * bonus.mat) / rout.sell)).format('0.00%')
                }
                if (((rout.sell - tisell * bonus.mat) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - tisell * bonus.mat) / rout.sell) < 0) {
                    temp.neg = true;
                }
            } else { //default I BUY / S SELL
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "chain": calc[i].chain,
                    "i": numeral(tibuy * bonus.mat).format('0,0.00'),
                    "o": numeral(rout.sell).format('0,0.00'),
                    "prof": numeral(rout.sell - tibuy * bonus.mat).format('0,0.00'),
                    "per": numeral(((rout.sell - tibuy * bonus.mat) / rout.sell)).format('0.00%')
                }
                if (((rout.sell - tibuy * bonus.mat) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - tibuy * bonus.mat) / rout.sell) < 0) {
                    temp.neg = true;
                }
            }
            prof.push(temp);
        }
        //END build array with total input cost, output cost & profits

        res.render('comp', { title: 'Composite Reactions', comp: true, table: prof });
    });
});

module.exports = router;