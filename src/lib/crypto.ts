import CryptoJS from 'crypto-js';

const VERSION_PREFIX = 'v2';
const PBKDF2_ITERATIONS = 100_000;
const KEY_SIZE_WORDS = 256 / 32;
const SALT_BYTES = 16;
const IV_BYTES = 16;

/**
 * 简单的对称加密工具
 * 使用 AES 加密算法
 */
export class SimpleCrypto {
  /**
   * 加密数据
   * @param data 要加密的数据
   * @param password 加密密码
   * @returns 加密后的字符串
   */
  static encrypt(data: string, password: string): string {
    try {
      const salt = CryptoJS.lib.WordArray.random(SALT_BYTES);
      const iv = CryptoJS.lib.WordArray.random(IV_BYTES);
      const key = CryptoJS.PBKDF2(password, salt, {
        keySize: KEY_SIZE_WORDS,
        iterations: PBKDF2_ITERATIONS,
        hasher: CryptoJS.algo.SHA256,
      });
      const encrypted = CryptoJS.AES.encrypt(data, key, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });
      const payload = [
        VERSION_PREFIX,
        salt.toString(CryptoJS.enc.Base64),
        iv.toString(CryptoJS.enc.Base64),
        encrypted.ciphertext.toString(CryptoJS.enc.Base64),
      ].join(':');
      return payload;
    } catch (error) {
      throw new Error('加密失败');
    }
  }

  /**
   * 解密数据
   * @param encryptedData 加密的数据
   * @param password 解密密码
   * @returns 解密后的字符串
   */
  static decrypt(encryptedData: string, password: string): string {
    try {
      let decrypted = '';
      if (encryptedData.startsWith(`${VERSION_PREFIX}:`)) {
        const parts = encryptedData.split(':');
        if (parts.length !== 4) {
          throw new Error('加密数据格式错误');
        }
        const [, saltBase64, ivBase64, cipherBase64] = parts;
        const salt = CryptoJS.enc.Base64.parse(saltBase64);
        const iv = CryptoJS.enc.Base64.parse(ivBase64);
        const key = CryptoJS.PBKDF2(password, salt, {
          keySize: KEY_SIZE_WORDS,
          iterations: PBKDF2_ITERATIONS,
          hasher: CryptoJS.algo.SHA256,
        });
        const cipherParams = CryptoJS.lib.CipherParams.create({
          ciphertext: CryptoJS.enc.Base64.parse(cipherBase64),
        });
        decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
          iv,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7,
        }).toString(CryptoJS.enc.Utf8);
      } else {
        const bytes = CryptoJS.AES.decrypt(encryptedData, password);
        decrypted = bytes.toString(CryptoJS.enc.Utf8);
      }

      if (!decrypted) {
        throw new Error('解密失败，请检查密码是否正确');
      }

      return decrypted;
    } catch (error) {
      throw new Error('解密失败，请检查密码是否正确');
    }
  }

  /**
   * 验证密码是否能正确解密数据
   * @param encryptedData 加密的数据
   * @param password 密码
   * @returns 是否能正确解密
   */
  static canDecrypt(encryptedData: string, password: string): boolean {
    try {
      const decrypted = this.decrypt(encryptedData, password);
      return decrypted.length > 0;
    } catch {
      return false;
    }
  }
}
