var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
    //set cookies if not found
    var ck = req.cookies;
    if (!ck.input) { res.cookie('input', 'buy'); var imeth = "buy"; }
    if (!ck.output) { res.cookie('output', 'sell'); var ometh = "sell"; }
    if (!ck.skill) { res.cookie('skill', 5); var skill = 5; }
    if (!ck.facility) { res.cookie('facility', 'large'); var facility = "large"; }
    if (!ck.rig) { res.cookie('rig', 1); var rig = 1; var rige = true; }
    if (!ck.space) { res.cookie('space', 'null'); var space = "null"; }
    if (!ck.indyTax) { res.cookie('indyTax', 0); var indyTax = 0; }
    if (!ck.duration) { res.cookie('duration', 10080); var duration = 10080; }
    if (!ck.system) { res.cookie('system', 'Basgerin'); var syst = "Basgerin" }
    //reply
    res.render('index', { title: 'EVE Reactions Calculator', root: true });
});

module.exports = router;