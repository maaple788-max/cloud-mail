const encoder = new TextEncoder();

const saltHashUtils = {

	generateSalt(length = 16) {
		const array = new Uint8Array(length);
		crypto.getRandomValues(array);
		return btoa(String.fromCharCode(...array));
	},


	async hashPassword(password) {
		const salt = this.generateSalt();
		const hash = await this.genHashPassword(password, salt);
		return { salt, hash };
	},

	async genHashPassword(password, salt) {
		const data = encoder.encode(salt + password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return btoa(String.fromCharCode(...hashArray));
	},

	async verifyPassword(inputPassword, salt, storedHash) {
		const hash = await this.genHashPassword(inputPassword, salt);
		return hash === storedHash;
	},

	randomChar(chars) {
		const array = new Uint32Array(1);
		crypto.getRandomValues(array);
		return chars[array[0] % chars.length];
	},

	shuffleSecure(chars) {
		const list = chars.split('');
		for (let i = list.length - 1; i > 0; i -= 1) {
			const array = new Uint32Array(1);
			crypto.getRandomValues(array);
			const j = array[0] % (i + 1);
			[list[i], list[j]] = [list[j], list[i]];
		}
		return list.join('');
	},

	genRandomPwd(length = 8) {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let result = '';
		for (let i = 0; i < length; i++) {
			result += this.randomChar(chars);
		}
		return result;
	},

	genBalancedPassword(length = 16, minDigits = 4) {
		const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
		const lower = 'abcdefghijklmnopqrstuvwxyz';
		const digits = '0123456789';
		const all = upper + lower + digits;

		const chars = [
			this.randomChar(upper),
			this.randomChar(lower),
		];

		for (let i = 0; i < minDigits; i += 1) {
			chars.push(this.randomChar(digits));
		}

		while (chars.length < length) {
			chars.push(this.randomChar(all));
		}

		return this.shuffleSecure(chars.join(''));
	}
};

export default saltHashUtils;
