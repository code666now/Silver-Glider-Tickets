const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dhvavjgnw',
  api_key: process.env.CLOUDINARY_API_KEY || '795317828447263',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'kD-ce1L--xqjetAU63vux8Oui70'
});

async function uploadImage(buffer, folder = 'silver-glider-activations') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto', fetch_format: 'auto' }] },
      (error, result) => { if (error) reject(error); else resolve(result); }
    );
    Readable.from(buffer).pipe(stream);
  });
}

module.exports = { uploadImage };
