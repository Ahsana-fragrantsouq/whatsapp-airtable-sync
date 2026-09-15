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

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImageToCloudinary(base64Data, mimetype, filename) {
  const dataUri = `data:${mimetype};base64,${base64Data}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: 'whatsapp-leads',
    resource_type: 'image',
  });
  return result.secure_url;
}

module.exports = { uploadImageToCloudinary };