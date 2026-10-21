const { Core } = require('@adobe/aio-sdk');
const stateLib = require('@adobe/aio-lib-state');

const CONFIG_STATE_KEY = 'badge-config-v1';
const ENTRY_COUNT = 3;

const DEFAULT_CONFIG = [
  { percentage: 20, badgeText: 'Deep Discount!' },
  { percentage: 30, badgeText: 'Super Saver!' },
  { percentage: 40, badgeText: 'Hot Deal!' },
];

function jsonResponse (statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  };
}

function getRequestBody (params) {
  if (typeof params.__ow_body === 'object' && params.__ow_body !== null) {
    return params.__ow_body;
  }

  if (typeof params.__ow_body === 'string' && params.__ow_body.trim()) {
    try {
      return JSON.parse(params.__ow_body);
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeEntriesFromPayload (payload) {
  const candidate = payload?.config || payload?.tiers || payload?.thresholds;

  if (Array.isArray(candidate)) {
    return candidate.map((entry) => ({
      percentage: Number(entry?.percentage ?? entry?.threshold),
      badgeText: String(entry?.badgeText ?? entry?.label ?? '').trim(),
    }));
  }

  return [1, 2, 3].map((index) => ({
    percentage: Number(payload?.[`percentage${index}`]),
    badgeText: String(payload?.[`badgeText${index}`] ?? '').trim(),
  }));
}

function validateConfigEntries (entries) {
  const errors = [];

  if (!Array.isArray(entries) || entries.length !== ENTRY_COUNT) {
    errors.push(`Exactly ${ENTRY_COUNT} badge tiers are required.`);
    return errors;
  }

  entries.forEach((entry, index) => {
    const row = index + 1;
    if (!Number.isFinite(entry.percentage)) {
      errors.push(`Tier ${row}: percentage must be a valid number.`);
    } else if (entry.percentage <= 0 || entry.percentage > 100) {
      errors.push(`Tier ${row}: percentage must be between 1 and 100.`);
    }

    if (!entry.badgeText) {
      errors.push(`Tier ${row}: badgeText is required.`);
    }
  });

  const percentages = entries.map((entry) => entry.percentage);
  const uniquePercentages = new Set(percentages);
  if (uniquePercentages.size !== percentages.length) {
    errors.push('Percentages must be unique across all tiers.');
  }

  for (let i = 1; i < percentages.length; i += 1) {
    if (percentages[i] <= percentages[i - 1]) {
      errors.push('Percentages must be in strictly ascending order.');
      break;
    }
  }

  return errors;
}

async function getStoredConfig (state) {
  const stored = await state.get(CONFIG_STATE_KEY);
  if (!stored?.value) {
    return {
      tiers: DEFAULT_CONFIG,
      updatedAt: null,
      source: 'default',
    };
  }

  try {
    const parsed = JSON.parse(stored.value);
    return {
      tiers: Array.isArray(parsed?.tiers) ? parsed.tiers : DEFAULT_CONFIG,
      updatedAt: parsed?.updatedAt || null,
      source: 'state',
    };
  } catch {
    return {
      tiers: DEFAULT_CONFIG,
      updatedAt: null,
      source: 'default',
    };
  }
}

async function main (params) {
  const logger = Core.Logger('badge-config', {
    level: params.LOG_LEVEL || 'info',
  });

  try {
    const method = String(params.__ow_method || 'get').toLowerCase();

    if (method === 'options') {
      return jsonResponse(204, {});
    }

    const state = await stateLib.init();

    if (method === 'get') {
      const config = await getStoredConfig(state);
      return jsonResponse(200, config);
    }

    if (method !== 'post' && method !== 'put') {
      return jsonResponse(405, {
        error: 'Method not allowed. Use GET, POST, or PUT.',
      });
    }

    const requestBody = getRequestBody(params);
    const payload = { ...requestBody, ...params };
    const entries = normalizeEntriesFromPayload(payload);
    const validationErrors = validateConfigEntries(entries);

    if (validationErrors.length) {
      return jsonResponse(400, {
        error: 'Validation failed.',
        details: validationErrors,
      });
    }

    const config = {
      tiers: entries,
      updatedAt: new Date().toISOString(),
    };

    await state.put(CONFIG_STATE_KEY, JSON.stringify(config));
    logger.info('Badge configuration saved to state');

    return jsonResponse(200, {
      message: 'Badge configuration saved.',
      ...config,
    });
  } catch (error) {
    logger.error('Action failed:', error.message);
    return jsonResponse(500, {
      error: 'Internal server error',
    });
  }
}

exports.main = main;