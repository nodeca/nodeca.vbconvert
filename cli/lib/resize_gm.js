// Create asset of resized images in file store
//

'use strict';

var _        = require('lodash');
var async    = require('async');
var fs       = require('fs');
var gm       = require('gm');
var mimoza   = require('mimoza');
var Mongoose = require('mongoose');
var probe    = require('probe-image-size');
var Stream   = require('stream');
var util     = require('util');

var File;


function ReadStream(chunks) {
  Stream.Readable.call(this);
  this.chunks = chunks.slice(0);
}

util.inherits(ReadStream, Stream.Readable);

ReadStream.prototype._read = function () {
  this.push(this.chunks.shift() || null);
};


function WriteStream() {
  Stream.Transform.call(this);
  this.image = [];
  this.image.size = 0;
  this.image.width = NaN;
  this.image.height = NaN;

  var self = this;

  probe(self, function (err, imgSz) {
    if (err) {
      self.emit('error', err);
      return;
    }

    self.image.width  = imgSz.width;
    self.image.height = imgSz.height;
  });
}

util.inherits(WriteStream, Stream.Transform);

WriteStream.prototype._transform = function (chunk, encoding, callback) {
  if (chunk) {
    this.image.push(chunk);
    this.image.size += chunk.length;
  }

  callback(null, chunk);
};


// Create preview for image
//
function createPreview(image, resizeConfig, imageType, callback) {
  var outType = resizeConfig.type || imageType;
  var path = 'file.' + imageType;

  // If animation not allowed - take first frame of gif image
  path = (imageType === 'gif' && resizeConfig.gif_animation === false) ? path + '[0]' : path;

  var gmInstance = gm(new ReadStream(image), path);

  // Limit amount of threads used
  gmInstance.limit('threads', 1);

  // Set quality only for jpeg image
  if (outType === 'jpeg') {
    gmInstance.quality(resizeConfig.jpeg_quality).autoOrient();
  }

  if (resizeConfig.unsharp) {
    gmInstance.unsharp('0');
  }

  // Is image size smaller than 'skip_size' - skip resizing
  if (resizeConfig.skip_size && image.size < resizeConfig.skip_size) {
    callback(null, { image: image, type: imageType });
    return;
  }

  gmInstance.gravity('Center');

  // To scale image we calculate new width and height, resize image by height and crop by width
  var scaledHeight, scaledWidth;

  if (resizeConfig.height && !resizeConfig.width) {
    // If only height defined - scale to fit height,
    // and crop by max_width
    scaledHeight = resizeConfig.height;
    var proportionalWidth = Math.floor(image.width * scaledHeight / image.height);
    scaledWidth = (!resizeConfig.max_width || resizeConfig.max_width > proportionalWidth) ?
      proportionalWidth :
      resizeConfig.max_width;

  } else if (!resizeConfig.height && resizeConfig.width) {
    // If only width defined - scale to fit width,
    // and crop by max_height
    scaledWidth = resizeConfig.width;
    var proportionalHeight = Math.floor(image.height * scaledWidth / image.width);
    scaledHeight = (!resizeConfig.max_height || resizeConfig.max_height > proportionalHeight) ?
      proportionalHeight :
      resizeConfig.max_height;

  } else {
    // If determine both width and height
    scaledWidth = resizeConfig.width;
    scaledHeight = resizeConfig.height;
  }

  // Don't resize (only crop) image if height smaller than scaledHeight
  if (image.height > scaledHeight) {
    gmInstance.resize(null, scaledHeight);
  }

  gmInstance.crop(scaledWidth, scaledHeight);

  // Save file
  gmInstance.stream(function (err, stdout /*, stderr*/) {
    if (err) {
      callback(err);
      return;
    }

    var stream = new WriteStream();

    stdout.pipe(stream);
    stdout.on('end', function () {
      callback(null, { image: stream.image, type: outType });
    });
  });
}


// Save files to database
//
function saveFiles(previews, date, callback) {
  // Create new ObjectId for orig file.
  // You can get file_id from put function, but all previews save async.
  var origId = new Mongoose.Types.ObjectId(date);

  async.each(
    Object.keys(previews),
    function (key, next) {
      var data = previews[key];

      var params = { contentType: mimoza.getMimeType(data.type) };

      if (key === 'orig') {
        params._id = origId;
      } else {
        params.filename = origId + '_' + key;
      }

      File.put(new ReadStream(data.image), params, function (err) {
        next(err);
      });
    },
    function (err) {
      if (err) {
        callback(err);
        return;
      }

      callback(null, origId);
    }
  );
}


module.exports = function (src, options, callback) {
  File = options.store;

  var previews = {};
  var origStream = new WriteStream();

  fs.createReadStream(src).pipe(origStream);

  origStream.on('end', function () {
    var origImage = origStream.image;

    async.eachSeries(Object.keys(options.resize), function (resizeConfigKey, next) {
      // Create preview for each size

      var resizeConfig = options.resize[resizeConfigKey];

      // Next preview will be based on preview in 'from' property
      // by default next preview generated from 'orig'
      var from = (previews[resizeConfig.from || ''] || previews.orig || {});
      var image = from.image || origImage;

      createPreview(image, resizeConfig, from.type || options.ext, function (err, data) {
        if (err) {
          next(err);
          return;
        }

        previews[resizeConfigKey] = data;
        next();
      });
    }, function (err) {
      if (err) {
        callback(err);
        return;
      }

      // Save all previews
      saveFiles(previews, options.date, function (err, origId) {
        if (err) {
          callback(err);
          return;
        }

        var images = {};
        _.forEach(previews, function (val, key) {
          images[key] = val.size;
        });

        callback(null, {
          id: origId,
          size: previews.orig.image.size,
          images: _.map(previews, function (preview) {
            return {
              width:  preview.image.width,
              height: preview.image.height,
              length: preview.image.size
            };
          })
        });
      });
    });
  });
};
