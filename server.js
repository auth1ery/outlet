import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';
import Redis from 'ioredis';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

const sql = neon(process.env.DATABASE_URL);
const redis = new Redis(process.env.REDIS_URL);

const mailerSend = new MailerSend({
  apiKey: process.env.MAILERSEND_API_KEY,
});

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || 'https://s3.us-west-004.backblazeb2.com',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('only images allowed'));
    }
  }
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'unauthorized' });
  }
};

const genCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendEmail = async (email, code) => {
  const sentFrom = new Sender(process.env.MAILERSEND_FROM_EMAIL || 'onboarding@yourdomain.com', 'outlet');
  const recipients = [new Recipient(email)];
  
  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject('outlet - verify your email')
    .setText(`your verification code is: ${code}\n\nthis code expires in 10 minutes.`)
    .setHtml(`<p>your verification code is: <strong>${code}</strong></p><p>this code expires in 10 minutes.</p>`);

  await mailerSend.email.send(emailParams);
};

app.post('/api/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'missing fields' });
    }

    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'username must be 3-32 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const existing = await sql`SELECT id FROM users WHERE email = ${email} OR username = ${username}`;
    if (existing.length > 0) {
      return res.status(400).json({ error: 'email or username already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const code = genCode();
    
    await redis.setex(`verify:${email}`, 600, code);
    await redis.setex(`pending:${email}`, 600, JSON.stringify({ username, hash }));

    await sendEmail(email, code);

    res.json({ message: 'verification code sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/verify', async (req, res) => {
  try {
    const { email, code } = req.body;

    const stored = await redis.get(`verify:${email}`);
    if (!stored || stored !== code) {
      return res.status(400).json({ error: 'invalid or expired code' });
    }

    const data = await redis.get(`pending:${email}`);
    if (!data) {
      return res.status(400).json({ error: 'registration expired' });
    }

    const { username, hash } = JSON.parse(data);

    const result = await sql`
      INSERT INTO users (email, username, password_hash, verified, display_name)
      VALUES (${email}, ${username}, ${hash}, true, ${username})
      RETURNING id, email, username, display_name, avatar_url, bio, theme
    `;

    await redis.del(`verify:${email}`, `pending:${email}`);

    const token = jwt.sign({ id: result[0].id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user: result[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const users = await sql`SELECT * FROM users WHERE email = ${email}`;
    if (users.length === 0) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const user = users[0];

    if (!user.verified) {
      return res.status(401).json({ error: 'email not verified' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ 
      token, 
      user: { 
        id: user.id, 
        email: user.email, 
        username: user.username,
        display_name: user.display_name || user.username,
        avatar_url: user.avatar_url,
        bio: user.bio,
        theme: user.theme || 'dark'
      } 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/resend', async (req, res) => {
  try {
    const { email } = req.body;

    const data = await redis.get(`pending:${email}`);
    if (!data) {
      return res.status(400).json({ error: 'no pending registration' });
    }

    const code = genCode();
    await redis.setex(`verify:${email}`, 600, code);

    await sendEmail(email, code);

    res.json({ message: 'code resent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    jwt.verify(token, process.env.JWT_SECRET);

    const messages = await sql`
      SELECT m.id, m.content, m.created_at, u.username, u.display_name, u.avatar_url, u.id as user_id
      FROM messages m
      JOIN users u ON m.user_id = u.id
      ORDER BY m.created_at DESC
      LIMIT 100
    `;

    res.json(messages.reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const users = await sql`
      SELECT id, email, username, display_name, avatar_url, bio, theme, created_at
      FROM users WHERE id = ${req.userId}
    `;
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'user not found' });
    }

    res.json(users[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/profile', authMiddleware, async (req, res) => {
  try {
    const { display_name, bio, theme } = req.body;

    const updates = {};
    if (display_name !== undefined) {
      if (display_name.length < 1 || display_name.length > 32) {
        return res.status(400).json({ error: 'display name must be 1-32 characters' });
      }
      updates.display_name = display_name;
    }
    if (bio !== undefined) {
      if (bio.length > 200) {
        return res.status(400).json({ error: 'bio must be under 200 characters' });
      }
      updates.bio = bio;
    }
    if (theme !== undefined) {
      if (!['dark', 'light', 'midnight', 'ocean'].includes(theme)) {
        return res.status(400).json({ error: 'invalid theme' });
      }
      updates.theme = theme;
    }

    const result = await sql`
      UPDATE users 
      SET display_name = COALESCE(${updates.display_name}, display_name),
          bio = COALESCE(${updates.bio}, bio),
          theme = COALESCE(${updates.theme}, theme)
      WHERE id = ${req.userId}
      RETURNING id, email, username, display_name, avatar_url, bio, theme
    `;

    res.json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/profile/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'no file uploaded' });
    }

    const fileExt = req.file.originalname.split('.').pop();
    const fileName = `avatars/${req.userId}-${Date.now()}.${fileExt}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read'
    });

    await s3Client.send(command);

    const avatarUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

    const result = await sql`
      UPDATE users 
      SET avatar_url = ${avatarUrl}
      WHERE id = ${req.userId}
      RETURNING id, email, username, display_name, avatar_url, bio, theme
    `;

    res.json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

const users = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('unauthorized'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});

io.on('connection', async (socket) => {
  const userRows = await sql`
    SELECT id, username, display_name, avatar_url 
    FROM users WHERE id = ${socket.userId}
  `;
  if (userRows.length === 0) return socket.disconnect();

  const user = userRows[0];
  users.set(socket.userId, {
    username: user.username,
    display_name: user.display_name || user.username,
    avatar_url: user.avatar_url
  });

  io.emit('online', Array.from(users.values()));

  socket.on('message', async (data) => {
    if (!data.content || data.content.length > 2000) return;

    const result = await sql`
      INSERT INTO messages (user_id, content)
      VALUES (${socket.userId}, ${data.content})
      RETURNING id, content, created_at
    `;

    io.emit('message', {
      id: result[0].id,
      content: result[0].content,
      created_at: result[0].created_at,
      username: user.username,
      display_name: user.display_name || user.username,
      avatar_url: user.avatar_url,
      user_id: socket.userId
    });

    await redis.del(`typing:${socket.userId}`);
    io.emit('typing', { userId: socket.userId, typing: false });
  });

  socket.on('typing', async (typing) => {
    if (typing) {
      await redis.setex(`typing:${socket.userId}`, 5, user.display_name || user.username);
    } else {
      await redis.del(`typing:${socket.userId}`);
    }
    socket.broadcast.emit('typing', { 
      username: user.display_name || user.username, 
      typing 
    });
  });

  socket.on('disconnect', async () => {
    users.delete(socket.userId);
    await redis.del(`typing:${socket.userId}`);
    io.emit('online', Array.from(users.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`server on port ${PORT}`));
