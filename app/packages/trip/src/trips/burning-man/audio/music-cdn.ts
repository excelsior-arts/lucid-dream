import {signedMusic} from '@lucid/world/desert';
import config from './music-cdn.json';

export const MUSIC_SIGNER = config.signer;

/** The song is not the code's to ship, and nothing under this app serves one:
 * wherever the page is opened from, the signer is asked for a short-lived
 * CloudFront address. */
export const resolveMusicUrl = (path: string) => signedMusic(config.signer, path);
