import bcrypt from 'bcrypt';
import { config } from '../config/env';
import { sha256 } from './crypto';

/**
 * bcrypt only uses the first 72 bytes of a password, which makes long
 * passphrases quietly equivalent to their 72-byte prefix. We pre-hash with
 * sha256 so any length is handled and the stored value stays a standard
 * bcrypt hash.
 */
export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(sha256(plain), config.BCRYPT_ROUNDS);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(sha256(plain), hash);
