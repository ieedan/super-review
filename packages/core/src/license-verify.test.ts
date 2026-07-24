import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { verifyEdDSAJwt } from './license-verify.js';
import { LICENSE_AUDIENCE } from './license-claims.js';

const KID = 'lk_test';
let keys: Record<string, string>;
let sign: (payload: object, header?: object) => string;

function b64url(buf: Buffer | string): string {
	return Buffer.from(buf).toString('base64url');
}

beforeAll(() => {
	const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
	keys = { [KID]: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
	sign = (payload, header = { alg: 'EdDSA', kid: KID, typ: 'JWT' }) => {
		const h = b64url(JSON.stringify(header));
		const p = b64url(JSON.stringify(payload));
		const sig = crypto.sign(null, Buffer.from(`${h}.${p}`), privateKey);
		return `${h}.${p}.${b64url(sig)}`;
	};
});

function validPayload() {
	const now = Math.floor(Date.now() / 1000);
	return {
		sub: 'user_1',
		aud: LICENSE_AUDIENCE,
		iss: 'https://superreview.dev',
		iat: now,
		exp: now + 72 * 3600,
		lic: 'lic_1',
		dev: 'dev_1',
		plan: 'lifetime',
		sta: 'active',
		fp: 'fphash',
		tex: null
	};
}

describe('verifyEdDSAJwt', () => {
	it('accepts a genuine signature and returns claims', () => {
		const claims = verifyEdDSAJwt(sign(validPayload()), keys);
		expect(claims?.lic).toBe('lic_1');
		expect(claims?.plan).toBe('lifetime');
	});

	it('rejects a tampered payload (signature no longer matches)', () => {
		const token = sign(validPayload());
		const [h, , s] = token.split('.');
		const forged = b64url(JSON.stringify({ ...validPayload(), plan: 'lifetime', sub: 'attacker' }));
		expect(verifyEdDSAJwt(`${h}.${forged}.${s}`, keys)).toBeNull();
	});

	it('rejects a tampered signature', () => {
		const token = sign(validPayload());
		const [h, p] = token.split('.');
		const badSig = b64url(crypto.randomBytes(64));
		expect(verifyEdDSAJwt(`${h}.${p}.${badSig}`, keys)).toBeNull();
	});

	it('rejects an unknown kid (key not in the embedded map)', () => {
		const token = sign(validPayload(), { alg: 'EdDSA', kid: 'lk_unknown', typ: 'JWT' });
		expect(verifyEdDSAJwt(token, keys)).toBeNull();
	});

	it('rejects alg confusion (alg != EdDSA)', () => {
		const token = sign(validPayload(), { alg: 'none', kid: KID, typ: 'JWT' });
		expect(verifyEdDSAJwt(token, keys)).toBeNull();
	});

	it('rejects a structurally invalid token', () => {
		expect(verifyEdDSAJwt('a.b', keys)).toBeNull();
		expect(verifyEdDSAJwt('not-a-jwt', keys)).toBeNull();
	});
});
