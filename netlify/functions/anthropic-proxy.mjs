import { buildHeaders, getProxyPath, proxyFetch } from './_proxy-utils.mjs';

export const handler = async (event) => {
  const proxyPath = getProxyPath(event, 'anthropic-proxy', 'anthropic-proxy');
  const url = new URL(`https://api.anthropic.com${proxyPath}`);
  const incomingUrl = new URL(event.rawUrl || `https://local${event.path || ''}`);

  incomingUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers = buildHeaders(event, {
    'x-api-key': process.env.ANTHROPIC_API_KEY || undefined,
    'anthropic-version': event.headers?.['anthropic-version'] || event.headers?.['Anthropic-Version'] || '2023-06-01'
  });

  return proxyFetch(event, url.toString(), headers);
};
