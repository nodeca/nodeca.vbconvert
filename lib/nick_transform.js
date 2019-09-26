'use strict';

const regexp = /(?=.{2,})^=?[\p{L}\d]+(?:[-_=][\p{L}\d]+)*[#=]*$/u;

let rules = [];

rules.push([ n => n.replace(/\$+/, m => 'S'.repeat(m.length)), 10 ]);
rules.push([ n => n.replace(/^Ⓔⓤⓖⓔⓔ$/, 'Eugee'), 10 ]);
rules.push([ n => n.replace(/\][I|]\[|\}[I|]\{|\)[I|]\(/ug, 'Ж'), 10 ]);
rules.push([ n => n.replace(/\]\[|\}\{/ug, 'X'), 10 ]);
rules.push([ n => n.replace(/\(\)/ug, 'O'), 10 ]);
rules.push([ n => n.replace(/\|\{/ug, 'K'), 11 ]);
rules.push([ n => n.replace(/@/g, () => (n.indexOf('.') === -1 ? 'A' : '@')), 10 ]);
rules.push([ n => n.replace(/@[a-z0-9]+\.[a-z]*$/i, ''), 10 ]);
rules.push([ n => n.replace(/^&&&$/, 'AAA'), 10 ]);
rules.push([ n => n.replace(/^\^\^\^$/, 'aaa'), 10 ]);

rules.push([ n => n.replace(/^[^-_=\p{L}\d]+/ug, ''), 100 ]);
rules.push([ n => n.replace(/[^-_=\p{L}\d]+$/ug, ''), 1000 ]);

rules.push([ n => n.replace(/[^\$@\-_=\p{L}\d]/ug, '_'), 10000 ]);
rules.push([ n => n.replace(/[^\$@\-_=\p{L}\d]/ug, '-'), 11000 ]);
rules.push([ n => n.replace(/(\p{L}\d)[^\$@\-_=\p{L}\d](\p{L}\d)/ug, '$1=$2'), 12000 ]);

rules.push([ n => n.replace(/^[-_]+|[-_]+$/ug, ''), 100 ]);
rules.push([ n => n.replace(/[-_=]{2,}/ug, '_'), 1000 ]);
rules.push([ n => n.replace(/[-_=]{2,}/ug, '-'), 1100 ]);
rules.push([ n => n.replace(/[-_=]{2,}/ug, '='), 20000 ]);

rules.push([ n => n.replace(/$/, '='), 100000 ]);
rules.push([ n => n.replace(/$/, '#'), 110000 ]);
rules.push([ n => n.replace(/^(.*)$/, '=$1#'), 150000 ]);
rules.push([ n => n.replace(/^(.*)$/, '=$1='), 160000 ]);

rules = rules.sort((a, b) => a[1] - b[1]);

function valid(nick)     { return nick.match(regexp); }
function normalize(nick) { return nick.toUpperCase().toLowerCase(); }

function transform_nick(nick, nicks_seen, rules/*, debug = null*/) {
  let visited = new Set();

  let weights = new Map();
  weights.set(nick, 0);

  /*let paths;

  if (debug) {
    paths = new Map();
    paths.set(nick, []);
  }*/

  for (;;) {
    let min_entry = [ '', Infinity ];

    for (let entry of weights.entries()) {
      if (entry[1] >= min_entry[1]) continue;
      if (visited.has(entry[0])) continue;
      min_entry = entry;
    }

    let [ current_nick, current_weight ] = min_entry;
    let nick_norm = normalize(current_nick);

    if (valid(current_nick) && !nicks_seen.has(nick_norm)) {
      nicks_seen.add(nick_norm);
      //if (debug) return [ current_nick, current_weight, paths.get(current_nick) ];
      return current_nick;
    }

    for (let i = 0; i < rules.length; i++) {
      let [ fn, weight ] = rules[i];
      let new_nick = fn(current_nick);
      let new_weight = current_weight + weight;
      let existing_weight = weights.get(new_nick);

      if (typeof existing_weight === 'undefined' || new_weight < existing_weight) {
        weights.set(new_nick, new_weight);
        //if (debug) paths.set(new_nick, paths.get(current_nick).concat([ i ]));
      }
    }

    visited.add(current_nick);
  }
}

module.exports = transform_nick;

module.exports.valid     = valid;
module.exports.normalize = normalize;
module.exports.rules     = rules;
