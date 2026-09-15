"use strict";

/**
 * cloudinary_upload.js
 * Uploads a base64 image (as captured from WhatsApp) to Cloudinary and
 * returns its public URL, for storing as a plain text field in Airtable
 * (matching the image_url column pattern already used elsewhere).
 *
 * Required env vars (same names as your other Cloudinary-based project,
 * confirm they match — adjust if that project used different names):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
var cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

function uploadImageToCloudinary(base64Data, mimetype, filename) {
  var dataUri, result;
  return regeneratorRuntime.async(function uploadImageToCloudinary$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          dataUri = "data:".concat(mimetype, ";base64,").concat(base64Data);
          _context.next = 3;
          return regeneratorRuntime.awrap(cloudinary.uploader.upload(dataUri, {
            folder: 'whatsapp-leads',
            resource_type: 'image'
          }));

        case 3:
          result = _context.sent;
          return _context.abrupt("return", result.secure_url);

        case 5:
        case "end":
          return _context.stop();
      }
    }
  });
}

module.exports = {
  uploadImageToCloudinary: uploadImageToCloudinary
};