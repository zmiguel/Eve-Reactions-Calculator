var express = require('express');
var mongo = require('mongodb');
var request = require('request');
var async = require('async');
var numeral = require('numeral');
var cookieParser = require('cookie-parser');
var xmljs = require('xml-js');
var router = express.Router();

var svurl = "mongodb://localhost:27017";

function getCostIndex(sys, name) {
    for (let i = 0; i < sys.length; i++) {
        if (sys[i].name.toLowerCase() === name.toLowerCase()) {
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
            console.log(exp);
            return exp;
        }
    }
    let exp = {
        "sell": 0,
        "buy": 0
    }
    return exp;
}

function getChainTax(prof, reac, id) {
    let temp = 0;
    for (let i = 0; i < reac.length; i++) {
        if (reac[i]._id === id) {
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

function isEmpty(obj) {
    for(var key in obj) {
        if(obj.hasOwnProperty(key))
            return false;
    }
    return true;
}

function getItemName(items,id) {
    for (let i = 0; i < items.length; i++) {
        if (items[i]._id === id) {
            return items[i].name;
        }
    }
}

function getItemID(items,name) {
    for (let i = 0; i < items.length; i++) {
        if (items[i].name === name) {
            return items[i]._id;
        }
    }
}

/* GET comp page. */
router.get('/', function(req, res, next) {
    //set cookies if not found
    var ck = req.cookies;
    //console.log(ck);
    if (!ck.input) { res.cookie('input', 'buy', { maxAge: 31556952000,  }); var imeth = "buy"; }
    if (!ck.output) { res.cookie('output', 'sell', { maxAge: 31556952000,  }); var ometh = "sell"; }
    if (!ck.skill) { res.cookie('skill', 5, { maxAge: 31556952000,  }); var skill = 5; }
    if (!ck.facility) { res.cookie('facility', 'large', { maxAge: 31556952000,  }); var facility = "large"; }
    if (!ck.rig) { res.cookie('rig', 1, { maxAge: 31556952000,  }); var rig = 1; var rige = true; }
    if (!ck.space) { res.cookie('space', 'null', { maxAge: 31556952000,  }); var space = "null"; }
    if (!ck.indyTax) { res.cookie('indyTax', 0, { maxAge: 31556952000,  }); var indyTax = 0; }
    if (!ck.duration) { res.cookie('duration', 10080, { maxAge: 31556952000,  }); var duration = 10080; }
    if (!ck.system) { res.cookie('system', 'Basgerin', { maxAge: 31556952000,  }); var syst = "Basgerin" }

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
		var re = /^[a-zA-Z0-9-]+$/;
        if (re.test(ck.system)) {
            var syst = ck.system;
        } else {
            var syst = 'Basgerin';
        }
    }

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
    let querry = ['items', 'bp-comp', 'systems'];

    async.map(querry, function(coll, callback) {
        mongo.connect(svurl, function(err, client) {
            if (err) {
                console.log(err);
            } else {
                var db = client.db('eve-reactor');
                db.collection(coll).find().toArray(function(err, res) {
                    callback(null, res);
                    client.close();
                });
            }
        });
    }, function(err, results) {
        let itemData = results[0];
        let reac = results[1];
        let systems = results[2];
        //get cost index
        var costIndex = getCostIndex(systems, syst);
        let calc = [];
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
                    "buy": getItem(itemData, reac[i].output.id).buy * reac[i].output.qt * cycles,
                    "adjusted_price": getItem(itemData, reac[i].output.id).adjusted_price
                }
                ttmp = {
                    "id": reac[i]._id,
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
                    "buy": getItem(itemData, reac[i].output.id).buy * reac[i].output.qt * cycles,
                    "adjusted_price": getItem(itemData, reac[i].output.id).adjusted_price
                }
                ttmp = {
                    "id": reac[i]._id,
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
                    if (inp === 0) { //look for fuel block
                        tmpPrc = {
                            "id": reac[i].inputs[inp].id,
                            "buy": getItem(itemData, reac[i].inputs[inp].id).buy * reac[i].inputs[inp].qt * cycles,
                            "sell": getItem(itemData, reac[i].inputs[inp].id).sell * reac[i].inputs[inp].qt * cycles
                        }
                    } else { //look for input from other reactions
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
                    "buy": getItem(itemData, reac[i].output.id).buy * reac[i].output.qt * cycles,
                    "adjusted_price": getItem(itemData, reac[i].output.id).adjusted_price
                }
                ttmp = {
                    "id": reac[i]._id,
                    "name": reac[i].name,
                    "type": reac[i].type,
                    "chain": "yes",
                    "inputs": tempin,
                    "output": tempout
                }
                calc.push(ttmp);
            }else if(reac[i].type === "unrefined"){
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
                    "buy": getItem(itemData, reac[i].output.id).buy * reac[i].output.qt * cycles,
                    "adjusted_price": getItem(itemData, reac[i].output.id).adjusted_price
                }
                ttmp = {
                    "id": reac[i]._id,
                    "name": reac[i].name,
                    "type": reac[i].type,
                    "chain": "No",
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
        let unprof = [];
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
            indexTax += rout.adjusted_price * costIndex;
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
                if (((rout.sell - (tibuy + ttax)) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - (tibuy + ttax)) / rout.sell) < 0) {
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
                if (((rout.buy - (tibuy + ttax)) / rout.buy) > 0) {
                    temp.pos = true;
                } else if (((rout.buy - (tibuy + ttax)) / rout.buy) < 0) {
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
                if (((rout.sell - (tisell + ttax)) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - (tisell + ttax)) / rout.sell) < 0) {
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
                if (((rout.buy - (tisell + ttax)) / rout.buy) > 0) {
                    temp.pos = true;
                } else if (((rout.buy - (tisell + ttax)) / rout.buy) < 0) {
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
                if (((rout.buy - (tibuy + ttax)) / rout.buy) > 0) {
                    temp.pos = true;
                } else if (((rout.buy - (tibuy + ttax)) / rout.buy) < 0) {
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
                if (((rout.sell - (tisell + ttax)) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - (tisell + ttax)) / rout.sell) < 0) {
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
                if (((rout.sell - (tibuy + ttax)) / rout.sell) > 0) {
                    temp.pos = true;
                } else if (((rout.sell - (tibuy + ttax)) / rout.sell) < 0) {
                    temp.neg = true;
                }
            }
            if (temp.type === "simple") {
                sprof.push(temp);
            } else if(temp.type === "complex") {
                if (temp.chain === "yes") {
                    chprof.push(temp);
                } else {
                    cprof.push(temp);
                }
            }else if(temp.type === "unrefined"){
                unprof.push(temp);
            }
        }
        //END build array with total input cost, output cost & profits
        res.render('comp', { title: 'Composite Reactions', comp: true, stable: sprof, ctable: cprof, chtable: chprof, untable: unprof, sett: ck });
    });
});

router.get('/:id',function(req, res, next){
    const reqid = parseInt(req.params.id);
    //set cookies if not found
    var ck = req.cookies;
    //console.log(ck);
    if (!ck.input) { res.cookie('input', 'buy', { maxAge: 31556952000,  }); var imeth = "buy"; }
    if (!ck.output) { res.cookie('output', 'sell', { maxAge: 31556952000,  }); var ometh = "sell"; }
    if (!ck.skill) { res.cookie('skill', 5, { maxAge: 31556952000,  }); var skill = 5; }
    if (!ck.facility) { res.cookie('facility', 'large', { maxAge: 31556952000,  }); var facility = "large"; }
    if (!ck.rig) { res.cookie('rig', 1, { maxAge: 31556952000,  }); var rig = 1; var rige = true; }
    if (!ck.space) { res.cookie('space', 'null', { maxAge: 31556952000,  }); var space = "null"; }
    if (!ck.indyTax) { res.cookie('indyTax', 0, { maxAge: 31556952000,  }); var indyTax = 0; }
    if (!ck.duration) { res.cookie('duration', 10080, { maxAge: 31556952000,  }); var duration = 10080; }
    if (!ck.cycles) { res.cookie('cycles', 50, { maxAge: 31556952000,  }); var cycles = 50; }
    if (!ck.system) { res.cookie('system', 'Basgerin', { maxAge: 31556952000,  }); var syst = "Basgerin" }

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
    if (ck.cycles >= 1 && ck.cycles <= 300) {
        var cycles = ck.cycles
    } else {
        var cycles = 50;
    }
    if (ck.system) {
		var re = /^[a-zA-Z0-9-]+$/;
        if (re.test(ck.system)) {
            var syst = ck.system;
        } else {
            var syst = 'Basgerin';
        }
    }

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

    let querry = ['items', 'bp-comp', 'systems'];
    async.map(querry, function(coll, callback) {
        mongo.connect(svurl, function(err, client) {
            if (err) {
                console.log(err);
            } else {
                var db = client.db('eve-reactor');
                db.collection(coll).find().toArray(function(err, res) {
                    callback(null, res);
                    client.close();
                });
            }
        });
    }, function(err, results) {
        let itemData = results[0];
        let reac = results[1];
        let systems = results[2];
        //get cost index
        var costIndex = getCostIndex(systems, syst);
        //define vars for information
        var inpArr = [];
        let inptotal = {};
        var taxArr = [];
        let taxtotal = {};
        var outArr = [];
        let outtotal = {};
        var repArr = [];
        let reptotal = {};

        //START build new BP array with prices
        var itembp = {};        
        
        for(let i=0;i<reac.length;i++){         
            if(reac[i]._id === reqid){
                itembp = reac[i];
            }
        }

       if(isEmpty(itembp)){
            var err = new Error('Item not found!!');
            err.status = 404;
            res.locals.message = err.message;
            // render the error page
            res.status(404);
            res.render('error');
        }else{
            var advsettings = {};
            advsettings.cycles = Math.round(cycles);
            advsettings.ctime = Math.round(cycles * bonus.time);
            advsettings.tcycles = Math.floor(ck.duration / advsettings.ctime);

            let prodData = {};
            prodData.name = getItemName(itemData,itembp._id);
            prodData.url = req.url;
            
            if(itembp.type === "simple"){ 
                //build input array

                itembp.inputs.forEach(function(elem){
                    let inrow = {};
                    inrow.id = elem.id;
                    inrow.name = getItemName(itemData,elem.id);
                    inrow.qt = Math.ceil(elem.qt * cycles * bonus.mat);
                    inrow.price = inrow.qt * getItem(itemData,elem.id).buy;
                    inrow.pricestr = numeral(inrow.qt * getItem(itemData,elem.id).buy).format('0,0.00');

                    inpArr.push(inrow);
                });
                inptotal = {
                    "name": "TOTAL",
                    "qt": 0,
                    "price": 0
                };
                inpArr.forEach(function(elem){
                    inptotal.qt += elem.qt;
                    inptotal.price += elem.price;
                });
                inptotal.pricestr = numeral(inptotal.price).format('0,0.00');

                //build output array
                
                let elem = itembp.output;
                let outrow = {};
                outrow.id = elem.id;
                outrow.name = getItemName(itemData,elem.id);
                outrow.qt = Math.ceil(elem.qt * cycles);
                outrow.price = outrow.qt * getItem(itemData,elem.id).sell;
                outrow.pricestr = numeral(outrow.qt * getItem(itemData,elem.id).sell).format('0,0.00');
                outrow.adjusted_price = getItem(itemData,elem.id).adjusted_price;
                outArr.push(outrow);

                outtotal = {
                    "name": "TOTAL",
                    "qt": 0,
                    "price": 0,
                    "adjusted_price": 0
                }
                outArr.forEach(function(elem){
                    outtotal.qt += elem.qt;
                    outtotal.price += elem.price;
                    outtotal.adjusted_price += elem.adjusted_price;
                });
                outtotal.pricestr = numeral(outtotal.price).format('0,0.00');

                //build tax array

                let taxrow = {};
                taxrow.name = "Cost Index";
                taxrow.perc = costIndex * 100;
                taxrow.price = outtotal.adjusted_price * costIndex;
                taxrow.pricestr = numeral(outtotal.price * costIndex).format('0,0.00');
                taxArr.push(taxrow);
                let taxrow2 = {};
                taxrow2.name = "Industrial Tax";
                taxrow2.perc = indyTax;
                taxrow2.price = taxrow.price * (indyTax/100);
                taxrow2.pricestr = numeral(taxrow.price * (indyTax/100)).format('0,0.00');
                taxArr.push(taxrow2);

                taxtotal = {
                    "name": "TOTAL",
                    "price": 0
                }

                taxArr.forEach(function(elem){
                    taxtotal.price += elem.price;
                });
                taxtotal.pricestr = numeral(taxtotal.price).format('0,0.00');

                //build report array

                let reprow = {};
                reprow.type = "Input Materials"
                reprow.price = -inptotal.price * advsettings.tcycles;
                reprow.pricestr = numeral(-inptotal.price * advsettings.tcycles).format('0,0.00');
                repArr.push(reprow);

                reprow = {};
                reprow.type = "Taxes"
                reprow.price = -taxtotal.price * advsettings.tcycles;
                reprow.pricestr = numeral(-taxtotal.price * advsettings.tcycles).format('0,0.00');
                repArr.push(reprow);

                reprow = {};
                reprow.type = "Output Materials"
                reprow.price = outtotal.price * advsettings.tcycles;
                reprow.pricestr = numeral(outtotal.price * advsettings.tcycles).format('0,0.00');
                repArr.push(reprow);

                reptotal = {
                    "type": "TOTAL",
                    "price": outtotal.price * advsettings.tcycles - inptotal.price * advsettings.tcycles - taxtotal.price * advsettings.tcycles
                }
                reptotal.pricestr = numeral(reptotal.price).format('0,0.00');

            }else if(itembp.type === "complex"){

                if(req.query.chain){
                    prodData.name = "Still working on the chain version of these, sorry :(";
                }else{
                    //build input array

                    itembp.inputs.forEach(function(elem){
                        let inrow = {};
                        inrow.id = elem.id;
                        inrow.name = getItemName(itemData,elem.id);
                        inrow.qt = Math.ceil(elem.qt * cycles * bonus.mat);
                        inrow.price = inrow.qt * getItem(itemData,elem.id).buy;
                        inrow.pricestr = numeral(inrow.qt * getItem(itemData,elem.id).buy).format('0,0.00');

                        inpArr.push(inrow);
                    });
                    inptotal = {
                        "name": "TOTAL",
                        "qt": 0,
                        "price": 0
                    };
                    inpArr.forEach(function(elem){
                        inptotal.qt += elem.qt;
                        inptotal.price += elem.price;
                    });
                    inptotal.pricestr = numeral(inptotal.price).format('0,0.00');

                    //build output array
                    
                    let elem = itembp.output;
                    let outrow = {};
                    outrow.id = elem.id;
                    outrow.name = getItemName(itemData,elem.id);
                    outrow.qt = Math.ceil(elem.qt * cycles);
                    outrow.price = outrow.qt * getItem(itemData,elem.id).sell;
                    outrow.pricestr = numeral(outrow.qt * getItem(itemData,elem.id).sell).format('0,0.00');
                    outrow.adjusted_price = getItem(itemData,elem.id).adjusted_price;
                    outArr.push(outrow);

                    outtotal = {
                        "name": "TOTAL",
                        "qt": 0,
                        "price": 0,
                        "adjusted_price": 0
                    }
                    outArr.forEach(function(elem){
                        outtotal.qt += elem.qt;
                        outtotal.price += elem.price;
                        outtotal.adjusted_price += elem.adjusted_price;
                    });
                    outtotal.pricestr = numeral(outtotal.price).format('0,0.00');

                    //build tax array

                    let taxrow = {};
                    taxrow.name = "Cost Index";
                    taxrow.perc = costIndex * 100;
                    taxrow.price = outtotal.adjusted_price * costIndex;
                    taxrow.pricestr = numeral(outtotal.adjusted_price * costIndex).format('0,0.00');
                    taxArr.push(taxrow);
                    let taxrow2 = {};
                    taxrow2.name = "Industrial Tax";
                    taxrow2.perc = indyTax;
                    taxrow2.price = taxrow.price * (indyTax/100);
                    taxrow2.pricestr = numeral(taxrow.price * (indyTax/100)).format('0,0.00');
                    taxArr.push(taxrow2);

                    taxtotal = {
                        "name": "TOTAL",
                        "price": 0
                    }

                    taxArr.forEach(function(elem){
                        taxtotal.price += elem.price;
                    });
                    taxtotal.pricestr = numeral(taxtotal.price).format('0,0.00');

                    //build report array

                    let reprow = {};
                    reprow.type = "Input Materials"
                    reprow.price = -inptotal.price * advsettings.tcycles;
                    reprow.pricestr = numeral(-inptotal.price * advsettings.tcycles).format('0,0.00');
                    repArr.push(reprow);

                    reprow = {};
                    reprow.type = "Taxes"
                    reprow.price = -taxtotal.price * advsettings.tcycles;
                    reprow.pricestr = numeral(-taxtotal.price * advsettings.tcycles).format('0,0.00');
                    repArr.push(reprow);

                    reprow = {};
                    reprow.type = "Output Materials"
                    reprow.price = outtotal.price * advsettings.tcycles;
                    reprow.pricestr = numeral(outtotal.price * advsettings.tcycles).format('0,0.00');
                    repArr.push(reprow);

                    reptotal = {
                        "type": "TOTAL",
                        "price": outtotal.price * advsettings.tcycles - inptotal.price * advsettings.tcycles - taxtotal.price * advsettings.tcycles
                    }
                    reptotal.pricestr = numeral(reptotal.price).format('0,0.00');

                }
                

            }else if(itembp.type === "unrefined"){

                //build input array

                itembp.inputs.forEach(function(elem){
                    let inrow = {};
                    inrow.id = elem.id;
                    inrow.name = getItemName(itemData,elem.id);
                    inrow.qt = Math.ceil(elem.qt * cycles * bonus.mat);
                    inrow.price = inrow.qt * getItem(itemData,elem.id).buy;
                    inrow.pricestr = numeral(inrow.qt * getItem(itemData,elem.id).buy).format('0,0.00');

                    inpArr.push(inrow);
                });
                inptotal = {
                    "name": "TOTAL",
                    "qt": 0,
                    "price": 0
                };
                inpArr.forEach(function(elem){
                    inptotal.qt += elem.qt;
                    inptotal.price += elem.price;
                });
                inptotal.pricestr = numeral(inptotal.price).format('0,0.00');

                //build output array
                
                let elem = itembp.output;
                let outrow = {};
                outrow.id = elem.id;
                outrow.name = getItemName(itemData,elem.id);
                outrow.qt = Math.ceil(elem.qt * cycles);
                outrow.price = outrow.qt * getItem(itemData,elem.id).sell;
                outrow.pricestr = numeral(outrow.qt * getItem(itemData,elem.id).sell).format('0,0.00');
                outArr.push(outrow);

                outtotal = {
                    "name": "TOTAL",
                    "qt": 0,
                    "price": 0
                }
                outArr.forEach(function(elem){
                    outtotal.qt += elem.qt;
                    outtotal.price += elem.price;
                });
                outtotal.pricestr = numeral(outtotal.price).format('0,0.00');

                //build tax array

                let taxrow = {};
                taxrow.name = "Cost Index";
                taxrow.perc = costIndex * 100;
                taxrow.price = outtotal.price * costIndex;
                taxrow.pricestr = numeral(outtotal.price * costIndex).format('0,0.00');
                taxArr.push(taxrow);
                let taxrow2 = {};
                taxrow2.name = "Industrial Tax";
                taxrow2.perc = indyTax;
                taxrow2.price = taxrow.price * (indyTax/100);
                taxrow2.pricestr = numeral(taxrow.price * (indyTax/100)).format('0,0.00');
                taxArr.push(taxrow2);

                taxtotal = {
                    "name": "TOTAL",
                    "price": 0
                }

                taxArr.forEach(function(elem){
                    taxtotal.price += elem.price;
                });
                taxtotal.pricestr = numeral(taxtotal.price).format('0,0.00');

                //build report array

                let reprow = {};
                reprow.type = "Input Materials"
                reprow.price = -inptotal.price * advsettings.tcycles;
                reprow.pricestr = numeral(-inptotal.price * advsettings.tcycles).format('0,0.00');
                repArr.push(reprow);

                reprow = {};
                reprow.type = "Taxes"
                reprow.price = -taxtotal.price * advsettings.tcycles;
                reprow.pricestr = numeral(-taxtotal.price * advsettings.tcycles).format('0,0.00');
                repArr.push(reprow);

                reprow = {};
                reprow.type = "Output Materials"
                reprow.price = outtotal.price * advsettings.tcycles;
                reprow.pricestr = numeral(outtotal.price * advsettings.tcycles).format('0,0.00');
                repArr.push(reprow);

                reptotal = {
                    "type": "TOTAL",
                    "price": outtotal.price * advsettings.tcycles - inptotal.price * advsettings.tcycles - taxtotal.price * advsettings.tcycles
                }
                reptotal.pricestr = numeral(reptotal.price).format('0,0.00');

            }

            res.render('comp-adv', { title: prodData.name + ' Reaction', comp: true, data: prodData, intable: inpArr, intt: inptotal, outtable: outArr, outtt: outtotal, taxtable: taxArr, taxtt: taxtotal, reptable: repArr, reptt: reptotal, sett: ck, advsett: advsettings }); 
        }
    });   
});

module.exports = router;
