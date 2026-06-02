import orm from '../entity/orm';
import email from '../entity/email';
import { attConst, emailConst, isDel, settingConst } from '../const/entity-const';
import { and, desc, eq, gt, inArray, lt, count, asc, sql, ne, or, like, lte, gte } from 'drizzle-orm';
import { star } from '../entity/star';
import settingService from './setting-service';
import accountService from './account-service';
import BizError from '../error/biz-error';
import emailUtils from '../utils/email-utils';
import fileUtils from '../utils/file-utils';
import { Resend } from 'resend';
import attService from './att-service';
import { parseHTML } from 'linkedom';
import userService from './user-service';
import roleService from './role-service';
import user from '../entity/user';
import starService from './star-service';
import dayjs from 'dayjs';
import kvConst from '../const/kv-const';
import { t } from '../i18n/i18n'
import domainUtils from '../utils/domain-uitls';
import account from "../entity/account";
import { att } from '../entity/att';
import telegramService from './telegram-service';
import verifyUtils from '../utils/verify-utils';

const emailService = {

	async adminIcloudRelayMessages(c, params) {
		const relayMailbox = userService.validateManagedEmail(c, params.relayMailbox || 'icloud@maaple.xyz');
		const targetEmail = String(params.email || '').trim().toLowerCase();
		if (!verifyUtils.isEmail(targetEmail)) {
			throw new BizError(t('notEmail'));
		}
		const minutes = Math.min(Math.max(Number(params.minutes) || 43200, 1), 43200);
		const size = Math.min(Math.max(Number(params.size) || 50, 1), 50);
		const since = dayjs().subtract(minutes, 'minute').format('YYYY-MM-DD HH:mm:ss');

		function haystackContainsTarget(haystack, target) {
			const lower = String(haystack || '').toLowerCase();
			const wanted = String(target || '').toLowerCase();
			if (!wanted) return true;
			if (lower.includes(wanted)) return true;
			const local = wanted.split('@')[0];
			if (local && local.length >= 8) {
				const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '[.\\s]*');
				return new RegExp(escaped, 'i').test(lower);
			}
			return false;
		}

		function normalizeMailText(value) {
			return String(value || '')
				.replace(/<style[\s\S]*?<\/style>/gi, ' ')
				.replace(/<script[\s\S]*?<\/script>/gi, ' ')
				.replace(/<br\s*\/?\s*>/gi, ' ')
				.replace(/<\/p>|<\/div>|<\/td>|<\/tr>|<\/h[1-6]>/gi, ' ')
				.replace(/<[^>]+>/g, ' ')
				.replace(/&nbsp;|&#160;/gi, ' ')
				.replace(/&amp;/gi, '&')
				.replace(/&lt;/gi, '<')
				.replace(/&gt;/gi, '>')
				.replace(/&quot;/gi, '"')
				.replace(/&#39;|&apos;/gi, "'")
				.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
				.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
				.replace(/\s+/g, ' ')
				.trim();
		}

		function extractCode(text, content) {
			const haystack = normalizeMailText([text || '', content || ''].join('\n'));
			const match = haystack.match(/(?<!\d)(\d[\s-]?\d[\s-]?\d[\s-]?\d(?:[\s-]?\d){0,4})(?!\d)/);
			return match ? match[1].replace(/\D/g, '') : '';
		}

		const list = await orm(c)
			.select()
			.from(email)
			.where(and(
				eq(email.type, emailConst.type.RECEIVE),
				ne(email.status, emailConst.status.SAVING),
				eq(email.isDel, isDel.NORMAL),
				gte(email.createTime, since),
				or(
					sql`${email.toEmail} COLLATE NOCASE = ${relayMailbox}`,
					sql`${email.recipient} COLLATE NOCASE LIKE ${'%' + relayMailbox + '%'}`
				)
			))
			.orderBy(desc(email.emailId))
			.limit(200)
			.all();

		const messages = [];
		for (const row of list) {
			const haystack = [row.subject, row.sendEmail, row.name, row.toEmail, row.recipient, row.text, row.content, row.message].filter(Boolean).join('\n');
			if (!haystackContainsTarget(haystack, targetEmail)) continue;
			messages.push({
				emailId: row.emailId,
				from: row.sendEmail || '',
				name: row.name || '',
				subject: row.subject || '',
				toEmail: row.toEmail || '',
				recipient: row.recipient || '',
				text: row.text || '',
				content: row.content || '',
				code: extractCode(row.text, row.content),
				createTime: row.createTime || ''
			});
			if (messages.length >= size) break;
		}

		return { relayMailbox, targetEmail, scanned: list.length, list: messages };
	},

	async adminDeactivationNotice(c, params) {
		const relayMailbox = params.relayMailbox ? userService.validateManagedEmail(c, params.relayMailbox) : '';
		const normalizedEmail = relayMailbox
			? String(params.email || '').trim().toLowerCase()
			: userService.validateManagedEmail(c, params.email);
		if (relayMailbox && !verifyUtils.isEmail(normalizedEmail)) {
			throw new BizError(t('notEmail'));
		}
		const queryEmail = relayMailbox || normalizedEmail;
		const minutes = Math.min(Math.max(Number(params.minutes) || 1440, 1), 43200);
		const since = dayjs().subtract(minutes, 'minute').format('YYYY-MM-DD HH:mm:ss');

		const list = await orm(c)
			.select()
			.from(email)
			.where(and(
				eq(email.type, emailConst.type.RECEIVE),
				ne(email.status, emailConst.status.SAVING),
				eq(email.isDel, isDel.NORMAL),
				gte(email.createTime, since),
				or(
					sql`${email.toEmail} COLLATE NOCASE = ${queryEmail}`,
					sql`${email.recipient} COLLATE NOCASE LIKE ${'%' + queryEmail + '%'}`
				),
				sql`${email.subject} COLLATE NOCASE LIKE ${'%OpenAI - Access Deactivated%'}`
			))
			.orderBy(desc(email.emailId))
			.limit(20)
			.all();

		function haystackContainsTarget(haystack, target) {
			const lower = String(haystack || '').toLowerCase();
			const wanted = String(target || '').toLowerCase();
			if (!wanted) return true;
			if (lower.includes(wanted)) return true;
			const local = wanted.split('@')[0];
			if (local && local.length >= 8) {
				const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '[.\\s]*');
				return new RegExp(escaped, 'i').test(lower);
			}
			return false;
		}

		const row = list.find(item => {
			if (!relayMailbox) return true;
			const haystack = [item.subject, item.sendEmail, item.name, item.toEmail, item.recipient, item.text, item.content].filter(Boolean).join('\n');
			return haystackContainsTarget(haystack, normalizedEmail);
		});
		return {
			matched: Boolean(row),
			email: normalizedEmail,
			relayMailbox: relayMailbox || '',
			minutes,
			scanned: list.length,
			subject: row?.subject || '',
			from: row?.sendEmail || '',
			createTime: row?.createTime || '',
			emailId: row?.emailId || 0
		};
	},

	async adminLatestCode(c, params) {

		const relayMailbox = params.relayMailbox ? userService.validateManagedEmail(c, params.relayMailbox) : '';
		const normalizedEmail = relayMailbox
			? String(params.email || '').trim().toLowerCase()
			: userService.validateManagedEmail(c, params.email);
		if (relayMailbox && !verifyUtils.isEmail(normalizedEmail)) {
			throw new BizError(t('notEmail'));
		}
		const queryEmail = relayMailbox || normalizedEmail;
		const accountRow = await accountService.selectByEmailIncludeDel(c, queryEmail);
		const minutes = Math.min(Math.max(Number(params.minutes) || 10, 1), 120);
		const size = Math.min(Math.max(Number(params.size) || 20, 1), 100);
		const since = dayjs().subtract(minutes, 'minute').format('YYYY-MM-DD HH:mm:ss');

		const conditions = [
			eq(email.type, emailConst.type.RECEIVE),
			ne(email.status, emailConst.status.SAVING),
			eq(email.isDel, isDel.NORMAL),
			gte(email.createTime, since),
			or(
				sql`${email.toEmail} COLLATE NOCASE = ${queryEmail}`,
				sql`${email.recipient} COLLATE NOCASE LIKE ${'%' + queryEmail + '%'}`
			)
		];

		// Important: Cloud Mail can receive mail for an address before a user/account is created.
		// Query by recipient address first; do not require accountRow/accountId here.
		const list = await orm(c)
			.select()
			.from(email)
			.where(and(...conditions))
			.orderBy(desc(email.emailId))
			.limit(size)
			.all();

		const codePattern = /(?<!\d)(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)(?!\d)/;
		const priorityCodePatterns = [
			/Enter\s+this\s+temporary\s+verification\s+code\s+to\s+continue[\s\S]{0,240}?(?<!\d)(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)(?!\d)/i,
			/temporary\s+verification\s+code[\s\S]{0,240}?(?<!\d)(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)(?!\d)/i,
			/verification\s+code[\s\S]{0,160}?(?<!\d)(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)(?!\d)/i,
			/验证码[\s\S]{0,160}?(?<!\d)(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)(?!\d)/i
		];
		const openaiPattern = /(openai|chatgpt|verify|verification|验证码|驗證碼|code|login|登录|登入|auth)/i;

		function normalizeMailText(value) {
			return String(value || '')
				.replace(/<style[\s\S]*?<\/style>/gi, ' ')
				.replace(/<script[\s\S]*?<\/script>/gi, ' ')
				.replace(/<br\s*\/?\s*>/gi, ' ')
				.replace(/<\/p>|<\/div>|<\/td>|<\/tr>|<\/h[1-6]>/gi, ' ')
				.replace(/<[^>]+>/g, ' ')
				.replace(/&nbsp;|&#160;/gi, ' ')
				.replace(/&amp;/gi, '&')
				.replace(/&lt;/gi, '<')
				.replace(/&gt;/gi, '>')
				.replace(/&quot;/gi, '"')
				.replace(/&#39;|&apos;/gi, "'")
				.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
				.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
				.replace(/\s+/g, ' ')
				.trim();
		}

		function extractVerificationCode(haystack) {
			const normalized = normalizeMailText(haystack);
			for (const text of [normalized, haystack]) {
				for (const pattern of priorityCodePatterns) {
					const match = text.match(pattern);
					if (match) return { code: match[1].replace(/\D/g, ''), source: 'priority_phrase' };
				}
			}
			const fallback = normalized.match(codePattern) || haystack.match(codePattern);
			return fallback ? { code: fallback[1].replace(/\D/g, ''), source: 'fallback_six_digits' } : null;
		}

		function haystackContainsTarget(haystack, target) {
			const lower = String(haystack || '').toLowerCase();
			const wanted = String(target || '').toLowerCase();
			if (!wanted) return true;
			if (lower.includes(wanted)) return true;
			const local = wanted.split('@')[0];
			if (local && local.length >= 8) {
				const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '[.\\s]*');
				return new RegExp(escaped, 'i').test(lower);
			}
			return false;
		}

		for (const row of list) {
			const haystack = [row.subject, row.sendEmail, row.name, row.toEmail, row.recipient, row.text, row.content].filter(Boolean).join('\n');
			const codeHaystack = [row.subject, row.text, row.content].filter(Boolean).join('\n');
			if (relayMailbox && !haystackContainsTarget(haystack, normalizedEmail)) {
				continue;
			}
			const extracted = extractVerificationCode(codeHaystack);
			if (!extracted) {
				continue;
			}
			const looksRelevant = openaiPattern.test(haystack);
			return {
				matched: true,
				code: extracted.code,
				codeSource: extracted.source,
				email: normalizedEmail,
				subject: row.subject || '',
				from: row.sendEmail || '',
				name: row.name || '',
				createTime: row.createTime,
				emailId: row.emailId,
				looksRelevant,
				relayMailbox: relayMailbox || ''
			};
		}

		return { matched: false, email: normalizedEmail, relayMailbox: relayMailbox || '', scanned: list.length, hasAccount: Boolean(accountRow && accountRow.isDel !== isDel.DELETE), latest: list.slice(0, 3).map(row => ({ subject: row.subject || '', from: row.sendEmail || '', createTime: row.createTime, emailId: row.emailId })) };
	},

	async list(c, params, userId) {

		let { emailId, type, accountId, size, timeSort, allReceive } = params;

		size = Number(size);
		emailId = Number(emailId);
		timeSort = Number(timeSort);
		accountId = Number(accountId);
		allReceive = Number(allReceive);

		if (size > 50) {
			size = 50;
		}

		if (!emailId) {

			if (timeSort) {
				emailId = 0;
			} else {
				emailId = 9999999999;
			}

		}

		if (isNaN(allReceive)) {
			let accountRow = await accountService.selectById(c, accountId);
			allReceive = accountRow.allReceive;
		}

		const query = orm(c)
			.select({
				...email,
				starId: star.starId
			})
			.from(email)
			.leftJoin(
				star,
				and(
					eq(star.emailId, email.emailId),
					eq(star.userId, userId)
				)
			).leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					allReceive ? eq(1,1) : eq(email.accountId, accountId),
					eq(email.userId, userId),
					timeSort ? gt(email.emailId, emailId) : lt(email.emailId, emailId),
					eq(email.type, type),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL)
				)
			);

		if (timeSort) {
			query.orderBy(asc(email.emailId));
		} else {
			query.orderBy(desc(email.emailId));
		}

		const listQuery = query.limit(size).all();

		const totalQuery = orm(c).select({ total: count() }).from(email)
			.leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					allReceive ? eq(1,1) : eq(email.accountId, accountId),
					eq(email.userId, userId),
					eq(email.type, type),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL)
				)
		).get();

		const latestEmailQuery = orm(c).select().from(email).where(
			and(
				allReceive ? eq(1,1) : eq(email.accountId, accountId),
				eq(email.userId, userId),
				eq(email.type, type),
				eq(email.isDel, isDel.NORMAL)
			))
			.orderBy(desc(email.emailId)).limit(1).get();

		let [list, totalRow, latestEmail] = await Promise.all([listQuery, totalQuery, latestEmailQuery]);

		list = list.map(item => ({
			...item,
			isStar: item.starId != null ? 1 : 0
		}));


		await this.emailAddAtt(c, list);

		if (!latestEmail) {
			latestEmail = {
				emailId: 0,
				accountId: accountId,
				userId: userId,
			}
		}

		return { list, total: totalRow.total, latestEmail };
	},

	async delete(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = emailIds.split(',').map(Number);
		await orm(c).update(email).set({ isDel: isDel.DELETE }).where(
			and(
				eq(email.userId, userId),
				inArray(email.emailId, emailIdList)))
			.run();
	},

	receive(c, params, cidAttList, r2domain) {
		params.content = this.imgReplace(params.content, cidAttList, r2domain)
		return orm(c).insert(email).values({ ...params }).returning().get();
	},

	//邮件发送
	async send(c, params, userId) {

		let {
			accountId, //发送账号id
			name, //发件人名字
			sendType, //发件类型
			emailId, //邮件id，如果是回复邮件会带
			receiveEmail, //收件人邮箱
			text, //邮件纯文本
			content, //邮件内容
			subject, //邮件标题
			attachments //附件
		} = params;

		const { resendTokens, r2Domain, send, domainList } = await settingService.query(c);

		let { imageDataList, html } = await attService.toImageUrlHtml(c, content);

		//判断是否关闭发件功能
		if (send === settingConst.send.CLOSE) {
			throw new BizError(t('disabledSend'), 403);
		}

		const userRow = await userService.selectById(c, userId);
		const roleRow = await roleService.selectById(c, userRow.type);

		//判断接收方是不是全部为站内邮箱
		const allInternal = receiveEmail.every(email => {
			const domain = '@' + emailUtils.getDomain(email);
			return domainList.includes(domain);
		});

		if (c.env.admin !== userRow.email) {

			//发件被禁用
			if (roleRow.sendType === 'ban') {
				throw new BizError(t('bannedSend'), 403);
			}

			//发件被禁用
			if (roleRow.sendType === 'internal' && !allInternal) {
				throw new BizError(t('onlyInternalSend'), 403);
			}

		}

		//如果不是管理员，权限设置了发送次数
		if (c.env.admin !== userRow.email && roleRow.sendCount) {

			if (userRow.sendCount >= roleRow.sendCount) {
				if (roleRow.sendType === 'day') throw new BizError(t('daySendLimit'), 403);
				if (roleRow.sendType === 'count') throw new BizError(t('totalSendLimit'), 403);
			}

			if (userRow.sendCount + receiveEmail.length > roleRow.sendCount) {
				if (roleRow.sendType === 'day') throw new BizError(t('daySendLack'), 403);
				if (roleRow.sendType === 'count') throw new BizError(t('totalSendLack'), 403);
			}

		}

		const accountRow = await accountService.selectById(c, accountId);

		if (!accountRow) {
			throw new BizError(t('senderAccountNotExist'));
		}

		if (accountRow.userId !== userId) {
			throw new BizError(t('sendEmailNotCurUser'));
		}

		if (c.env.admin !== userRow.email) {
			//用户没有这个域名的使用权限
			if(!roleService.hasAvailDomainPerm(roleRow.availDomain, accountRow.email)) {
				throw new BizError(t('noDomainPermSend'),403)
			}

		}

		const domain = emailUtils.getDomain(accountRow.email);
		const resendToken = resendTokens[domain];

		//如果接收方存在站外邮箱，又没有resend token
		if (!resendToken && !allInternal) {
			throw new BizError(t('noResendToken'));
		}

		//没有发件人名字自动截取
		if (!name) {
			name = emailUtils.getName(accountRow.email);
		}

		let emailRow = {
			messageId: null
		};

		//如果是回复邮件
		if (sendType === 'reply') {

			emailRow = await this.selectById(c, emailId);

			if (!emailRow) {
				throw new BizError(t('notExistEmailReply'));
			}

		}

		let resendResult = {};

		//存在站外时邮箱全部由resend发送
		if (!allInternal) {

			const resend = new Resend(resendToken);

			const sendForm = {
				from: `${name} <${accountRow.email}>`,
				to: [...receiveEmail],
				subject: subject,
				text: text,
				html: html,
				attachments: await this.toArrayBufferAttachments([...imageDataList, ...attachments])
			};

			if (sendType === 'reply') {
				sendForm.headers = {
					'in-reply-to': emailRow.messageId,
					'references': emailRow.messageId
				};
			}

			resendResult = await resend.emails.send(sendForm);

		}

		const { data, error } = resendResult;


		if (error) {
			throw new BizError(error.message);
		}

		imageDataList = imageDataList.map(item => ({...item, contentId: `<${item.contentId}>`}))

		//把图片标签cid标签切换会通用url
		html = this.imgReplace(html, imageDataList, r2Domain);

		//封装数据保存到数据库
		const emailData = {};
		emailData.sendEmail = accountRow.email;
		emailData.name = name;
		emailData.subject = subject;
		emailData.content = html;
		emailData.text = text;
		emailData.accountId = accountId;
		emailData.status = emailConst.status.SENT;
		emailData.type = emailConst.type.SEND;
		emailData.userId = userId;
		emailData.resendEmailId = data?.id;

		const recipient = [];

		receiveEmail.forEach(item => {
			recipient.push({ address: item, name: '' });
		});

		emailData.recipient = JSON.stringify(recipient);

		if (sendType === 'reply') {
			emailData.inReplyTo = emailRow.messageId;
			emailData.relation = emailRow.messageId;
		}

		//如果权限有发送次数增加用户发送次数
		if (roleRow.sendCount && roleRow.sendType !== 'internal') {
			await userService.incrUserSendCount(c, receiveEmail.length, userId);
		}

		//保存到数据库并返回结果
		const emailResult = await orm(c).insert(email).values(emailData).returning().get();

		//保存内嵌附件
		if (imageDataList.length > 0) {
			if (imageDataList.length > 10) {
				throw new BizError(t('imageAttLimit'));
			}
			await attService.saveArticleAtt(c, imageDataList, userId, accountId, emailResult.emailId);
		}

		//保存普通附件
		if (attachments?.length > 0) {
			if (attachments.length > 10) {
				throw new BizError(t('attLimit'));
			}
			await attService.saveSendAtt(c, attachments, userId, accountId, emailResult.emailId);
		}

		const attList = await attService.selectByEmailIds(c, [emailResult.emailId]);
		emailResult.attList = attList;

		//如果全是站内接收方，直接写入数据库
		if (allInternal) {
			await this.HandleOnSiteEmail(c, receiveEmail, emailResult, attList);
		}

		const dateStr = dayjs().format('YYYY-MM-DD');
		let daySendTotal = await c.env.kv.get(kvConst.SEND_DAY_COUNT + dateStr);

		//记录每天发件次数统计
		if (!daySendTotal) {
			await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(receiveEmail.length), { expirationTtl: 60 * 60 * 24 });
		} else  {
			daySendTotal = Number(daySendTotal) + receiveEmail.length
			await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(daySendTotal), { expirationTtl: 60 * 60 * 24 });
		}

		return [ emailResult ];
	},

	async toArrayBufferAttachments(attachments = []) {
		const result = [];

		for (const attachment of attachments || []) {
			const content = await this.toAttachmentArrayBuffer(attachment);
			if (!content) {
				continue;
			}
			result.push({ ...attachment, content });
		}

		return result;
	},

	async toAttachmentArrayBuffer(attachment) {
		let content = attachment?.content;

		if (!content) {
			return null;
		}

		if (content instanceof ArrayBuffer) {
			return content;
		}

		if (content instanceof Uint8Array) {
			return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
		}

		if (typeof content === 'string') {
			if (content.startsWith('data:')) {
				content = content.split(',')[1] || content;
			}
			return fileUtils.base64ToUint8Array(content.replace(/\s+/g, '')).buffer;
		}

		return content;
	},

	//处理站内邮件发送
	async HandleOnSiteEmail(c, receiveEmail, sendEmailData, attList) {

		const { noRecipient  } = await settingService.query(c);

		//查询所有收件人账号信息
		let accountList = await orm(c).select().from(account).where(inArray(account.email, receiveEmail)).all();

		//查询所有收件人权限身份
		const userIds = accountList.map(accountRow => accountRow.userId);
		let roleList = await roleService.selectByUserIds(c, userIds);

		//封装数据库准备保存到数据库
		const emailDataList = [];

		for (const email of receiveEmail) {

			//把发件人邮件改成收件
			const emailValues = {...sendEmailData}
			emailValues.status = emailConst.status.RECEIVE;
			emailValues.type = emailConst.type.RECEIVE;
			emailValues.toEmail = email;
			emailValues.toName = emailUtils.getName(email);
			emailValues.emailId = null;

			const accountRow = accountList.find(accountRow => accountRow.email === email);

			//如果收件人存在就把邮件信息改成收件人的
			if (accountRow) {

				//设置给收件人保存
				emailValues.userId = accountRow.userId;
				emailValues.accountId = accountRow.accountId;
				emailValues.type = emailConst.type.RECEIVE;
				emailValues.status = emailConst.status.RECEIVE;

				const roleRow = roleList.find(roleRow => roleRow.userId === accountRow.userId);

				let { banEmail, availDomain } = roleRow;

				//如果收件人没有这个域名的使用权限和有邮件拦截，就把邮件改为拒收状态
				if (email !== c.env.admin) {

					if (!roleService.hasAvailDomainPerm(availDomain, email)) {
						emailValues.status = emailConst.status.BOUNCED;
						emailValues.message = `The recipient <${email}> is not authorized to use this domain.`;
					} else if(roleService.isBanEmail(banEmail, sendEmailData.sendEmail)) {
						emailValues.status = emailConst.status.BOUNCED;
						emailValues.message = `The recipient <${email}> is disabled from receiving emails.`;
					}

				}

				emailDataList.push(emailValues);

			} else {

				//设置无收件人邮件信息
				emailValues.userId = 0;
				emailValues.accountId = 0;
				emailValues.type = emailConst.type.RECEIVE;
				emailValues.status = emailConst.status.NOONE;

				//如果无人收件关闭改为拒收
				if (noRecipient === settingConst.noRecipient.CLOSE) {
					emailValues.status = emailConst.status.BOUNCED;
					emailValues.message = `Recipient not found: <${email}>`;
				}

				emailDataList.push(emailValues);

			}

		}

		//保存邮件
		const receiveEmailList = emailDataList.filter(emailRow => emailRow.status === emailConst.status.RECEIVE || emailRow.status === emailConst.status.NOONE);

		for (const emailData of receiveEmailList) {

			const emailRow = await orm(c).insert(email).values(emailData).returning().get();

			//设置附件保存
			for (const attRow of attList) {
				const attValues = {...attRow};
				attValues.emailId = emailRow.emailId;
				attValues.accountId = emailRow.accountId;
				attValues.userId = emailRow.userId;
				attValues.attId = null;
				await orm(c).insert(att).values(attValues).run();
			}

		}

		const bouncedEmail = emailDataList.find(emailRow => emailRow.status === emailConst.status.BOUNCED);


		let status = emailConst.status.DELIVERED;
		let message = ''
		//如果有拒收邮件，就把发件人的邮件改成拒收
		if (bouncedEmail) {
			const messageJson = { message: bouncedEmail.message };
			message = JSON.stringify(messageJson);
			status = emailConst.status.BOUNCED;
		}

		await orm(c).update(email).set({ status, message: message }).where(eq(email.emailId, sendEmailData.emailId)).run();

	},

	imgReplace(content, cidAttList, r2domain) {

		if (!content) {
			return ''
		}

		const { document } = parseHTML(content);

		const images = Array.from(document.querySelectorAll('img'));

		const useAtts = []

		for (const img of images) {

			const src = img.getAttribute('src');
			if (src && src.startsWith('cid:') && cidAttList) {

				const cid = src.replace(/^cid:/, '');
				const attCidIndex = cidAttList.findIndex(cidAtt => cidAtt.contentId.replace(/^<|>$/g, '') === cid);

				if (attCidIndex > -1) {
					const cidAtt = cidAttList[attCidIndex];
					img.setAttribute('src', '{{domain}}' + cidAtt.key);
					useAtts.push(cidAtt)
				}

			}

			r2domain = domainUtils.toOssDomain(r2domain)

			if (src && src.startsWith(r2domain + '/')) {
				img.setAttribute('src', src.replace(r2domain + '/', '{{domain}}'));
			}

		}

		useAtts.forEach(att => {
			att.type = attConst.type.EMBED
		})

		return document.toString();
	},

	selectById(c, emailId) {
		return orm(c).select().from(email).where(
			and(eq(email.emailId, emailId),
				eq(email.isDel, isDel.NORMAL)))
			.get();
	},

	async latest(c, params, userId) {
		let { emailId, accountId, allReceive } = params;
		allReceive = Number(allReceive);

		if (isNaN(allReceive)) {
			let accountRow = await accountService.selectById(c, accountId);
			allReceive = accountRow.allReceive;
		}

		let list = await orm(c).select({...email}).from(email)
			.leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					gt(email.emailId, emailId),
					eq(email.userId, userId),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL),
					allReceive ? eq(1,1) : eq(email.accountId, accountId),
					eq(email.type, emailConst.type.RECEIVE)
				))
			.orderBy(desc(email.emailId))
			.limit(20);

		await this.emailAddAtt(c, list);

		return list;
	},

	async physicsDelete(c, params) {
		let { emailIds } = params;
		emailIds = emailIds.split(',').map(Number);
		await attService.removeByEmailIds(c, emailIds);
		await starService.removeByEmailIds(c, emailIds);
		await orm(c).delete(email).where(inArray(email.emailId, emailIds)).run();
	},

	async physicsDeleteUserIds(c, userIds) {
		await attService.removeByUserIds(c, userIds);
		await orm(c).delete(email).where(inArray(email.userId, userIds)).run();
	},

	updateEmailStatus(c, params) {
		const { status, resendEmailId, message } = params;
		return orm(c).update(email).set({
			status: status,
			message: message
		}).where(eq(email.resendEmailId, resendEmailId)).returning().get();
	},

	async selectUserEmailCountList(c, userIds, type, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: email.userId,
				count: count(email.emailId)
			})
			.from(email)
			.where(and(
				inArray(email.userId, userIds),
				eq(email.type, type),
				eq(email.isDel, del),
				ne(email.status, emailConst.status.SAVING),
			))
			.groupBy(email.userId);
		return result;
	},

	async allList(c, params) {

		let { emailId, size, name, subject, accountEmail, userEmail, type, timeSort } = params;

		size = Number(size);

		emailId = Number(emailId);
		timeSort = Number(timeSort);

		if (size > 50) {
			size = 50;
		}

		if (!emailId) {

			if (timeSort) {
				emailId = 0;
			} else {
				emailId = 9999999999;
			}

		}

		const conditions = [];

		if (type === 'send') {
			conditions.push(eq(email.type, emailConst.type.SEND));
		}

		if (type === 'receive') {
			conditions.push(eq(email.type, emailConst.type.RECEIVE));
		}

		if (type === 'delete') {
			conditions.push(eq(email.isDel, isDel.DELETE));
		}

		if (type === 'noone') {
			conditions.push(eq(email.status, emailConst.status.NOONE));
		}

		if (userEmail) {
			conditions.push(sql`${user.email} COLLATE NOCASE LIKE ${'%'+ userEmail + '%'}`);
		}

		if (accountEmail) {
			conditions.push(
				or(
					sql`${email.toEmail} COLLATE NOCASE LIKE ${'%'+ accountEmail + '%'}`,
					sql`${email.sendEmail} COLLATE NOCASE LIKE ${'%'+ accountEmail + '%'}`,
				)
			)
		}

		if (name) {
			conditions.push(sql`${email.name} COLLATE NOCASE LIKE ${'%'+ name + '%'}`);
		}

		if (subject) {
			conditions.push(sql`${email.subject} COLLATE NOCASE LIKE ${'%'+ subject + '%'}`);
		}

		conditions.push(ne(email.status, emailConst.status.SAVING));

		const countConditions = [...conditions];

		if (timeSort) {
			conditions.unshift(gt(email.emailId, emailId));
		} else {
			conditions.unshift(lt(email.emailId, emailId));
		}

		const query = orm(c).select({ ...email, userEmail: user.email })
			.from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(and(...conditions));

		const queryCount = orm(c).select({ total: count() })
			.from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(and(...countConditions));

		if (timeSort) {
			query.orderBy(asc(email.emailId));
		} else {
			query.orderBy(desc(email.emailId));
		}

		const listQuery = await query.limit(size).all();
		const totalQuery = await queryCount.get();
		const latestEmailQuery = await orm(c).select().from(email)
			.where(and(
				eq(email.type, emailConst.type.RECEIVE),
				ne(email.status, emailConst.status.SAVING)
			))
			.orderBy(desc(email.emailId)).limit(1).get();

		let [list, totalRow, latestEmail] = await Promise.all([listQuery, totalQuery, latestEmailQuery]);

		await this.emailAddAtt(c, list);

		if (!latestEmail) {
			latestEmail = {
				emailId: 0,
				accountId: 0,
				userId: 0,
			}
		}

		return { list: list, total: totalRow.total, latestEmail };
	},

	async allEmailLatest(c, params) {

		const { emailId } = params;

		let list = await orm(c).select({...email, userEmail: user.email}).from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(
				and(
					gt(email.emailId, emailId),
					eq(email.type, emailConst.type.RECEIVE),
					ne(email.status, emailConst.status.SAVING)
				))
			.orderBy(desc(email.emailId))
			.limit(20);

		await this.emailAddAtt(c, list);

		return list;
	},

	async emailAddAtt(c, list) {

		const emailIds = list.map(item => item.emailId);

		if (emailIds.length > 0) {

			const attList = await attService.selectByEmailIds(c, emailIds);

			list.forEach(emailRow => {
				const atts = attList.filter(attRow => attRow.emailId === emailRow.emailId);
				emailRow.attList = atts;
			});
		}
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(email).set({ isDel: isDel.NORMAL }).where(eq(email.userId, userId)).run();
	},

	async completeReceive(c, status, emailId) {
		return await orm(c).update(email).set({
			isDel: isDel.NORMAL,
			status: status
		}).where(eq(email.emailId, emailId)).returning().get();
	},

	async completeReceiveAll(c) {
		await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.RECEIVE} WHERE status = ${emailConst.status.SAVING} AND EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
		await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.NOONE} WHERE status = ${emailConst.status.SAVING} AND NOT EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
	},

	async batchDelete(c, params) {
		let { sendName, sendEmail, toEmail, subject, startTime, endTime, type  } = params

		let right = type === 'left' || type === 'include'
		let left = type === 'include'

		const conditions = []

		if (sendName) {
			conditions.push(like(email.name,`${left ? '%' : ''}${sendName}${right ? '%' : ''}`))
		}

		if (subject) {
			conditions.push(like(email.subject,`${left ? '%' : ''}${subject}${right ? '%' : ''}`))
		}

		if (sendEmail) {
			conditions.push(like(email.sendEmail,`${left ? '%' : ''}${sendEmail}${right ? '%' : ''}`))
		}

		if (toEmail) {
			conditions.push(like(email.toEmail,`${left ? '%' : ''}${toEmail}${right ? '%' : ''}`))
		}

		if (startTime && endTime) {
			conditions.push(gte(email.createTime,`${startTime}`))
			conditions.push(lte(email.createTime,`${endTime}`))
		}

		if (conditions.length === 0) {
			return;
		}

		const emailIdsRow = await orm(c).select({emailId: email.emailId}).from(email).where(conditions.length > 1 ? and(...conditions) : conditions[0]).all();

		const emailIds = emailIdsRow.map(row => row.emailId);

		if (emailIds.length === 0){
			return;
		}

		await attService.removeByEmailIds(c, emailIds);

		await orm(c).delete(email).where(conditions.length > 1 ? and(...conditions) : conditions[0]).run();
	},

	async physicsDeleteByAccountId(c, accountId) {
		await attService.removeByAccountId(c, accountId);
		await orm(c).delete(email).where(eq(email.accountId, accountId)).run();
	},

	async read(c, params, userId) {
		const { emailIds } = params;
		await orm(c).update(email).set({ unread: emailConst.unread.READ }).where(and(eq(email.userId, userId), inArray(email.emailId, emailIds)));
	}
};

export default emailService;
