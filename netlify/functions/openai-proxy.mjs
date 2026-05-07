import { buildHeaders, getProxyPath, proxyFetch } from './_proxy-utils.mjs';

export const handler = async (event) => {
  const proxyPath = getProxyPath(event, 'openai-proxy', 'openai-proxy');
  const url = new URL(`https://api.openai.com${proxyPath}`);
  const incomingUrl = new URL(event.rawUrl || `https://local${event.path || ''}`);

  incomingUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers = buildHeaders(event, {
    Authorization: process.env.OPENAI_API_KEY ? `Bearer ${process.env.OPENAI_API_KEY}` : undefined
  });

  return proxyFetch(event, url.toString(), headers);
};
