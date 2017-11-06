var mongo = require('mongodb');
var request = require('request');
var fs = require('fs');
var svurl = "mongodb://localhost:27017/eve-reactor";
var items = require('./items.json');
var marketUrl = "https://market.fuzzwork.co.uk/aggregates/?region=60003760&types=";
var testMarketUrl = "https://market.fuzzwork.co.uk/aggregates/?region=60003760&types=34,35,36";

addDaily();

function getItemID(name){
	for(let i=0;i<items.length;i++){
		if(items[i].NAME === name){
			return items[i].TypeID;
		}
	}
}

function getDate(){
	var today = new Date();
	var dd = today.getDate();
	var mm = today.getMonth()+1; //January is 0!

	var yyyy = today.getFullYear();
	if(dd<10){
	    dd='0'+dd;
	}
	if(mm<10){
	    mm='0'+mm;
	}
	var today = yyyy+'/'+mm+'/'+dd;
	return today;
}

function genItems(){
	let ids = "";
	for(let i=0;i<items.length;i++){
		ids += items[i].TypeID;
		ids += ",";
	}
	ids = ids.slice(0, -1);

	request(marketUrl + ids, function(err, res, body){
		let data = JSON.parse(body);
		let arr = []
		for(var prop in data){
			arr.push(data[prop]);
		}
		let itms = []
		console.log(arr.length);
		for(let i=0;i<arr.length;i++){
			console.log("for", i);
			let temp = {
				_id : parseInt(items[i].TypeID),
				"name": items[i].NAME,
				"sell": parseFloat(arr[i].sell.min),
				"buy": parseFloat(arr[i].buy.max),
				"med": ((parseFloat(arr[i].sell.min)+parseFloat(arr[i].buy.max))/2)
			}
			itms.push(temp);
		}
		//console.log("itms:\n",itms);
		mongo.connect(svurl, function(err, db){
			if(err){
				console.log(err);
			} else {
				db.collection('items').insertMany(itms, function(err, result){
					console.log("success!!");
				});
				db.close();
			}
		});
	});
}

function updateItems(){
	let ids = "";
	for(let i=0;i<items.length;i++){
		ids += items[i].TypeID;
		ids += ",";
	}
	ids = ids.slice(0, -1);

	request(marketUrl + ids, function(err, res, body){
		let data = JSON.parse(body);
		let arr = []
		for(var prop in data){
			arr.push(data[prop]);
		}
		let itms = []
		for(let i=0;i<arr.length;i++){
			let temp = {
				"updateOne" :{
					"filter":{
						_id:parseInt(items[i].TypeID)
					},
					"update": {
						"name": items[i].NAME,
						"sell": parseFloat(arr[i].sell.min),
						"buy": parseFloat(arr[i].buy.max),
						"med": ((parseFloat(arr[i].sell.min)+parseFloat(arr[i].buy.max))/2)
					}
				}
			}
			itms.push(temp);
		}
		//console.log("itms:\n",itms);
		mongo.connect(svurl, function(err, db){
			if(err){
				console.log(err);
			} else {
				let querry = {};
				db.collection('items').bulkWrite(itms, {"ordered": true, "w": 1}, function(err, result){
					if(err) throw err;
					console.log(result);
					console.log("success!!");
				});
				db.close();
			}
		});
	});
}

function addDaily(){
	let ids = "";
	for(let i=0;i<items.length;i++){
		ids += items[i].TypeID;
		ids += ",";
	}
	ids = ids.slice(0, -1);

	request(marketUrl + ids, function(err, res, body){
		let data = JSON.parse(body);
		let arr = []
		for(var prop in data){
			arr.push(data[prop]);
		}
		let itms = []
		for(let i=0;i<arr.length;i++){
			let temp = {
				_id : parseInt(items[i].TypeID),
				"name": items[i].NAME,
				"sell": parseFloat(arr[i].sell.min),
				"buy": parseFloat(arr[i].buy.max),
				"med": ((parseFloat(arr[i].sell.min)+parseFloat(arr[i].buy.max))/2)
			}
			itms.push(temp);
		}
		var insert = {
			"timestamp": getDate(),
			itms
		}
		mongo.connect(svurl, function(err, db){
			if(err){
				console.log(err);
			} else {
				db.collection('history').insert(insert, function(err, result){
					console.log("success!!");
				});
				db.close();
			}
		});
	});
}
