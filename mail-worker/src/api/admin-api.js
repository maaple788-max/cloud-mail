import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import userService from '../service/user-service';

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
