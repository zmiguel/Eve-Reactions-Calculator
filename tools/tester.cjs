const bp_comp = require('./json/bp-comp.json');
const bp_bio = require('./json/bp-bio.json');
const bp_hyb = require('./json/bp-hybrid.json');

console.log('bp_comp ', JSON.stringify(bp_comp).replace(/"/g, "'"));
console.log("----------------------------------------");
console.log('bp_bio ', JSON.stringify(bp_bio).replace(/"/g, "'"));
console.log("----------------------------------------");
console.log('bp_hyb ', JSON.stringify(bp_hyb).replace(/"/g, "'"));
