const isPrivateOrLocalHost = (hostname) => {
  const lower = String(hostname || '').toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower.startsWith('10.') ||
    lower.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)
  );
};

const isAzureBlobUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.blob.core.windows.net') &&
      !isPrivateOrLocalHost(url.hostname)
    );
  } catch (_) {
    return false;
  }
};

const isGoogleAvatarUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    return (
      url.protocol === 'https:' &&
      !isPrivateOrLocalHost(url.hostname) &&
      (
        url.hostname === 'lh3.googleusercontent.com' ||
        url.hostname.endsWith('.googleusercontent.com')
      )
    );
  } catch (_) {
    return false;
  }
};

const safeAvatarUrl = (value) => {
  const raw = String(value || '').trim();
  return isAzureBlobUrl(raw) || isGoogleAvatarUrl(raw) ? raw : null;
};

const withSafeAvatarUrl = (user) => {
  const data = typeof user?.toSafeJSON === 'function' ? user.toSafeJSON() : { ...user };
  data.avatarUrl = safeAvatarUrl(data.avatarUrl);
  return data;
};

module.exports = {
  isAzureBlobUrl,
  isGoogleAvatarUrl,
  safeAvatarUrl,
  withSafeAvatarUrl,
};
