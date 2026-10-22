const { Core } = require('@adobe/aio-sdk');
const stateLib = require('@adobe/aio-lib-state');

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const DEFAULT_SCOPES =
	'openid,AdobeID,email,profile,additional_info.roles,additional_info.projectedProductContext,commerce.accs';
const CONFIG_STATE_KEY = 'badge-config-v1';
const PRODUCT_BADGE_STATE_PREFIX = 'product-badge-v1.';

const DEFAULT_TIERS = [
	{ percentage: 20, badgeText: 'Deep Discount!' },
	{ percentage: 30, badgeText: 'Super Saver!' },
	{ percentage: 40, badgeText: 'Hot Deal!' },
];

function hasValue (v) {
	return v !== undefined && v !== null && String(v).trim() !== '';
}

function sanitizeStateKeyPart (value) {
	return String(value || '')
		.trim()
		.replace(/[^a-zA-Z0-9-_.]/g, '_');
}

function parseRawBody (params) {
	if (!hasValue(params?.__ow_body) || typeof params.__ow_body !== 'string') {
		return null;
	}
	try {
		return JSON.parse(params.__ow_body);
	} catch {
		return null;
	}
}

function extractSku (params) {
	if (hasValue(params?.sku)) return String(params.sku).trim();
	if (hasValue(params?.product?.sku)) return String(params.product.sku).trim();
	if (hasValue(params?.data?.product?.sku)) return String(params.data.product.sku).trim();
	if (hasValue(params?.data?.value?.sku)) return String(params.data.value.sku).trim();
	if (hasValue(params?.event?.data?.product?.sku)) return String(params.event.data.product.sku).trim();

	const rawBody = parseRawBody(params);
	if (hasValue(rawBody?.sku)) return String(rawBody.sku).trim();
	if (hasValue(rawBody?.product?.sku)) return String(rawBody.product.sku).trim();
	if (hasValue(rawBody?.data?.product?.sku)) return String(rawBody.data.product.sku).trim();

	return '';
}

function isLikelyWebhookInvocation (params) {
	return Boolean(params?.event_id || params?.type || params?.event_type || params?.data || params?.event);
}

function extractWebhookProduct (params) {
	if (params?.product && typeof params.product === 'object') return params.product;
	if (params?.data?.product && typeof params.data.product === 'object') return params.data.product;
	if (params?.event?.data?.product && typeof params.event.data.product === 'object') return params.event.data.product;

	const rawBody = parseRawBody(params);
	if (rawBody?.product && typeof rawBody.product === 'object') return rawBody.product;
	if (rawBody?.data?.product && typeof rawBody.data.product === 'object') return rawBody.data.product;

	return null;
}

function envPresenceSummary (params) {
	return {
		hasClientId: hasValue(params.IMS_OAUTH_S2S_CLIENT_ID),
		hasClientSecret: hasValue(params.IMS_OAUTH_S2S_CLIENT_SECRET),
		hasOrgId: hasValue(params.IMS_OAUTH_S2S_ORG_ID),
		hasScopes: hasValue(params.IMS_OAUTH_S2S_SCOPES),
		hasCommerceApiBaseUrl: hasValue(params.COMMERCE_API_BASE_URL),
	};
}

function normalizeScopeTokens (scopeStr) {
	return String(scopeStr)
		.split(/[,\s]+/)
		.map((t) => t.trim())
		.filter(Boolean)
		.join(' ');
}

function resolveImsScopeParam (raw, defaultScopes) {
	if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
		return normalizeScopeTokens(defaultScopes);
	}
	if (Array.isArray(raw)) {
		return raw.map((t) => String(t).trim()).filter(Boolean).join(' ');
	}
	const s = String(raw).trim();
	if (s.startsWith('[')) {
		try {
			const parsed = JSON.parse(s);
			if (Array.isArray(parsed)) {
				return parsed.map((t) => String(t).trim()).filter(Boolean).join(' ');
			}
		} catch {
			/* fall through */
		}
	}
	return normalizeScopeTokens(s);
}

function normalizeTiers (tiers) {
	if (!Array.isArray(tiers)) {
		return DEFAULT_TIERS;
	}

	const normalized = tiers
		.map((tier) => ({
			percentage: Number(tier?.percentage),
			badgeText: String(tier?.badgeText || '').trim(),
		}))
		.filter((tier) => Number.isFinite(tier.percentage) && tier.percentage > 0 && tier.percentage <= 100 && tier.badgeText)
		.sort((a, b) => a.percentage - b.percentage);

	return normalized.length ? normalized : DEFAULT_TIERS;
}

async function getBadgeTiersFromState (logger) {
	try {
		logger.info(`Reading badge tier config from state key: ${CONFIG_STATE_KEY}`);
		const state = await stateLib.init();
		const stored = await state.get(CONFIG_STATE_KEY);

		if (!stored?.value) {
			logger.warn('No stored badge tier config found; using default tiers');
			return DEFAULT_TIERS;
		}

		const parsed = JSON.parse(stored.value);
		const normalized = normalizeTiers(parsed?.tiers);
		logger.info(`Loaded ${normalized.length} badge tiers from state`);
		return normalized;
	} catch (error) {
		logger.warn(`Falling back to default badge tiers: ${error.message}`);
		return DEFAULT_TIERS;
	}
}

function calculateDiscountPercent (listPrice, salePrice) {
	if (!Number.isFinite(listPrice) || !Number.isFinite(salePrice) || listPrice <= 0 || salePrice >= listPrice) {
		return 0;
	}
	return ((listPrice - salePrice) / listPrice) * 100;
}

function resolveBadgeForDiscount (discountPercent, tiers) {
	let matchedTier = null;
	let matchedTierRank = null;

	tiers.forEach((tier, index) => {
		if (discountPercent >= tier.percentage) {
			matchedTier = tier;
			matchedTierRank = index + 1;
		}
	});

	return {
		matchedTier,
		matchedTierRank,
	};
}

let cachedToken = null;
let cachedExpiryMs = 0;

async function getImsAccessToken (params) {
	if (cachedToken && Date.now() < cachedExpiryMs - 60_000) {
		// token reuse is expected; keep as debug-level signal only
		return cachedToken;
	}
	const resolvedScope = resolveImsScopeParam(params.IMS_OAUTH_S2S_SCOPES, DEFAULT_SCOPES);
	const body = new URLSearchParams({
		client_id: params.IMS_OAUTH_S2S_CLIENT_ID,
		client_secret: params.IMS_OAUTH_S2S_CLIENT_SECRET,
		grant_type: 'client_credentials',
		scope: resolvedScope,
	});
	// scopes can be useful for auth diagnostics; secrets are never logged
	// NOTE: this intentionally omits client secret values
	// and logs only count/shape information.
	const res = await fetch(IMS_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`IMS token request failed: ${res.status} ${text}`);
	}
	const data = await res.json();
	if (!data?.access_token) {
		throw new Error('IMS token response missing access_token');
	}
	cachedToken = data.access_token;
	cachedExpiryMs = Date.now() + (data.expires_in || 3600) * 1000;
	return cachedToken;
}

async function saveProductBadgeToState (sku, productBadge, logger) {
	const state = await stateLib.init();
	const sanitizedSku = sanitizeStateKeyPart(sku);
	const stateKey = `${PRODUCT_BADGE_STATE_PREFIX}${sanitizedSku}`;
	if (sanitizedSku !== sku) {
		logger.info(`SKU normalized for state key: original="${sku}", normalized="${sanitizedSku}"`);
	}
	await state.put(stateKey, JSON.stringify(productBadge));
	logger.info(`Saved product badge snapshot to state key: ${stateKey}`);
	return stateKey;
}

async function main (params) {
	const logger = Core.Logger('set-product-badge', {
		level: params.LOG_LEVEL || 'info',
	});

	logger.info('Webhook received:', JSON.stringify(params));

	try {
		const webhookProduct = extractWebhookProduct(params);
		const sku = extractSku(params);
		logger.info(`set-product-badging invoked for sku=${sku || 'N/A'}`);
		logger.info(`Runtime env presence: ${JSON.stringify(envPresenceSummary(params))}`);
		if (!sku) {
			const skipMessage = isLikelyWebhookInvocation(params)
				? 'No SKU in webhook payload; skipped.'
				: 'Missing required parameter: sku';
			logger.warn(skipMessage);
			return {
				statusCode: 200,
				body: {
					op: 'success',
					message: skipMessage,
				},
			};
		}

		logger.info(`Fetching product data for SKU: ${sku}`);
		if (!hasValue(params.COMMERCE_API_BASE_URL)) {
			throw new Error('COMMERCE_API_BASE_URL is missing or empty');
		}

		const baseUrl = params.COMMERCE_API_BASE_URL.replace(/\/$/, '');
		logger.info(`Using Commerce API base URL: ${baseUrl}`);
		const accessToken = await getImsAccessToken(params);
		logger.info('Successfully acquired IMS access token');

		const productUrl = `${baseUrl}/V1/products/${encodeURIComponent(sku)}`;
		logger.info(`Requesting product from Commerce URL: ${productUrl}`);

		const response = await fetch(productUrl, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'x-api-key': params.IMS_OAUTH_S2S_CLIENT_ID,
				'x-gw-ims-org-id': params.IMS_OAUTH_S2S_ORG_ID,
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) {
			const errorBody = await response.text();
			logger.error(`Commerce API returned ${response.status} ${response.statusText}: ${errorBody}`);
			return {
				statusCode: response.status,
				body: { error: `Commerce API error: ${response.statusText}` },
			};
		}

		const product = await response.json();
		logger.info(`Commerce product loaded: sku=${product?.sku}, name=${product?.name}, price=${product?.price}`);
		const badgeTiers = await getBadgeTiersFromState(logger);

		const specialPriceAttr = product.custom_attributes?.find(
			(attr) => attr.attribute_code === 'special_price',
		);

		const salePrice = specialPriceAttr
			? parseFloat(specialPriceAttr.value)
			: null;

		const listPrice = Number(product.price);
		const discountPercent = calculateDiscountPercent(listPrice, salePrice);
		const { matchedTier, matchedTierRank } = resolveBadgeForDiscount(discountPercent, badgeTiers);
		const deepDiscountBadge = matchedTier ? matchedTier.badgeText : null;
		logger.info(`Badge resolution result: listPrice=${listPrice}, salePrice=${salePrice}, discountPercent=${discountPercent.toFixed(2)}, tierRank=${matchedTierRank || 'none'}, badge=${deepDiscountBadge || 'none'}`);

		const productBadge = {
			sku: product.sku,
			name: product.name || webhookProduct?.name,
			price: product.price,
			salesPrice: salePrice,
			discountPercent: Number(discountPercent.toFixed(2)),
			tierRank: matchedTierRank,
			tierThreshold: matchedTier ? matchedTier.percentage : null,
			deepDiscountBadge,
			enrichedAt: new Date().toISOString(),
		};

		const stateKey = await saveProductBadgeToState(product.sku, productBadge, logger);
		logger.info(`set-product-badging completed successfully for sku=${product.sku}`);

		return {
			statusCode: 200,
			body: {
				op: 'success',
				message: 'Product badge calculated and saved to state.',
				stateKey,
				...productBadge,
			},
		};
	} catch (error) {
		logger.error('Action failed:', error.message);
		if (error?.stack) {
			logger.error(`Action stack: ${error.stack}`);
		}
		return {
			statusCode: 200,
			body: {
				op: 'success',
				message: 'Webhook handler failed; returning success to avoid retries.',
			},
		};
	}
}

exports.main = main;
