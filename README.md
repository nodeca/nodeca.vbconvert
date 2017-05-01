nodeca.convert
==============

[![Greenkeeper badge](https://badges.greenkeeper.io/nodeca/nodeca.vbconvert.svg)](https://greenkeeper.io/)

[![Build Status](https://travis-ci.org/nodeca/nodeca.vbconvert.svg?branch=master)](https://travis-ci.org/nodeca/nodeca.vbconvert)

Convert forum database from vBulletin to Nodeca.

See details in `IMPORT.md`.


__Run tests for link mapping:__

```sh
NODECA_ENV=development ./server.js test nodeca.vbconvert
```

Link mapping tests are only run if you have a database with a real data. Otherwise (e.g. on travis) they are skipped entirely.
