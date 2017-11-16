var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
    res.render('bio', { title: 'Biochemical Reactions', bio: true });
});


module.exports = router;