// Create asset of resized images in file store
//

'use strict';

// fallback for GIFs which aren't supported by sharp
var gm_resize = require('./resize_gm');

var _        = require('lodash');
var async    = require('async');
var fs       = require('fs');
var mimoza   = require('mimoza');
var Mongoose = require('mongoose');
var probe    = require('probe-image-size');
var Stream   = require('stream');
var sharp    = require('sharp');

var File;

// Limit amount of threads used for each image
sharp.concurrency(1);


// Read the stream and return { buffer, width, height, length }
// of the image inside.
//
function readImage(stream, callback) {
  callback = _.once(callback);

  var chunks = [];
  var length = 0;

  stream.on('error', function (err) {
    callback(err);
  });

  stream.on('data', function (chunk) {
    chunks.push(chunk);
    length += chunk.length;
  });

  stream.on('end', function () {
    var readStream = new Stream.Readable();
    var buffer = Buffer.concat(chunks, length);

    readStream._read = function () {
      this.push(buffer);
      this.push(null);
    };

    probe(readStream, function (err, imgSz) {
      if (err) {
        callback(err);
        return;
      }

      callback(null, {
        buffer: buffer,
        length: length,
        type:   imgSz.type,
        width:  imgSz.width,
        height: imgSz.height
      });
    });
  });
}


// Create preview for image
//
function createPreview(image, resizeConfig, imageType, callback) {
  // Is image size smaller than 'skip_size' - skip resizing
  if (resizeConfig.skip_size && image.length < resizeConfig.skip_size) {
    callback(null, { image: image, type: imageType });
    return;
  }

  var outType = resizeConfig.type || imageType;

  var gmInstance = sharp(image.buffer);

  // Set quality only for jpeg image
  if (outType === 'jpeg') {
    gmInstance.quality(resizeConfig.jpeg_quality).rotate();
  }

  if (resizeConfig.unsharp) {
    gmInstance.sharpen();
  }

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
  if (image.height <= scaledHeight) {
    scaledWidth = image.width;
    scaledHeight = image.height;
  }

  if (image.height === scaledHeight && image.width === scaledWidth) {
    // already scaled, skip it
    callback(null, { image: image, type: imageType });
    return;
  }

  gmInstance.resize(scaledWidth, scaledHeight).crop('center');

  // Save file
  gmInstance.toBuffer(function (err, buffer, info) {
    if (err) {
      callback(err);
      return;
    }

    callback(null, {
      image: {
        buffer: buffer,
        length: info.size,
        width:  info.width,
        height: info.height,
        type:   info.type
      },
      type: outType
    });
  });
}


// Save buffered images to database
//
function saveImages(previews, date, callback) {
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

      var image = data.image;

      File.put(image.buffer, params, function (err) {
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

  readImage(fs.createReadStream(src), function (err, origImage) {
    if (err) {
      callback(err);
      return;
    }

    if (origImage.type === 'gif' || origImage.type === 'bmp') {
      // fallback for file formats which aren't supported by sharp
      gm_resize(src, options, callback);
      return;
    }

    async.eachSeries(Object.keys(options.resize), function (resizeConfigKey, next) {
      // Create preview for each size

      var resizeConfig = options.resize[resizeConfigKey];

      // Next preview will be based on preview in 'from' property
      // by default next preview generated from 'orig'
      var from = (previews[resizeConfig.from || ''] || previews.orig || {});
      var image = from.image || origImage;

      createPreview(image, resizeConfig, from.type || options.ext, function (err, newImage) {
        if (err) {
          next(err);
          return;
        }

        previews[resizeConfigKey] = newImage;
        next();
      });
    }, function (err) {
      if (err) {
        callback(err);
        return;
      }

      // Save all previews
      saveImages(previews, options.date, function (err, origId) {
        if (err) {
          callback(err);
          return;
        }

        callback(null, {
          id: origId,
          size: previews.orig.image.length,
          images: _.map(previews, function (preview) {
            return {
              width:  preview.image.width,
              height: preview.image.height,
              length: preview.image.length
            };
          })
        });
      });
    });
  });
};
