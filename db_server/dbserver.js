var mongo = require('mongodb');
var request = require('request');
var async = require('async');
var fs = require('fs');
var svurl = "mongodb://localhost:27017/eve-reactor";
var items = require('./items.json');
var systems = require('./systems.json');
var marketUrl = "https://market.fuzzwork.co.uk/aggregates/?region=60003760&types=";
var cron = require('node-cron');

const mats = require('./mats.json');
const outs = require('./outs.json');

//genItems(); //generate base item collection

cron.schedule('*/30 * * * *', function() {
    console.log("Updating Items!");
    newUpdateItems();
    console.log("Updating Cost Index!");
    updateCostIndex();
});

cron.schedule('10 12 * * *', function() {
    console.log("Adding daily price!");
    addDaily();
});


function getItemID(name) {
    for (let i = 0; i < items.length; i++) {
        if (items[i].NAME === name) {
            return items[i].TypeID;
        }
    }
}

function getDate() {
    var today = new Date();
    var dd = today.getDate();
    var mm = today.getMonth() + 1; //January is 0!

    var yyyy = today.getFullYear();
    if (dd < 10) {
        dd = '0' + dd;
    }
    if (mm < 10) {
        mm = '0' + mm;
    }
    var today = yyyy + '/' + mm + '/' + dd;
    return today;
}

function getSystem(arr, id) {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i].solar_system_id === id) {
            return arr[i];
        }
    }
}

function updateCostIndex() {
    let esiurl = "https://esi.tech.ccp.is/latest/industry/systems/?datasource=tranquility";
    request(esiurl, function(err, res, body) {
        let esi = JSON.parse(body);
        let sys = [];
        for (let i = 0; i < systems.length; i++) {
            let temp = {
                "updateOne": {
                    "filter": {
                        "_id": systems[i].solarSystemID
                    },
                    "update": {
                        "_id": systems[i].solarSystemID,
                        "name": systems[i].solarSystemName,
                        "index": getSystem(esi, systems[i].solarSystemID).cost_indices[5].cost_index
                    }
                }
            }
            sys.push(temp);
        }
        mongo.connect(svurl, function(err, db) {
            if (err) {
                console.log(err);
            } else {
                db.collection('systems').bulkWrite(sys, { "ordered": true, "w": 1 }, function(err, result) {
                    if (err) throw err;
                    console.log(result.modifiedCount);
                    console.log("Cost Index UPDATED!");
                    db.close();
                });
            }
        });
    });
}

function split50() {
    let arr = [];
    let tam = items.length;
    let itemcounter = 0;
    for (let i = 0; i < Math.ceil(items.length / 50); i++) {
        let ids = "";
        for (let ii = 0; ii < tam; ii++) {
            if (ii === 50) break;
            ids += items[itemcounter].TypeID;
            ids += ",";
            itemcounter++;
        }
        tam -= 50;
        ids = ids.slice(0, -1);
        arr.push(ids);
    }
    return arr
}

function genItems() {
    idarr = split50();
    let itms = [];
    async.map(idarr, function(ids, callback) {
        request(marketUrl + ids, function(err, res, body) {
            callback(null, JSON.parse(body));
        });
    }, function(err, results) {
        let arr = [];
        for (let i = 0; i < results.length; i++) {
            for (var prop in results[i]) {
                arr.push(results[i][prop]);
            }
        }
        for (let ii = 0; ii < arr.length; ii++) {
            let temp = {
                "_id": items[ii].TypeID,
                "name": items[ii].NAME,
                "sell": parseFloat(arr[ii].sell.min),
                "buy": parseFloat(arr[ii].buy.max),
                "med": ((parseFloat(arr[ii].sell.min) + parseFloat(arr[ii].buy.max)) / 2)
            }
            itms.push(temp);
        }
        mongo.connect(svurl, function(err, db) {
            if (err) {
                console.log(err);
            } else {
                db.collection('items').insertMany(itms, function(err, result) {
                    if (err) throw err;
                    console.log("Iems Generated!!");
                    db.close();
                });
            }
        });
    });
}

function newUpdateItems() {
    idarr = split50();
    let itms = [];
    async.map(idarr, function(ids, callback) {
        request(marketUrl + ids, function(err, res, body) {
            callback(null, JSON.parse(body));
        });
    }, function(err, results) {
        let arr = [];
        for (let i = 0; i < results.length; i++) {
            for (var prop in results[i]) {
                arr.push(results[i][prop]);
            }
        }
        for (let ii = 0; ii < arr.length; ii++) {
            let temp = {
                "updateOne": {
                    "filter": {
                        "_id": items[ii].TypeID
                    },
                    "update": {
                        "_id": items[ii].TypeID,
                        "name": items[ii].NAME,
                        "sell": parseFloat(arr[ii].sell.min),
                        "buy": parseFloat(arr[ii].buy.max),
                        "med": ((parseFloat(arr[ii].sell.min) + parseFloat(arr[ii].buy.max)) / 2)
                    }
                }
            }
            itms.push(temp);
        }
        updateDB(itms);
    });
}

function updateDB(itms) {
    mongo.connect(svurl, function(err, db) {
        if (err) {
            console.log(err);
        } else {
            db.collection('items').bulkWrite(itms, { "ordered": true, "w": 1 }, function(err, result) {
                if (err) throw err;
                console.log(result.modifiedCount);
                console.log("Items Updated!!");
                db.close();
            });
        }
    });
}

function addDaily() { //need to re-write this
    let ids = "";
    for (let i = 0; i < items.length; i++) {
        ids += items[i].TypeID;
        ids += ",";
    }
    ids = ids.slice(0, -1);

    request(marketUrl + ids, function(err, res, body) {
        let data = JSON.parse(body);
        let arr = []
        for (var prop in data) {
            arr.push(data[prop]);
        }
        let itms = []
        for (let i = 0; i < arr.length; i++) {
            let temp = {
                _id: parseInt(items[i].TypeID),
                "name": items[i].NAME,
                "sell": parseFloat(arr[i].sell.min),
                "buy": parseFloat(arr[i].buy.max),
                "med": ((parseFloat(arr[i].sell.min) + parseFloat(arr[i].buy.max)) / 2)
            }
            itms.push(temp);
        }
        var insert = {
            "timestamp": getDate(),
            itms
        }
        mongo.connect(svurl, function(err, db) {
            if (err) {
                console.log(err);
            } else {
                db.collection('history').insert(insert, function(err, result) {
                    console.log("Daily Added!!");
                    db.close();
                });
            }
        });
    });
}