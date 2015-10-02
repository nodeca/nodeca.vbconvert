'use strict';

exports.root = __dirname;
exports.name = 'nodeca.convert';
exports.init = function (N) { require('./lib/autoload.js')(N); };
