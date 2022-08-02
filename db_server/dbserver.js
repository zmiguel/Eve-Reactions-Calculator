var mongo = require('mongodb');
var request = require('request');
var async = require('async');
var fs = require('fs');
var svurl = "mongodb://localhost:27017";
var items = require('./items.json');
var systems = require('./systems.json');
var marketUrl = "https://market.fuzzwork.co.uk/aggregates/?region=60003760&types=";
var esi_market = "https://esi.evetech.net/latest/markets/prices/?datasource=tranquility";
var cron = require('node-cron');
var firstRun = require('./first.json');

const mats = require('./mats.json');
const outs = require('./outs.json');

sleep(5000);

if (firstRun.run === true){
    console.log("FIRST RUN DOING THINGS!!!!");

    genItems(); //generate base item collection
    genSystems(); //generate systems

    firstRun.run = false;
    fs.writeFile('./first.json', JSON.stringify(firstRun), (err) => {
        if (err)
            console.log(err);
    });
}


function sleep(milliseconds) {
    const date = Date.now();
    let currentDate = null;
    do {
        currentDate = Date.now();
    } while (currentDate - date < milliseconds);
}

console.log("Updating Items!");
newUpdateItems();
updateCostIndexPrice();
console.log("Updating Cost Index!");
updateCostIndex();

cron.schedule('*/30 * * * *', function() {
    console.log("Updating Items!");
    newUpdateItems();
    updateCostIndexPrice();
    console.log("Updating Cost Index!");
    updateCostIndex();
});

cron.schedule('10 12 * * *', function() {
    console.log("Adding daily price!");
    addDaily();
});


function bpBuilder(){
    var bparr = [];
    for(let i = 0;i<outs.length;i++){
        var bp = {};
        bp._id = outs[i].productTypeID;
        bp.bpid = outs[i].typeID;
        bp.name = getItemName(outs[i].productTypeID);
        bp.type = "-";
        bp.inputs = [];
        bp.output = {
            "id" : outs[i].productTypeID,
            "qt" : outs[i].quantity
        }
        mats.forEach(function(elem){
            if(elem.typeID === outs[i].typeID){
                var inItem = {
                    "id" : elem.materialTypeID,
                    "qt" : elem.quantity
                }
                bp.inputs.push(inItem);
            }
        });
        bparr.push(bp);
        console.log(i);
    }
    console.log("Array criado!");
    writeToFile(bparr);
}

function genSystems(){
    console.log("GEN SYSTEMS")
    let esiurl = "https://esi.evetech.net/latest/industry/systems/?datasource=tranquility";
    request(esiurl, function(err, res, body) {
        let esi = JSON.parse(body);
        let sys = [];
        for (let i = 0; i < systems.length; i++) {
            let temp = {
                "insertOne": {
                    "_id": systems[i].solarSystemID,
                    "name": systems[i].solarSystemName,
                    "index": getSystem(esi, systems[i].solarSystemID).cost_indices[5].cost_index
                }
            }
            sys.push(temp);
        }
        mongo.connect(svurl, function(err, client) {
            if (err) {
                console.log("gen system" + err);
            } else {
                var db = client.db('eve-reactor');
                db.collection('systems').bulkWrite(sys, { "ordered": true, writeConcern: {"w": 1} }, function(err, result) {
                    if (err) console.log("gen systems " + err);
                    console.log(result.modifiedCount);
                    console.log("Cost Index UPDATED!");
                    client.close();
                });
            }
        });
    });
}

function writeToFile(arr){
    console.log("A escrever ficheiro...");
    fs.writeFile("./new_bps.json",JSON.stringify(arr));
}

function getItemName(id) {
    for (let i = 0; i < items.length; i++) {
        if (items[i].TypeID === id) {
            return items[i].NAME;
        }
    }
}

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
    let esiurl = "https://esi.evetech.net/latest/industry/systems/?datasource=tranquility";
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
                        '$set': {
                            "_id": systems[i].solarSystemID,
                            "name": systems[i].solarSystemName,
                            "index": getSystem(esi, systems[i].solarSystemID).cost_indices[5].cost_index ?? 0
                        }
                    }
                }
            }
            sys.push(temp);
        }
        mongo.connect(svurl, function(err, client) {
            if (err) {
                console.log("update cost index " + err);
            } else {
                var db = client.db('eve-reactor');
                db.collection('systems').bulkWrite(sys, { "ordered": true, writeConcern: {"w": 1} }, function(err, result) {
                    if (err) console.log("update cost index " + err);
                    console.log(result.modifiedCount);
                    console.log("Cost Index UPDATED!");
                    client.close();
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
    console.log("GEN ITEMS")
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
                "med": ((parseFloat(arr[ii].sell.min) + parseFloat(arr[ii].buy.max)) / 2),
                "adjusted_price": 0
            }
            itms.push(temp);
        }
        mongo.connect(svurl, function(err, client) {
            if (err) {
                console.log(err);
            } else {
                var db = client.db('eve-reactor');
                db.collection('items').insertMany(itms, function(err, result) {
                    if (err) throw err;
                    console.log("Iems Generated!!");
                    client.close();
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
                        '$set': {
                            "_id": items[ii].TypeID,
                            "name": items[ii].NAME,
                            "sell": parseFloat(arr[ii].sell.min),
                            "buy": parseFloat(arr[ii].buy.max),
                            "med": ((parseFloat(arr[ii].sell.min) + parseFloat(arr[ii].buy.max)) / 2)
                        }
                    }
                }
            }
            itms.push(temp);
        }
        updateDB(itms);
    });
}

function updateCostIndexPrice() {
    let ids = "";
    for (let i = 0; i < items.length; i++) {
        ids += items[i].TypeID;
        ids += ",";
    }
    ids = ids.slice(0, -1);

    request(esi_market, function(err, res, body) {
        // get list with all data
        let data = JSON.parse(body);
        // grab data for items we want
        let arr = [];
        // for each item in our item list
        for (let i = 0; i < items.length; i++) {
            // look for the item in CCPs list
            for (let ii = 0; ii < data.length; ii++){
                if (items[i].TypeID === data[ii].type_id){
                    // we found it!
                    arr.push(data[ii]);
                }
            }
        }
        // arr now is an array of the items we want with the adjusted price!
        let itms = [];
        for (let ii = 0; ii < arr.length; ii++) {
            let temp = {
                "updateOne": {
                    "filter": {
                        "_id": items[ii].TypeID
                    },
                    "update": {
                        '$set': {
                            "adjusted_price": arr[ii].adjusted_price
                        }
                    }
                }
            }
            itms.push(temp);
        }
        updateDB(itms);
    });
}

function updateDB(itms) {
    mongo.connect(svurl, function(err, client) {
        if (err) {
            console.log(err);
        } else {
            var db = client.db('eve-reactor');
            db.collection('items').bulkWrite(itms, { "ordered": true, writeConcern: {"w": 1} }, function(err, result) {
                if (err) console.log("update db " + err);
                console.log(result.modifiedCount);
                console.log("Items Updated!!");
                client.close();
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
        mongo.connect(svurl, function(err, client) {
            if (err) {
                console.log(err);
            } else {
                var db = client.db('eve-reactor');
                db.collection('history').insert(insert, function(err, result) {
                    console.log("Daily Added!!");
                    client.close();
                });
            }
        });
    });
}
