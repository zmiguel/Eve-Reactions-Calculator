var express = require('express');
var mongo = require('mongodb');
var request = require('request');
var async = require('async');
var numeral = require('numeral');
var cookieParser = require('cookie-parser');
var xmljs = require('xml-js');
var router = express.Router();

var svurl = "mongodb://localhost:27017/eve-reactor";

function getCostIndex(sys, name) {
    for (let i = 0; i < sys.length; i++) {
        if (sys[i].name.toUpperCase() === name.toUpperCase()) {
            return sys[i].index;
        }
    }
}

function getItem(data, id) {
    for (let i = 0; i < data.length; i++) {
        if (data[i]._id === id) {
            return data[i];
        }
    }
}

function getSimplePrice(data, id) {
    var tempsell = 0;
    var tempbuy = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i].id === id) {
            for (let ii = 0; ii < data[i].inputs.length; ii++) {
                tempsell += data[i].inputs[ii].sell;
                tempbuy += data[i].inputs[ii].buy;
            }
            let exp = {
                "sell": tempsell,
                "buy": tempbuy
            }
            return exp;
        }
    }
}

function getChainTax(prof, reac, id) {
    let temp = 0;
    for (let i = 0; i < reac.length; i++) {
        if (reac[i].id === id) {
            let inp = reac[i].inputs;
            for (let ii = 0; ii < inp.length; ii++) {
                for (let iii = 0; iii < prof.length; iii++) {
                    if (inp[ii].id === prof[iii].id) {
                        temp += prof[iii].taxes.index / 2;
                    }
                }
            }
            return temp;
        }
    }
}

/* GET comp page. */
router.get('/', function(req, res, next) {
    //set cookies if not found
    var ck = req.cookies;
    //console.log(ck);
    if (!ck.input) { res.cookie('input', 'buy'); var imeth = "buy"; }
    if (!ck.output) { res.cookie('output', 'sell'); var ometh = "sell"; }
    if (!ck.skill) { res.cookie('skill', 5); var skill = 5; }
    if (!ck.facility) { res.cookie('facility', 'large'); var facility = "large"; }
    if (!ck.rig) { res.cookie('rig', 1); var rig = 1; var rige = true; }
    if (!ck.space) { res.cookie('space', 'null'); var space = "null"; }
    if (!ck.indyTax) { res.cookie('indyTax', 0); var indyTax = 0; }
    if (!ck.duration) { res.cookie('duration', 10080); var duration = 10080; }
    if (!ck.system) { res.cookie('system', 'Basgerin'); var syst = "Basgerin" }

    //set internal vars to use cookie values
    if (ck.input.toLowerCase() === "buy" || ck.input.toLowerCase() === "sell") {
        var imeth = ck.input.toLowerCase();
    } else {
        var imeth = "buy";
    }
    if (ck.output.toLowerCase() === "buy" || ck.output.toLowerCase() === "sell") {
        var ometh = ck.output.toLowerCase();
    } else {
        var ometh = "sell";
    }
    if (parseInt(ck.skill) >= 0 && parseInt(ck.skill) <= 5) {
        var skill = parseInt(ck.skill);
    } else {
        var skill = 5;
    }
    if (ck.facility.toLowerCase() === "med" || ck.facility.toLowerCase() === "large") {
        var facility = ck.facility.toLowerCase();
    } else {
        var facility = "large";
    }
    if (parseInt(ck.rig) >= 0 && parseInt(ck.rig) <= 2) {
        var rig = parseInt(ck.rig);
        var rige = true;
    } else {
        var rig = 1;
        var rige = true;
    }
    if (ck.space.toLowerCase() === "low" || ck.space.toLowerCase() === "null") {
        var space = ck.space.toLowerCase();
    } else {
        var space = "null";
    }
    if (ck.indyTax >= 0 && ck.indyTax <= 50) {
        var indyTax = ck.indyTax
    } else {
        var indyTax = 0;
    }
    if (ck.duration >= 1 && ck.duration <= 43200) {
        var duration = ck.duration
    } else {
        var duration = 10080;
    }
    if (ck.system) {
        var syst = ck.system;
    }
    console.log("in:", imeth, "out:", ometh, "skill:", skill, "faci:", facility, "rig:", rig, "space:", space, "tax:", indyTax, "system:", syst);

    //calc bonus with opts
    var matb = 1;
    var time = 180;
    var bonus = {};
    //default is Skill (Reactions) 5, Large facility & T1 rig in NullSec
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
    time = 180 * (1 - (4 * skill) / 100); //skill bonus
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
        time = time;
    }
    //final result
    bonus = {
        "mat": matb,
        "time": time
    }
    var cycles = Math.floor(duration / bonus.time);

    //vars
    let lvid = 30000891;
    let querry = ['items', 'bps', 'systems'];

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
        let systems = results[2];
        //get cost index
        var costIndex = getCostIndex(systems, syst);
        let calc = [];
        let reac = bpsData[0].reaction;
        //START build new BP array with prices
        for (let i = 0; i < reac.length; i++) {
            let tempin = [];
            let tempout = {};
            let ttmp = {};
            let tmpPrc = {};
            if (reac[i].type === "simple") {
                for (let inp = 0; inp < reac[i].inputs.length; inp++) {
                    tmpPrc = {
                        "id": reac[i].inputs[inp].id,
                        "buy": getItem(itemData, reac[i].inputs[inp].id).buy * reac[i].inputs[inp].qt * cycles,
                        "sell": getItem(itemData, reac[i].inputs[inp].id).sell * reac[i].inputs[inp].qt * cycles
                    }
                    tempin.push(tmpPrc);
                }
                tempout = {
                    "id": reac[i].output.id,
                    "sell": getItem(itemData, reac[i].output.id).sell * reac[i].output.qt * cycles,
                    "buy": getItem(itemData, reac[i].output.id).buy * reac[i].output.qt * cycles
                }
                ttmp = {
                    "id": reac[i].id,
                    "name": reac[i].name,
                    "type": reac[i].type,
                    "chain": "No",
                    "inputs": tempin,
                    "output": tempout
                }
                calc.push(ttmp);
            } else if (reac[i].type === "complex") {
                //calc as simple
                tempin = [];
                tempout = {};
                tmpPrc = {};
                for (let inp = 0; inp < reac[i].inputs.length; inp++) {
                    tmpPrc = {
                        "id": reac[i].inputs[inp].id,
                        "buy": getItem(itemData, reac[i].inputs[inp].id).buy * reac[i].inputs[inp].qt * cycles,
                        "sell": getItem(itemData, reac[i].inputs[inp].id).sell * reac[i].inputs[inp].qt * cycles
                    }
                    tempin.push(tmpPrc);
                }
                tempout = {
                    "id": reac[i].output.id,
                    "sell": getItem(itemData, reac[i].output.id).sell * reac[i].output.qt * cycles,
                    "buy": getItem(itemData, reac[i].output.id).buy * reac[i].output.qt * cycles
                }
                ttmp = {
                    "id": reac[i].id,
                    "name": reac[i].name,
                    "type": reac[i].type,
                    "chain": "No",
                    "inputs": tempin,
                    "output": tempout
                }
                calc.push(ttmp);
                //calc as chain
                tempin = [];
                tmpPrc = {};
                tempout = {};
                for (let inp = 0; inp < reac[i].inputs.length; inp++) {
                    if (inp === reac[i].inputs.length - 1) { //look for fuel block
                        tmpPrc = {
                            "id": reac[i].inputs[inp].id,
                            "buy": getItem(itemData, reac[i].inputs[inp].id).buy * reac[i].inputs[inp].qt * cycles,
                            "sell": getItem(itemData, reac[i].inputs[inp].id).sell * reac[i].inputs[inp].qt * cycles
                        }
                    } else { //look for input from other reactions
                        console.log(reac[i].inputs[inp].id, reac[i].name);
                        tmpPrc = {
                            "id": reac[i].inputs[inp].id,
                            "buy": getSimplePrice(calc, reac[i].inputs[inp].id).buy / 2,
                            "sell": getSimplePrice(calc, reac[i].inputs[inp].id).sell / 2
                        }
                    }
                    tempin.push(tmpPrc);
                }
                tempout = {
                    "id": reac[i].output.id,
                    "sell": getItem(itemData, reac[i].output.id).sell * reac[i].output.qt * cycles,
                    "buy": getItem(itemData, reac[i].output.id).buy * reac[i].output.qt * cycles
                }
                ttmp = {
                    "id": reac[i].id,
                    "name": reac[i].name,
                    "type": reac[i].type,
                    "chain": "yes",
                    "inputs": tempin,
                    "output": tempout
                }
                calc.push(ttmp);
            }

        }
        //console.log(calc);
        //END build new BP array with prices
        //START build array with total input cost, output cost & profits
        let sprof = [];
        let cprof = [];
        let chprof = [];
        var temp = {};
        for (let i = 0; i < calc.length; i++) {
            let rin = calc[i].inputs;
            let rout = calc[i].output;
            let tisell = 0;
            let tibuy = 0;
            var indexTax = 0;
            //calc chain indextax
            if (calc[i].chain === "yes") {
                indexTax += getChainTax(sprof, reac, calc[i].id);
            }
            indexTax += rout.buy * costIndex;
            //calc build tax based on cost index
            var buildTax = indexTax * (indyTax / 100);
            //total tax
            var ttax = indexTax + buildTax;
            //calc total input prices
            for (let ii = 0; ii < rin.length; ii++) {
                tisell += rin[ii].sell * bonus.mat;
                tibuy += rin[ii].buy * bonus.mat;
            }
            if (imeth === "buy" && ometh === "sell") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "type": calc[i].type,
                    "chain": calc[i].chain,
                    "i": numeral(tibuy).format('0,0.00'),
                    "taxes": {
                        "index": indexTax,
                        "build": buildTax
                    },
                    "tax": numeral(ttax).format('0,0.00'),
                    "o": numeral(rout.sell).format('0,0.00'),
                    "prof": numeral(rout.sell - (tibuy + ttax)).format('0,0.00'),
                    "per": numeral(((rout.sell - (tibuy + ttax)) / rout.sell)).format('0.00%')
                }
                if (((rout.sell - tibuy) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - tibuy) / rout.sell) < 0) {
                    temp.neg = true;
                }
            } else if (imeth === "buy" && ometh === "buy") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "type": calc[i].type,
                    "chain": calc[i].chain,
                    "i": numeral(tibuy).format('0,0.00'),
                    "taxes": {
                        "index": indexTax,
                        "build": buildTax
                    },
                    "tax": numeral(ttax).format('0,0.00'),
                    "o": numeral(rout.buy).format('0,0.00'),
                    "prof": numeral(rout.buy - (tibuy + ttax)).format('0,0.00'),
                    "per": numeral(((rout.buy - (tibuy + ttax)) / rout.buy)).format('0.00%')
                }
                if (((rout.buy - tibuy) / rout.buy) > 0) {
                    temp.pos = true;
                } else if (((rout.buy - tibuy) / rout.buy) < 0) {
                    temp.neg = true;
                }
            } else if (imeth === "sell" && ometh === "sell") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "type": calc[i].type,
                    "chain": calc[i].chain,
                    "i": numeral(tisell).format('0,0.00'),
                    "taxes": {
                        "index": indexTax,
                        "build": buildTax
                    },
                    "tax": numeral(ttax).format('0,0.00'),
                    "o": numeral(rout.sell).format('0,0.00'),
                    "prof": numeral(rout.sell - (tisell + ttax)).format('0,0.00'),
                    "per": numeral(((rout.sell - (tisell + ttax)) / rout.sell)).format('0.00%')
                }
                if (((rout.sell - tisell) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - tisell) / rout.sell) < 0) {
                    temp.neg = true;
                }
            } else if (imeth === "sell" && ometh === "buy") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "type": calc[i].type,
                    "chain": calc[i].chain,
                    "i": numeral(tisell).format('0,0.00'),
                    "taxes": {
                        "index": indexTax,
                        "build": buildTax
                    },
                    "tax": numeral(ttax).format('0,0.00'),
                    "o": numeral(rout.buy).format('0,0.00'),
                    "prof": numeral(rout.buy - (tisell + ttax)).format('0,0.00'),
                    "per": numeral(((rout.buy - (tisell + ttax)) / rout.buy)).format('0.00%')
                }
                if (((rout.buy - tisell) / rout.buy) > 0) {
                    temp.pos = true;
                } else if (((rout.buy - tisell) / rout.buy) < 0) {
                    temp.neg = true;
                }
            } else if (ometh === "buy") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "type": calc[i].type,
                    "chain": calc[i].chain,
                    "i": numeral(tibuy).format('0,0.00'),
                    "taxes": {
                        "index": indexTax,
                        "build": buildTax
                    },
                    "tax": numeral(ttax).format('0,0.00'),
                    "o": numeral(rout.buy).format('0,0.00'),
                    "prof": numeral(rout.buy - (tibuy + ttax)).format('0,0.00'),
                    "per": numeral(((rout.buy - (tibuy + ttax)) / rout.buy)).format('0.00%')
                }
                if (((rout.buy - tibuy) / rout.buy) > 0) {
                    temp.pos = true;
                } else if (((rout.buy - tibuy) / rout.buy) < 0) {
                    temp.neg = true;
                }
            } else if (imeth === "sell") {
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "type": calc[i].type,
                    "chain": calc[i].chain,
                    "i": numeral(tisell).format('0,0.00'),
                    "taxes": {
                        "index": indexTax,
                        "build": buildTax
                    },
                    "tax": numeral(ttax).format('0,0.00'),
                    "o": numeral(rout.sell).format('0,0.00'),
                    "prof": numeral(rout.sell - (tisell + ttax)).format('0,0.00'),
                    "per": numeral(((rout.sell - (tisell + ttax)) / rout.sell)).format('0.00%')
                }
                if (((rout.sell - tisell) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - tisell) / rout.sell) < 0) {
                    temp.neg = true;
                }
            } else { //default I BUY / S SELL
                temp = {
                    "id": calc[i].id,
                    "name": calc[i].name,
                    "type": calc[i].type,
                    "chain": calc[i].chain,
                    "i": numeral(tibuy).format('0,0.00'),
                    "taxes": {
                        "index": indexTax,
                        "build": buildTax
                    },
                    "tax": numeral(ttax).format('0,0.00'),
                    "o": numeral(rout.sell).format('0,0.00'),
                    "prof": numeral(rout.sell - (tibuy + ttax)).format('0,0.00'),
                    "per": numeral(((rout.sell - (tibuy + ttax)) / rout.sell)).format('0.00%')
                }
                if (((rout.sell - tibuy) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - tibuy) / rout.sell) < 0) {
                    temp.neg = true;
                }
            }
            if (temp.type === "simple") {
                sprof.push(temp);
            } else {
                if (temp.chain === "yes") {
                    chprof.push(temp);
                } else {
                    cprof.push(temp);
                }
            }
        }
        //END build array with total input cost, output cost & profits
        res.render('comp', { title: 'Composite Reactions', comp: true, stable: sprof, ctable: cprof, chtable: chprof, sett: ck });
    });
});

module.exports = router;