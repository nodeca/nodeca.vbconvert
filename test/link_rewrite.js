
'use strict';


const _        = require('lodash');
const assert   = require('assert');
const fs       = require('fs');
const glob     = require('glob').sync;
const yaml     = require('js-yaml');
const path     = require('path');
const url      = require('url');
const rewriter = require('../lib/link_rewrite');


describe('link_rewrite', function () {
  let have_mappings = false;
  let N = TEST.N;

  before(function (callback) {
    N.models.vbconvert.FileMapping.count(function (err, filecount) {
      if (err) {
        callback(err);
        return;
      }

      N.models.vbconvert.PostMapping.count(function (err, postcount) {
        if (err) {
          callback(err);
          return;
        }

        have_mappings = filecount > 710000 && postcount > 5800000;
        callback();
      });
    });
  });

  before(function () {
    let root = path.join(__dirname, 'fixtures');
    let link_rewrite = rewriter(N);

    glob('**/*.yml', { cwd: root })
      .sort()
      .forEach(file => {
        describe('link_rewrite - ' + file, function () {
          let filename = path.join(root, file);

          /* eslint-disable max-nested-callbacks */
          yaml.safeLoad(fs.readFileSync(filename, 'utf8'), { filename }).forEach(entry => {
            (have_mappings ? it : it.skip)(entry[0], done => {
              link_rewrite(entry[0], function (err, link) {
                assert(!err);

                // change domain to make it independent from config
                let u = url.parse(N.router.linkTo(link.apiPath, link.params));

                u.protocol = 'https:';
                u.host = 'dev.rcopen.com';
                u.hash = link.hash;

                // replace X with hex characters, needed for objectids
                if (entry[1].indexOf('X') !== -1) {
                  let reg = new RegExp(_.escapeRegExp(entry[1]).replace(/X/g, '[a-fA-F0-9]'));

                  if (url.format(u).match(reg)) {
                    done();
                    return;
                  }
                }

                assert.equal(url.format(u), entry[1]);

                done();
              });
            });
          });
        });
      });
  });

  it('check links', function () {
    // force before() to execute to dynamically generate tests
    // https://github.com/mochajs/mocha/issues/1483#issuecomment-192479099
  });
});
