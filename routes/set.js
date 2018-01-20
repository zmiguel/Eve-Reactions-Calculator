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
        res.cookie('input', ck.input.toLowerCase(), { maxAge: 31556952000});
    } else {
        res.cookie('input', 'buy', { maxAge: 31556952000,   });
    }
    if (ck.output.toLowerCase() === "buy" || ck.output.toLowerCase() === "sell") {
        res.cookie('output', ck.output.toLowerCase(), { maxAge: 31556952000});
    } else {
        res.cookie('output', 'sell', { maxAge: 31556952000 });
    }
    if (parseInt(ck.skill) >= 0 && parseInt(ck.skill) <= 5) {
        res.cookie('skill', parseInt(ck.skill), { maxAge: 31556952000, });
    } else {
        res.cookie('skill', 5, { maxAge: 31556952000,   });
    }
    if (ck.facility.toLowerCase() === "med" || ck.facility.toLowerCase() === "large") {
        res.cookie('facility', ck.facility.toLowerCase(), { maxAge: 31556952000,   });
    } else {
        res.cookie('facility', 'large', { maxAge: 31556952000,   });
    }
    if (parseInt(ck.rigs) >= 0 && parseInt(ck.rigs) <= 2) {
        res.cookie('rig', parseInt(ck.rigs), { maxAge: 31556952000,   });
    } else {
        res.cookie('rig', 1, { maxAge: 31556952000,   });
    }
    if (ck.space.toLowerCase() === "low" || ck.space.toLowerCase() === "null") {
        res.cookie('space', ck.space.toLowerCase(), { maxAge: 31556952000,   });
    } else {
        res.cookie('space', 'null', { maxAge: 31556952000,   });
    }
    if (parseFloat(ck.indyTax) >= 0 && parseFloat(ck.indyTax) <= 50) {
        res.cookie('indyTax', parseFloat(ck.indyTax), { maxAge: 31556952000,   });
    } else {
        res.cookie('indyTax', 0, { maxAge: 31556952000,   });
    }
    if (parseInt(ck.duration) >= 1 && parseInt(ck.duration) <= 43200) {
        res.cookie('duration', parseInt(ck.duration), { maxAge: 31556952000,   });
    } else {
        res.cookie('duration', 10080, { maxAge: 31556952000,   });
    }
    if (ck.system) {
        var re = /^[a-zA-Z0-9-]+$/;
        if (re.test(ck.system)) {
            res.cookie('system', ck.system, { maxAge: 31556952000,   });
        } else {
            res.cookie('system', 'Basgerin', { maxAge: 31556952000,   });
        }
    }

    //reply
    res.redirect(302, '/settings');
    res.end();
});

router.get('/comp-adv/set', function(req, res, next) {

    let ck = req.query;

    if (parseInt(ck.cycles) >= 1 && parseInt(ck.cycles) <= 300) {
        res.cookie('cycles', parseInt(ck.cycles), { maxAge: 31556952000,   });
    } else {
        res.cookie('cyckes', 50, { maxAge: 31556952000,   });
    }

    let url = "/composite/" + ck.url.substr(1);

    //reply
    res.redirect(302, url);
    res.end();
});

router.get('/hyb-adv/set', function(req, res, next) {

    let ck = req.query;

    if (parseInt(ck.cycles) >= 1 && parseInt(ck.cycles) <= 300) {
        res.cookie('cycles', parseInt(ck.cycles), { maxAge: 31556952000,   });
    } else {
        res.cookie('cyckes', 50, { maxAge: 31556952000,   });
    }

    let url = "/hybrid/" + ck.url.substr(1);

    //reply
    res.redirect(302, url);
    res.end();
});

module.exports = router;