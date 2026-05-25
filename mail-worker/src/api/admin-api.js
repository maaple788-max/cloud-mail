import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import userService from '../service/user-service';
import emailService from '../service/email-service';

function adminKey(c) {
	return c.env.admin_api_key || c.env.ADMIN_API_KEY || c.env.jwt_secret || c.env.JWT_SECRET;
}

function requestKey(c) {
	const authorization = c.req.header('authorization') || '';
	if (authorization.toLowerCase().startsWith('bearer ')) {
		return authorization.slice(7).trim();
	}
	return c.req.header('x-admin-key') || c.req.query('adminKey') || '';
}

async function requireAdminKey(c) {
	const expected = adminKey(c);
	if (!expected) {
		throw new BizError('Admin API key is not configured', 500);
	}
	if (requestKey(c) !== expected) {
		throw new BizError('Invalid admin API key', 401);
	}
}

function managedDomains(c) {
	return Array.isArray(c.env.domain) ? c.env.domain.map(domain => String(domain || '').trim().toLowerCase()).filter(Boolean) : [];
}

function randomString(chars, length) {
	const array = new Uint32Array(length);
	crypto.getRandomValues(array);
	let value = '';
	for (const item of array) {
		value += chars[item % chars.length];
	}
	return value;
}

function randomMailboxPrefix(length = 10) {
	const safeLength = Math.min(Math.max(Number(length) || 10, 6), 32);
	const first = randomString('abcdefghijklmnopqrstuvwxyz', 1);
	const rest = randomString('abcdefghijklmnopqrstuvwxyz0123456789', safeLength - 1);
	return `${first}${rest}`;
}

app.post('/admin/users', async (c) => {
	await requireAdminKey(c);
	const data = await userService.adminCreate(c, await c.req.json());
	return c.json(result.ok(data));
});

app.get('/admin/users/:email', async (c) => {
	await requireAdminKey(c);
	const data = await userService.adminGetByEmail(c, c.req.param('email'));
	return c.json(result.ok(data));
});

app.put('/admin/users/:email/password', async (c) => {
	await requireAdminKey(c);
	const data = await userService.adminSetPasswordByEmail(c, c.req.param('email'), await c.req.json());
	return c.json(result.ok(data));
});

app.delete('/admin/users/:email', async (c) => {
	await requireAdminKey(c);
	const data = await userService.adminDeleteByEmail(c, c.req.param('email'));
	return c.json(result.ok(data));
});

app.get('/admin/mailboxes/:email/latest-code', async (c) => {
	await requireAdminKey(c);
	const data = await emailService.adminLatestCode(c, {
		email: c.req.param('email'),
		minutes: c.req.query('minutes'),
		size: c.req.query('size'),
		relayMailbox: c.req.query('relayMailbox') || c.req.query('mailbox') || c.req.query('actualMailbox')
	});
	return c.json(result.ok(data));
});

app.get('/admin/mailboxes/:email/deactivation-notice', async (c) => {
	await requireAdminKey(c);
	const data = await emailService.adminDeactivationNotice(c, {
		email: c.req.param('email'),
		minutes: c.req.query('minutes'),
		relayMailbox: c.req.query('relayMailbox') || c.req.query('mailbox') || c.req.query('actualMailbox')
	});
	return c.json(result.ok(data));
});

app.post('/admin/mailboxes/random', async (c) => {
	await requireAdminKey(c);
	const body = await c.req.json().catch(() => ({}));
	const domain = String(body.domain || c.req.query('domain') || '').trim().toLowerCase();
	if (!domain) {
		throw new BizError('domain is required', 400);
	}
	if (!managedDomains(c).includes(domain)) {
		throw new BizError('domain is not allowed', 400);
	}

	const maxAttempts = Math.min(Math.max(Number(body.maxAttempts) || 8, 1), 20);
	let lastError = null;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const prefix = randomMailboxPrefix(body.prefixLength);
		const email = `${prefix}@${domain}`;
		try {
			const data = await userService.adminCreate(c, {
				email,
				password: body.password,
				roleName: body.roleName || body.userType || body.user_type || 'online'
			});
			return c.json(result.ok({
				email: data.email,
				password: data.password,
				prefix,
				domain,
				userId: data.userId,
				type: data.type,
				userType: data.userType,
				status: data.status,
				attempt
			}));
		} catch (err) {
			lastError = err;
			if (!String(err.message || '').includes('already registered') && !String(err.message || '').includes('已注册')) {
				throw err;
			}
		}
	}
	throw new BizError(`Failed to create a unique mailbox: ${lastError?.message || 'unknown error'}`, 409);
});

app.post('/admin/proton-mailboxes/random', async (c) => {
	await requireAdminKey(c);
	const body = await c.req.json().catch(() => ({}));
	const domain = 'proton.maap1e.online';
	if (!managedDomains(c).includes(domain)) {
		throw new BizError('proton.maap1e.online is not configured as an allowed domain', 500);
	}

	const maxAttempts = Math.min(Math.max(Number(body.maxAttempts) || 8, 1), 20);
	let lastError = null;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const prefix = randomMailboxPrefix(body.prefixLength);
		const email = `${prefix}@${domain}`;
		try {
			const data = await userService.adminCreate(c, {
				email,
				password: body.password,
				roleName: 'proton'
			});
			return c.json(result.ok({
				email: data.email,
				password: data.password,
				prefix,
				domain,
				userId: data.userId,
				type: data.type,
				userType: 'proton',
				status: data.status,
				attempt
			}));
		} catch (err) {
			lastError = err;
			if (!String(err.message || '').includes('already registered') && !String(err.message || '').includes('已注册')) {
				throw err;
			}
		}
	}
	throw new BizError(`Failed to create a unique proton mailbox: ${lastError?.message || 'unknown error'}`, 409);
});
