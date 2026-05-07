import { buildHeaders, getProxyPath, proxyFetch } from './_proxy-utils.mjs';

export const handler = async (event) => {
  const proxyPath = getProxyPath(event, 'kie-upload-proxy', 'kie-upload-proxy');
  const url = new URL(`https://kieai.redpandaai.co${proxyPath}`);
  const incomingUrl = new URL(event.rawUrl || `https://local${event.path || ''}`);

  incomingUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers = buildHeaders(event, {
    Authorization: process.env.KIE_AI_API_KEY ? `Bearer ${process.env.KIE_AI_API_KEY}` : undefined
  });

  return proxyFetch(event, url.toString(), headers);
};
