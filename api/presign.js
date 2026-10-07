import crypto from 'node:crypto';

const ADMIN_EMAIL = 'adminhenka@gmail.com';

// ---- tanda tangan AWS Signature V4 (untuk URL unggah langsung ke R2) ----
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
function sha256hex(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function uriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function presignUrl({
  method, origin, host, canonicalUri, region, service = 's3',
  accessKeyId, secretAccessKey, headers = {}, expires = 900, now = new Date(),
}) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const all = { ...headers, host };
  const names = Object.keys(all).map(n => n.toLowerCase()).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map(n => `${n}:${String(all[Object.keys(all).find(k => k.toLowerCase() === n)]).trim()}\n`).join('');

  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query).sort()
    .map(k => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&');

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  return `${origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ---- cek login admin lewat Supabase ----
async function getUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const res = await fetch('https://cqqucefsiuummabfqgbm.supabase.co/auth/v1/user', {
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY || '' },
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Harus login dulu.' });
  if ((user.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Hanya admin yang boleh mengunggah.' });
  }

  try {
    const { filename, contentType, folder } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'Nama file kosong.' });
    const ct = String(contentType || '').toLowerCase();
    if (!/^image\/[a-z0-9.+-]+$/.test(ct)) return res.status(400).json({ error: 'Hanya file gambar.' });

    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const safeFolder = String(folder || 'misc').replace(/[^a-zA-Z0-9/_-]/g, '_').replace(/^\/+|\/+$/g, '');
    const rand = crypto.randomBytes(3).toString('hex');
    const key = `${safeFolder}/${Date.now()}-${rand}-${safeName}`;

    const endpoint = new URL(process.env.R2_ENDPOINT);
    const bucket = process.env.R2_BUCKET;
    const canonicalUri = '/' + [bucket, ...key.split('/')].map(uriEncode).join('/');

    const uploadUrl = presignUrl({
      method: 'PUT',
      origin: endpoint.origin,
      host: endpoint.host,
      canonicalUri,
      region: 'auto',
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      headers: { 'content-type': ct },
      expires: 900,
    });

    const publicUrl = `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
    return res.status(200).json({ uploadUrl, publicUrl, contentType: ct });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Gagal membuat izin unggah' });
  }
}
