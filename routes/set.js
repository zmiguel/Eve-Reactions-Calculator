var express = require('express');
var router = express.Router();

/* GET settings page. */
router.get('/', function(req, res, next) {
    var ck = req.cookies;
    //reply
    res.render('set', { title: 'Settings', set: true, sett: ck });
});

router.get('/set', function(req, res, next) {

    let ck = req.query;

    if (ck.input.toLowerCase() === "buy" || ck.input.toLowerCase() === "sell") {
        res.cookie('input', ck.input.toLowerCase());
    } else {
        res.cookie('input', 'buy');
    }
    if (ck.output.toLowerCase() === "buy" || ck.output.toLowerCase() === "sell") {
        res.cookie('output', ck.output.toLowerCase());
    } else {
        res.cookie('output', 'sell');
    }
    if (parseInt(ck.skill) >= 0 && parseInt(ck.skill) <= 5) {
        res.cookie('skill', parseInt(ck.skill));
    } else {
        res.cookie('skill', 5);
    }
    if (ck.facility.toLowerCase() === "med" || ck.facility.toLowerCase() === "large") {
        res.cookie('facility', ck.facility.toLowerCase());
    } else {
        res.cookie('facility', 'large');
    }
    if (parseInt(ck.rig) >= 0 && parseInt(ck.rig) <= 2) {
        res.cookie('rig', parseInt(ck.rig));
    } else {
        res.cookie('rig', 1);
    }
    if (ck.space.toLowerCase() === "low" || ck.space.toLowerCase() === "null") {
        res.cookie('space', ck.space.toLowerCase());
    } else {
        res.cookie('space', 'null');
    }
    if (parseFloat(ck.indyTax) >= 0 && parseFloat(ck.indyTax) <= 50) {
        res.cookie('indyTax', parseFloat(ck.indyTax));
    } else {
        res.cookie('indyTax', 0);
    }
    if (parseInt(ck.duration) >= 1 && parseInt(ck.duration) <= 43200) {
        res.cookie('duration', parseInt(ck.duration));
    } else {
        res.cookie('duration', 10080);
    }
    if (ck.system) {
        res.cookie('system', ck.system);
    }

    //reply
    res.redirect(302, '/settings');
    res.end();
});

module.exports = router;