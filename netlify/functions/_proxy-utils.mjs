const TEXT_RESPONSE_TYPES = [
  'application/json',
  'application/problem+json',
  'text/'
];

export const getProxyPath = (event, functionName, publicPrefix) => {
  const rawPath = event.path || '';
  const markers = [
    `/.netlify/functions/${functionName}`,
    `/${publicPrefix}`
  ];

  for (const marker of markers) {
    if (rawPath.startsWith(marker)) {
      const rest = rawPath.slice(marker.length);
      return rest.startsWith('/') ? rest : `/${rest}`;
    }
  }

  return '/';
};

export const buildHeaders = (event, overrides = {}) => {
  const incoming = event.headers || {};
  const headers = {};

  for (const [key, value] of Object.entries(incoming)) {
    const lowerKey = key.toLowerCase();
    if (['host', 'connection', 'content-length'].includes(lowerKey)) continue;
    headers[key] = value;
  }

  return {
    ...headers,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined && value !== null && value !== '')
    )
  };
};

export const proxyFetch = async (event, targetUrl, headers) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders()
    };
  }

  const response = await fetch(targetUrl, {
    method: event.httpMethod,
    headers,
    body: ['GET', 'HEAD'].includes(event.httpMethod)
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64')
        : event.body
  });

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const isTextResponse = TEXT_RESPONSE_TYPES.some(type => contentType.includes(type));
  const responseHeaders = {
    ...corsHeaders(),
    'content-type': contentType
  };

  if (isTextResponse) {
    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: await response.text()
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: buffer.toString('base64'),
    isBase64Encoded: true
  };
};

export const corsHeaders = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-api-key,anthropic-version'
});
