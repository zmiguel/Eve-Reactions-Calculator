var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
    //set cookies if not found
    var ck = req.cookies;
    if (!ck.input) { res.cookie('input', 'buy', { maxAge: 31556952000,  }); var imeth = "buy"; }
    if (!ck.output) { res.cookie('output', 'sell', { maxAge: 31556952000,  }); var ometh = "sell"; }
    if (!ck.skill) { res.cookie('skill', 5, { maxAge: 31556952000,  }); var skill = 5; }
    if (!ck.facility) { res.cookie('facility', 'large', { maxAge: 31556952000,  }); var facility = "large"; }
    if (!ck.rig) { res.cookie('rig', 1, { maxAge: 31556952000,  }); var rig = 1; var rige = true; }
    if (!ck.space) { res.cookie('space', 'null', { maxAge: 31556952000,  }); var space = "null"; }
    if (!ck.indyTax) { res.cookie('indyTax', 0, { maxAge: 31556952000,  }); var indyTax = 0; }
    if (!ck.duration) { res.cookie('duration', 10080, { maxAge: 31556952000,  }); var duration = 10080; }
    if (!ck.system) { res.cookie('system', 'Basgerin', { maxAge: 31556952000,  }); var syst = "Basgerin" }
    //reply
    res.render('index', { title: 'EVE Reactions Calculator', root: true });
});

module.exports = router;