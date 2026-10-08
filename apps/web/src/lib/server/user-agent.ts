import { buildUserAgent } from '@reactions/eve';
import pkg from '../../../package.json' with { type: 'json' };

/** User-Agent of every outbound request: this worker's package.json version + `USER_AGENT_URL`/`USER_AGENT_CONTACT`. */
export function userAgent(env: { USER_AGENT_URL?: string; USER_AGENT_CONTACT?: string }): string {
	return buildUserAgent({ version: pkg.version, url: env.USER_AGENT_URL, contact: env.USER_AGENT_CONTACT });
}
