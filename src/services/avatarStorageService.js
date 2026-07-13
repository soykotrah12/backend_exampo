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

const assertValidConnectionString = () => {
  if (!connectionString || typeof connectionString !== 'string') {
    throw new AppError(500, 'Azure storage is not configured');
  }
  const isConnectionStringValid =
    connectionString.includes('DefaultEndpointsProtocol=') &&
    connectionString.includes('AccountName=') &&
    connectionString.includes('AccountKey=') &&
    connectionString.includes('EndpointSuffix=');
  if (!isConnectionStringValid) {
    throw new AppError(500, 'Azure storage connection string is invalid');
  }
};

const getContainerClient = () => {
  console.log('[avatar-storage] configuration', {
    hasExampoConnectionString: Boolean(process.env.EXAMPO_AZURE_STORAGE_CONNECTION_STRING),
    hasAzureConnectionString: Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING),
    resolvedConnectionString: Boolean(connectionString),
    containerName,
  });
  assertValidConnectionString();
  if (!containerClient) {
    try {
      const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      containerClient = blobServiceClient.getContainerClient(containerName);
    } catch (error) {
      console.error('[avatar-storage] client creation failed', {
        message: error.message,
        code: error.code,
      });
      throw new AppError(500, 'Azure storage connection string is invalid');
    }
  }
  return containerClient;
};

const safeFileNameFor = (contentType, originalName = '') => {
  const rawName = path.basename(String(originalName || '')).replace(/[^a-zA-Z0-9._-]/g, '-');
  const baseName = rawName.replace(/\.+/g, '.').replace(/^-+|-+$/g, '');
  const extensionFromName = path.extname(baseName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const nameWithoutExtension = path.basename(baseName, extensionFromName).replace(/[^a-zA-Z0-9_-]/g, '-');
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.bmp', '.heic', '.heif', '.tif', '.tiff']);
  let extension = allowedExtensions.has(extensionFromName) ? extensionFromName : '.img';
  if (type === 'image/jpeg' || type === 'image/jpg') extension = '.jpg';
  if (type === 'image/png') extension = '.png';
  if (type === 'image/webp') extension = '.webp';
  if (type === 'image/gif') extension = '.gif';
  if (type === 'image/svg+xml') extension = '.svg';
  return `${nameWithoutExtension || 'avatar'}${extension}`;
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
  const safeFileName = `${crypto.randomUUID()}-${safeFileNameFor(contentType, originalName)}`;
  const blobName = `${userId}-${Date.now()}-${safeFileName}`;
  const blockBlob = container.getBlockBlobClient(blobName);
  console.info('[avatar-storage] uploading blob', {
    containerName,
    blobName,
    contentType,
    size: buffer.length,
  });
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return { avatarUrl: blockBlob.url, blobName };
};

exports.uploadAvatarFile = async ({ userId, file }) => exports.uploadAvatarBuffer({
  userId,
  buffer: file.buffer,
  contentType: file.mimetype,
  originalName: file.originalname,
});

exports.deleteAvatarIfOwned = async (publicUrl) => {
  const blobName = blobNameFromPublicUrl(publicUrl);
  if (!blobName) return;
  try {
    await getContainerClient().deleteBlob(blobName, { deleteSnapshots: 'include' });
  } catch (_) {
    // Keep avatar replacement successful even if cleanup cannot delete the old blob.
  }
};
