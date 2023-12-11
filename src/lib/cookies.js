export function setCookie(cookies, name, value) {
	cookies.set(name, value, { maxAge: 60 * 60 * 24 * 365, sameSite: 'strict' });
}
