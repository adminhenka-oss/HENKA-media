import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ADMIN_EMAIL = 'adminhenka@gmail.com';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

async function getUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const res = await fetch('https://cqqucefsiuummabfqgbm.supabase.co/auth/v1/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY || '',
    },
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
    const { filename, contentType, dataBase64, folder } = req.body || {};
    if (!filename || !dataBase64) return res.status(400).json({ error: 'Data tidak lengkap.' });
    if (!/^image\//.test(contentType || '')) return res.status(400).json({ error: 'Hanya file gambar.' });

    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeFolder = String(folder || 'misc').replace(/[^a-zA-Z0-9/_-]/g, '_').replace(/^\/+|\/+$/g, '');
    const key = `${safeFolder}/${Date.now()}-${safeName}`;

    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: Buffer.from(dataBase64, 'base64'),
      ContentType: contentType,
    }));

    return res.status(200).json({ url: `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}` });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Upload gagal' });
  }
}
