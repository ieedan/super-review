// Generates the Ed25519 keypair used to sign desktop license tokens.
// Run once per key id: `node scripts/generate-license-keys.mjs`
//
// - The PRIVATE key (base64 PKCS#8) goes into the SvelteKit server env as
//   ED25519_PRIVATE_KEY, together with a fresh ED25519_KID. Never commit it.
// - The PUBLIC key (SPKI PEM) gets embedded in the desktop app's
//   license public-key map under the same kid.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const kid = `lk_${randomBytes(4).toString('hex')}`;
const privatePkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const publicSpkiPem = publicKey.export({ type: 'spki', format: 'pem' });

console.log('ED25519_KID=' + kid);
console.log('ED25519_PRIVATE_KEY=' + privatePkcs8);
console.log('\nPublic key (embed in the desktop app keyed by the kid above):\n');
console.log(publicSpkiPem);
