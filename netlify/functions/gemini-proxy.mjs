import { buildHeaders, getProxyPath, proxyFetch } from './_proxy-utils.mjs';

export const handler = async (event) => {
  const proxyPath = getProxyPath(event, 'gemini-proxy', 'gemini-proxy');
  const url = new URL(`https://generativelanguage.googleapis.com${proxyPath}`);
  const incomingUrl = new URL(event.rawUrl || `https://local${event.path || ''}`);

  incomingUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  if (process.env.GEMINI_API_KEY) {
    url.searchParams.set('key', process.env.GEMINI_API_KEY);
  }

  return proxyFetch(event, url.toString(), buildHeaders(event));
};
