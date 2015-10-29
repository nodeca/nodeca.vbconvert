// TODO: move this to /test and switch to mocha

'use strict';

var assert   = require('assert');
var tokenize = require('./tokenize');
var to_html  = require('./format_html');
var to_md    = require('./format_md');

// do basic conversion
assert.equal(to_html(tokenize('[i]italic[/i] [B]bold[/B]')),
             '<i>italic</i> <b>bold</b>');

// fix overlapping tags
assert.equal(to_html(tokenize('[i]foo [b]bar[/i] baz[/b]')),
             '<i>foo <b>bar</b></i><b> baz</b>');

// remove unpaired opening tags
assert.equal(to_html(tokenize('[i]foo[/i][I]')),
             '<i>foo</i>[I]');

// remove unpaired closing tags
assert.equal(to_html(tokenize('[/I][i]foo[/i]')),
             '[/I]<i>foo</i>');

// process adjacent tags
assert.equal(to_html(tokenize('[i][b]foo[/b][/i]')),
             '<i><b>foo</b></i>');

// convert adjacent emphases to markdown
assert.equal(to_md(tokenize('[i][b]foo[/b][/i]')),
             '_**foo**_');

// convert lone emphases to markdown
assert.equal(to_md(tokenize('[i]foo [b]bar[/b] baz[/i]')),
             '_foo **bar** baz_');

// convert emphases inside strings
assert.equal(to_md(tokenize('xx[i]foo[b]bar[/b]baz[/i]xx')),
             'xx\u200A_foo\u200A**bar**\u200Abaz_\u200Axx');

// parse smilies
assert(to_html(tokenize('foo :P bar')).match(/tongue/));

// parse simple quotes
assert.equal(tokenize('[quote=foo bar]bzzz[/quote]')[0].param, 'foo bar');

// parse quotes #2
assert.equal(tokenize('[quote="foo bar"]bzzz[/quote]')[0].param, 'foo bar');

// parse quotes #3
assert.equal(tokenize('[quote=\'foo bar\']bzzz[/quote]')[0].param, 'foo bar');

// parse badly formatted quotes
assert.equal(tokenize('[quote="foo bar" ]bzzz[/quote]')[0].param, '"foo bar" ');

// parse badly formatted quotes #2
assert.equal(tokenize('[quote="foo bar" ]bzzz[/quote]')[0].param, '"foo bar" ');

// parse badly formatted quotes #3
assert.equal(tokenize('[quote ="foo bar"]bzzz[/quote]')[0].type, 'text');

// don't parse other tags inside quotes
assert.equal(tokenize('[quote="foo [i]bar[/i] baz"]bzzz[/quote]')[0].param, 'foo [i]bar[/i] baz');

// don't parse smilies inside quotes
assert.equal(tokenize('[quote="foo :) bar"]bzzz[/quote]')[0].param, 'foo :) bar');

// parse post references inside quote tag
assert.deepEqual(tokenize('[quote= user name; 1234 ]bzzz[/quote]')[0].replyto, [ 'user name', 1234 ]);

