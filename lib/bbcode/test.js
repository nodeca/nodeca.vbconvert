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

// parse empty quote
assert.equal(tokenize('[quote=]bzzz[/quote]')[0].param, '');

// parse empty quote
assert.equal(tokenize('[quote=""]bzzz[/quote]')[0].param, '');

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

// attach pairs properly
assert.equal(tokenize('[quote=blah]bzzz[/quote]')[2].peer.param, 'blah');

// remove empty tags
assert.equal(to_html(tokenize('foo [i][b][/b][/i] bar')), 'foo  bar');

// remove empty overlapping tags
assert.equal(to_html(tokenize('foo [i][b][/i][/b] bar')), 'foo  bar');

// remove empty overlapping tags #2
assert.equal(to_html(tokenize('foo [i][b][/i]bar[/b] baz')), 'foo <b>bar</b> baz');

// don't blow up on empty input
assert.equal(to_html(tokenize('')), '');

// render nested quotes with params
assert.equal(to_md(tokenize('[quote=1]foo[quote=2]bar[quote=3]baz[/quote]bar[/quote]foo[/quote]xxx')),
             '`````quote 1\nfoo\n\n````quote 2\nbar\n\n```quote 3\nbaz\n```\n\nbar\n````\n\nfoo\n`````\n\nxxx');

// render nested quotes without params
assert.equal(to_md(tokenize('[quote]foo[quote]bar[quote]baz[/quote]bar[/quote]foo[/quote]xxx')),
             ' > foo\n > \n > > bar\n > > \n > > > baz\n > > \n > > bar\n > \n > foo\n\nxxx');

// render old converted quotes
assert.equal(to_md(tokenize('[quote][b]test (12-12-2000 12:34):[/b]\ntest[/quote]')),
             '```quote test (12-12-2000 12:34)\ntest\n```\n');

// escape text
assert.equal(to_md(tokenize('[foo](bar)')), '\\[foo\\](bar)');

// ignore block tags inside inlines
assert.equal(to_md(tokenize('[b][left]foo[/left][/b]')), '**foo**');

// format newlines
assert.equal(to_md(tokenize('foo\nbar\n\nbaz')), 'foo  \nbar\n\nbaz');

// render urls
assert.equal(to_md(tokenize('[url=http://blah]foobar[/url]')), '[foobar](http://blah)');

// render param-less urls
assert.equal(to_md(tokenize('[url]http://blah[/url]')), '<http://blah>');

// avoid links inside other links
assert.equal(to_md(tokenize('[url="url1"]foo [url="url2"]bar[/url] baz[/url]')), '[foo ](url1)[bar](url2) baz');

// render images
assert.equal(to_md(tokenize('[img]http://blah[/img]')), '![](<http://blah>)');

// don't render weird protocols
assert.equal(to_md(tokenize('[img]ftp://blah[/img]')), '\\[img\\]ftp://blah\\[/img\\]');

// weird case, see post 1492423
assert.equal(to_md(tokenize('[img]http://foo] [url=blah[/img]')), '![](<http://foo]%20[url=blah>)');

// render emails (spaces are trimmed)
assert.equal(to_md(tokenize('[email] test@example.com [/email]')), '<mailto:test@example.com>');

// don't parse invalid emails
assert.equal(to_md(tokenize('[email][b]boo[/b][/email]')), '**boo**');

// parse lists
assert.equal(to_md(tokenize('[list]\nfoo\n[*] \n[*] bar\nbaz\n[/list]')), ' - foo\n - bar  \n   baz\n');

// parse numeric lists
assert.equal(to_md(tokenize('[list=1]\nfoo\n[*] \n[*] bar\nbaz\n[/list]')), ' 1. foo\n 2. bar  \n    baz\n');

// accept font with params
assert.equal(to_md(tokenize('[font=123]test[/font]')), 'test');

// reject font without params
assert.equal(to_md(tokenize('[font]test[/font]')), '\\[font\\]test\\[/font\\]');
