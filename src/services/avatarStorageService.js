const { BlobServiceClient } = require('@azure/storage-blob');
const crypto = require('crypto');
const path = require('path');
const AppError = require('../utils/AppError');

const connectionString =
  process.env.EXAMPO_AZURE_STORAGE_CONNECTION_STRING ||
  process.env.AZURE_STORAGE_CONNECTION_STRING;

const containerName =
  process.env.EXAMPO_AZURE_STORAGE_CONTAINER_NAME ||
  process.env.AZURE_STORAGE_CONTAINER_NAME ||
  'avatars';

let containerClient;

const getContainerClient = () => {
  if (!connectionString) throw new AppError(500, 'Azure storage is not configured');
  if (!containerClient) {
    containerClient = BlobServiceClient
      .fromConnectionString(connectionString)
      .getContainerClient(containerName);
  }
  return containerClient;
};

const extensionFor = (contentType, originalName = '') => {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  const fromName = path.extname(String(originalName || '')).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.bmp', '.heic', '.heif', '.tif', '.tiff']);
  if (allowedExtensions.has(fromName)) return fromName;
  if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/svg+xml') return '.svg';
  return '.img';
};

const blobNameFromPublicUrl = (publicUrl) => {
  if (!publicUrl) return '';
  try {
    const container = getContainerClient();
    const containerUrl = new URL(container.url);
    const avatarUrl = new URL(publicUrl);
    const containerPath = containerUrl.pathname.endsWith('/')
      ? containerUrl.pathname.slice(0, -1)
      : containerUrl.pathname;
    if (avatarUrl.origin !== containerUrl.origin) return '';
    if (!avatarUrl.pathname.startsWith(`${containerPath}/`)) return '';
    return decodeURIComponent(avatarUrl.pathname.slice(containerPath.length + 1));
  } catch (_) {
    return '';
  }
};

exports.uploadAvatarBuffer = async ({ userId, buffer, contentType, originalName }) => {
  const container = getContainerClient();
  const extension = extensionFor(contentType, originalName);
  const blobName = `${userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return { avatarUrl: blockBlob.url, blobName };
};

exports.deleteAvatarIfOwned = async (publicUrl) => {
  const blobName = blobNameFromPublicUrl(publicUrl);
  if (!blobName) return;
  try {
    await getContainerClient().deleteBlob(blobName, { deleteSnapshots: 'include' });
  } catch (_) {
    // Keep avatar replacement successful even if cleanup cannot delete the old blob.
  }
};
