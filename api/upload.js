import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SUPABASE_URL = 'https://cqqucefsiuummabfqgbm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxcXVjZWZzaXV1bW1hYmZxZ2JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4OTYxNDgsImV4cCI6MjEwNTQ3MjE0OH0.GlEdvsTLUFGON4o7DHirG7ShyapiIEhK7_yADqNn1w8';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT, // contoh: https://<account_id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function verifyUser(token){
  if(!token) return null;
  try{
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if(!res.ok) return null;
    return await res.json();
  }catch(e){
    return null;
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const user = await verifyUser(token);
  if (!user) {
    return res.status(401).json({ error: 'Kamu harus masuk dengan Google dulu.' });
  }

  try {
    const { filename, contentType, dataBase64, folder } = req.body || {};

    if (!filename || !dataBase64) {
      return res.status(400).json({ error: 'Data gambar tidak lengkap' });
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${folder || 'uploads'}/${Date.now()}-${safeName}`;

    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }));

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    return res.status(200).json({ url: publicUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Gagal mengunggah gambar. Coba lagi.' });
  }
}
