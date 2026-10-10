export class ConfigError extends Error {}

/**
 * @typedef {object} Config
 * @property {string} adminToken
 * @property {URL} publicUrl 사용자가 여는 주소. 쿠키의 Secure, Origin 검사에 쓴다
 * @property {string} dataDir DB 와 백업을 두는 디렉터리
 * @property {number} port
 * @property {number} backupKeep 남길 자동 백업 수
 * @property {boolean} trustProxy X-Forwarded-For 를 믿는가
 */

/**
 * 환경 변수에서 설정을 읽는다. 틀린 값은 이유를 담은 ConfigError.
 * @param {Record<string, string | undefined>} env
 * @returns {Config}
 */
export function loadConfig(env) {
  const need = k => {
    const v = env[k];
    if (!v) throw new ConfigError(`${k} is not set`);
    return v;
  };
  const int = (k, def, max) => {
    const v = env[k] ?? String(def);
    if (!/^\d+$/.test(v) || Number(v) > max) throw new ConfigError(`${k} is not a valid integer`);
    return Number(v);
  };

  const adminToken = need('ADMIN_TOKEN');
  if (adminToken.length < 32) throw new ConfigError('ADMIN_TOKEN must be at least 32 characters');

  const rawUrl = need('PUBLIC_URL');
  let publicUrl;
  try {
    publicUrl = new URL(rawUrl);
  } catch {
    publicUrl = null;
  }
  if (!publicUrl || !['http:', 'https:'].includes(publicUrl.protocol)) {
    throw new ConfigError('PUBLIC_URL must be an address starting with http:// or https://');
  }

  const backupKeep = int('BACKUP_KEEP', 14, 100000);
  if (backupKeep < 1) throw new ConfigError('BACKUP_KEEP must be 1 or more');

  return {
    adminToken,
    publicUrl,
    dataDir: env.DATA_DIR || '/data',
    port: int('PORT', 3000, 65535),
    backupKeep,
    trustProxy: env.TRUST_PROXY === '1',
  };
}
