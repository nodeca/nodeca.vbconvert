
'use strict';

var assert   = require('assert');
var tokenize = require('../lib/bbcode/tokenize');
var to_html  = require('../lib/bbcode/format_html');
var to_md    = require('../lib/bbcode/format_md');


describe('BBcode', function () {
  it('do basic conversion', function () {
    assert.equal(to_html(tokenize('[i]italic[/i] [B]bold[/B]')),
                 '<i>italic</i> <b>bold</b>');
  });

  it('fix overlapping tags', function () {
    assert.equal(to_html(tokenize('[i]foo[b]bar[/i]baz[/b]')),
                 '<i>foo<b>bar</b></i><b>baz</b>');
  });

  it('remove unpaired opening tags', function () {
    assert.equal(to_html(tokenize('[i]foo[/i][I]')),
                 '<i>foo</i>[I]');
  });

  it('remove unpaired closing tags', function () {
    assert.equal(to_html(tokenize('[/I][i]foo[/i]')),
                 '[/I]<i>foo</i>');
  });

  it('process adjacent tags', function () {
    assert.equal(to_html(tokenize('[i][b]foo[/b][/i]')),
                 '<i><b>foo</b></i>');
  });

  it('convert adjacent emphases to markdown', function () {
    assert.equal(to_md(tokenize('[i][b]foo[/b][/i]')),
                 '_**foo**_');
  });

  it('convert lone emphases to markdown', function () {
    assert.equal(to_md(tokenize('[i]foo [b]bar[/b] baz[/i]')),
                 '_foo **bar** baz_');
  });

  it('convert emphases inside strings', function () {
    assert.equal(to_md(tokenize('xx[i]foo[b]bar[/b]baz[/i]xx')),
                 'xx\u200A_foo\u200A**bar**\u200Abaz_\u200Axx');
  });

  it('convert emphases - newlines', function () {
    assert.equal(to_md(tokenize('\n[b]\nfoo\n[/b]\n')),
                 '**\u200B  \nfoo  \n\u200B**');
  });

  it('convert emphases inside strings #2', function () {
    assert.equal(to_md(tokenize('xx[b][b]foo[/b][/b]xx')),
                 'xx\u200A****foo****\u200Axx');
  });

  it('parse smilies', function () {
    assert.equal(to_md(tokenize('foo :wub: bar'), {
      smileys: TEST.N.config.vbconvert.smiley_map
    }), 'foo :heart_eyes: bar');
  });

  it('parse empty quote #1', function () {
    assert.equal(tokenize('[quote=]bzzz[/quote]')[0].param, '');
  });

  it('parse empty quote #2', function () {
    assert.equal(tokenize('[quote=""]bzzz[/quote]')[0].param, '');
  });

  it('parse simple quotes', function () {
    assert.equal(tokenize('[quote=foo bar]bzzz[/quote]')[0].param, 'foo bar');
  });

  it('parse quotes #2', function () {
    assert.equal(tokenize('[quote="foo bar"]bzzz[/quote]')[0].param, 'foo bar');
  });

  it('parse quotes #3', function () {
    assert.equal(tokenize('[quote=\'foo bar\']bzzz[/quote]')[0].param, 'foo bar');
  });

  it('parse badly formatted quotes #1', function () {
    assert.equal(tokenize('[quote="foo bar" ]bzzz[/quote]')[0].param, '"foo bar" ');
  });

  it('parse badly formatted quotes #2', function () {
    assert.equal(tokenize('[quote="foo bar" ]bzzz[/quote]')[0].param, '"foo bar" ');
  });

  it('parse badly formatted quotes #3', function () {
    assert.equal(tokenize('[quote ="foo bar"]bzzz[/quote]')[0].type, 'text');
  });

  it("don't parse other tags inside quotes", function () {
    assert.equal(tokenize('[quote="foo [i]bar[/i] baz"]bzzz[/quote]')[0].param, 'foo [i]bar[/i] baz');
  });

  it("don't parse smilies inside quotes", function () {
    assert.equal(tokenize('[quote="foo :) bar"]bzzz[/quote]')[0].param, 'foo :) bar');
  });

  it('attach pairs properly', function () {
    assert.equal(tokenize('[quote=blah]bzzz[/quote]')[2].peer.param, 'blah');
  });

  it('remove empty tags', function () {
    assert.equal(to_html(tokenize('foo [i][b][/b][/i] bar')), 'foo  bar');
  });

  it('remove empty overlapping tags', function () {
    assert.equal(to_html(tokenize('foo [i][b][/i][/b] bar')), 'foo  bar');
  });

  it('remove empty overlapping tags #2', function () {
    assert.equal(to_html(tokenize('foo [i][b][/i]bar[/b] baz')), 'foo <b>bar</b> baz');
  });

  it('shift spaces in emphasis', function () {
    assert.equal(to_md(tokenize('[i] foo [/i] [b] bar [/b]')), '_foo_ **bar**');
  });

  it('bubble up block tags', function () {
    assert.equal(to_md(tokenize('[b]foo[quote]bar[/quote]baz[/b]')),
                 '**foo**\n\n> **bar**\n\n**baz**');
  });

  it('bubble up list elements', function () {
    assert.equal(to_md(tokenize('[list][b]foo[*]bar[/b][*]baz[/list]')),
                 '- **foo**\n- **bar**\n- baz');
  });

  it('bubble up list elements #2', function () {
    assert.equal(to_md(tokenize('[b]foo[*]bar[*]baz[/b]')),
                 '**foo\\[\\*\\]bar\\[\\*\\]baz**');
  });

  it('bubble up paragraphs', function () {
    assert.equal(to_md(tokenize('[b]foo\n\nbar[/b]')),
                 '**foo**\n\n**bar**');
  });

  it("don't blow up on empty input", function () {
    assert.equal(to_html(tokenize('')), '');
  });

  it('render nested quotes with params', function () {
    assert.equal(to_md(tokenize('[quote=1]foo[quote=2]bar[quote=3]baz[/quote]bar[/quote]foo[/quote]xxx')),
                 '`````quote 1\nfoo\n\n````quote 2\nbar\n\n```quote 3\nbaz\n```\n\nbar\n````\n\nfoo\n`````\n\nxxx');
  });

  it('render nested quotes without params', function () {
    assert.equal(to_md(tokenize('[quote]foo[quote]bar[quote]baz[/quote]bar[/quote]foo[/quote]xxx')),
                 '> foo\n> \n> > bar\n> > \n> > > baz\n> > \n> > bar\n> \n> foo\n\nxxx');
  });

  it('render old converted quotes', function () {
    assert.equal(to_md(tokenize('[quote][b]test (12-12-2000 12:34):[/b]\ntest[/quote]')),
                 '```quote test (12-12-2000 12:34)\ntest\n```');
  });

  it('render post references inside quote tag', function () {
    assert.deepEqual(to_md(tokenize('[quote= user name; 1234 ]bzzz[/quote]'), {
      posts: { 1234: 'http://example.org/' }
    }), 'http://example.org/\n> bzzz');
  });

  it('skip bbcode inside code blocks', function () {
    assert.deepEqual(to_md(tokenize('[code] test [b]foo[/b] [code]bar[/code] quux [/code]')),
                     '```\n test foo bar quux \n```');
  });

  it('leave newlines as is inside code blocks', function () {
    assert.deepEqual(to_md(tokenize('before\n\n\n[code]foo\n   bar\n\n   baz\n\n\nquux[/code]\n\n\n\nafter\n\n\n\n')),
                     'before\n\n```\nfoo\n   bar\n\n   baz\n\n\nquux\n```\n\nafter');
  });

  it("don't render smilies inside code blocks", function () {
    assert.deepEqual(tokenize('[code]:)[code]:)[/code]:)[/code]').filter(function (token) {
      return token.type === 'smiley';
    }), []);
  });

  it('render spoilers', function () {
    assert.deepEqual(to_md(tokenize('[spoiler=test]bzzz[/spoiler]')),
                     '```spoiler test\nbzzz\n```');
  });

  it('escape text', function () {
    assert.equal(to_md(tokenize('[foo](bar)')), '\\[foo\\](bar)');
  });

  it('escape block tags', function () {
    assert.equal(to_md(tokenize('foo\n-------')),
                 'foo  \n\\-\\-\\-\\-\\-\\-\\-');
  });

  it('avoid unintended lists', function () {
    assert.equal(to_md(tokenize('1. foo\n2. bar')),
                 '1\\. foo  \n2\\. bar');
  });

  it('avoid unintended code blocks', function () {
    assert.equal(to_md(tokenize('    foo\n')),
                 'foo');
  });

  it('ignore block tags inside inlines', function () {
    assert.equal(to_md(tokenize('[b][left]foo[/left][/b]')), '**foo**');
  });

  it('replace spaces in superscript', function () {
    assert.equal(to_md(tokenize('[sup]one two three[/sup]')), '^one\\ two\\ three^');
  });

  it('format newlines', function () {
    assert.equal(to_md(tokenize('foo\nbar\n\nbaz')), 'foo  \nbar\n\nbaz');
  });

  it('render urls', function () {
    assert.equal(to_md(tokenize('[url=http://blah]foobar[/url]')), '[foobar](http://blah)');
  });

  it('escape urls', function () {
    assert.equal(to_md(tokenize('[url=http://test/ ()?1]foobar[/url]')), '[foobar](http://test/%20%28%29?1)');
  });

  it('render protocol-less urls #1', function () {
    assert.equal(to_md(tokenize('[url]www.foo.bar[/url]')), '<http://www.foo.bar>');
  });

  it('render protocol-less urls #2', function () {
    assert.equal(to_md(tokenize('[url=www.foo.bar]www.foo.bar[/url]')), '<http://www.foo.bar>');
  });

  it("don't render banned links", function () {
    assert.equal(to_md(tokenize('[url]www.*****.bar[/url]')), 'www.\\*\\*\\*\\*\\*.bar');
  });

  it('render param-less urls', function () {
    assert.equal(to_md(tokenize('[url]http://blah[/url]')), '<http://blah>');
  });

  it('avoid links inside other links', function () {
    assert.equal(to_md(tokenize('[url="url1"]foo [url="url2"]bar[/url] baz[/url]')),
                 '[foo ](http://url1)[bar](http://url2) baz');
  });

  it('render images', function () {
    assert.equal(to_md(tokenize('[img]http://blah[/img]')), '![](http://blah)');
  });

  it("don't render weird protocols", function () {
    assert.equal(to_md(tokenize('[img]ftp://blah[/img]')), '\\[img\\]ftp://blah\\[/img\\]');
  });

  it('weird case, see post 1492423', function () {
    assert.equal(to_md(tokenize('[img]http://foo] [url=blah[/img]')), '![](http://foo]%20[url=blah)');
  });

  it('render emails (spaces are trimmed)', function () {
    assert.equal(to_md(tokenize('[email] test@example.com [/email]')), '<mailto:test@example.com>');
  });

  it("don't parse invalid emails", function () {
    assert.equal(to_md(tokenize('[email][b]boo[/b][/email]')), '**boo**');
  });

  it('parse lists', function () {
    assert.equal(to_md(tokenize('[list]\nfoo\n[*] \n[*] bar\nbaz\n[/list]')), '- foo\n- bar  \n  baz');
  });

  it('parse numeric lists', function () {
    assert.equal(to_md(tokenize('[list=1]\nfoo\n[*] \n[*] bar\nbaz\n[/list]')), '1. foo\n2. bar  \n   baz');
  });

  it('parse nested lists', function () {
    assert.equal(to_md(tokenize('[list=1]\nfoo\n[*]\n[list=1]\nbar\n[*]\nbaz\n[/list]\nquux\n[/list]')),
                 '1. foo\n2. 1. bar\n   2. baz\n   \n   quux');
  });

  it("don't parse list item in text", function () {
    assert.equal(to_md(tokenize('foo[*]bar')), 'foo\\[\\*\\]bar');
  });

  it('accept font with params', function () {
    assert.equal(to_md(tokenize('[font=123]test[/font]')), 'test');
  });

  it('reject font without params', function () {
    assert.equal(to_md(tokenize('[font]test[/font]')), '\\[font\\]test\\[/font\\]');
  });

  it('parse thread tag without params', function () {
    assert.equal(to_md(tokenize('[thread]123[/thread]'), {
      topics: { 123: 'http://example.org/123' }
    }), 'http://example.org/123');
  });

  it('parse thread tag with params', function () {
    assert.equal(to_md(tokenize('[thread=123]whatever[/thread]'), {
      topics: { 123: 'http://example.org/123' }
    }), '[whatever](http://example.org/123)');
  });

  it("don't parse invalid thread tag", function () {
    assert.equal(to_md(tokenize('[thread]whatever[/thread]'), {
      topics: { 123: 'http://example.org/123' }
    }), '\\[thread\\]whatever\\[/thread\\]');
  });

  it("render it as text if thread doesn't exist", function () {
    assert.equal(to_md(tokenize('[thread=0]whatever[/thread]'), {
      topics: { 123: 'http://example.org/123' }
    }), 'whatever');
  });

  it('corner case in thread parsing', function () {
    assert.equal(to_html(tokenize('[thread="[i]"]test[/i][/thread]')),
                '[thread=&quot;<i>&quot;]test</i>[/thread]');
  });

  it('render video tags as blocks', function () {
    assert.equal(to_md(tokenize('foo[video]http://example.com[/video]bar')),
                'foo\n\nhttp://example.com\n\nbar');
  });
});
