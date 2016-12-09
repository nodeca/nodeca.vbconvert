
## Useful database queries

Find most common errors when fetching urls:

```js
db.core.expandurls.aggregate({$match:{status:{$in:[3,4]}}},{$group:{_id:'$error',count:{$sum:1}}},{$sort:{count:-1}})
```

Find most common error codes during image fetch:

```js
db.vbconvert.imagefetchlogs.aggregate({$match:{status:{$in:[3,4]}}},{$group:{_id:'$error_code',count:{$sum:1}}},{$sort:{count:-1}})
```

Find out the most popular domains for image hosting (you can copy this script into a file, and run `mongo nodeca file.js` afterwards):

```js
var cursor = db.vbconvert.imagefetchlogs.find();

var stats = {};
var counter = 0;

var http = {};
var https = {};

while (cursor.hasNext()) {
  var obj = cursor.next();

  var m = obj.url.match(/\/\/(.*?)\//);

  if (m) {
    var d = m[1].replace(/^.*\.([^\.]*\.[^\.]*)$/, '$1');

    stats[d] = (stats[d] || 0) + 1;

    if (obj.url.match(/^https/)) {
      https[d] = (https[d] || 0) + 1;
    } else {
      http[d] = (http[d] || 0) + 1;
    }
  }
}

Object.keys(stats).sort(function (a, b) {
  return stats[b] - stats[a];
}).forEach(function (i) {
  if (stats[i] >= 100) {
    print(i + ': ' + stats[i] + ' (' + (https[i]||0) + ' https, ' + (http[i]||0) + ' http)');
  }
});

print('total domains: ', Object.keys(stats).length);
```

Find users with visually similar (homoglyphic) nicknames:

```js
db.users.users.aggregate([{$group:{_id:'$nick_normalized',sum:{$sum:1}}},{$match:{sum:{$ne:1}}},{$sort:{_id:1}}])
```
