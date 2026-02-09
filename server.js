import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';
import Redis from 'ioredis';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

const sql = neon(process.env.DATABASE_URL);
const redis = new Redis(process.env.REDIS_URL);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

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
    
    const result = await sql`
      INSERT INTO users (email, username, password_hash, verified)
      VALUES (${email}, ${username}, ${hash}, true)
      RETURNING id, email, username
    `;

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
        username: user.username 
      } 
    });
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
      SELECT m.id, m.content, m.created_at, u.username, u.id as user_id
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
  const userRows = await sql`SELECT id, username FROM users WHERE id = ${socket.userId}`;
  if (userRows.length === 0) return socket.disconnect();

  const user = userRows[0];
  users.set(socket.userId, user.username);

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
      user_id: socket.userId
    });

    await redis.del(`typing:${socket.userId}`);
    io.emit('typing', { userId: socket.userId, typing: false });
  });

  socket.on('typing', async (typing) => {
    if (typing) {
      await redis.setex(`typing:${socket.userId}`, 5, user.username);
    } else {
      await redis.del(`typing:${socket.userId}`);
    }
    socket.broadcast.emit('typing', { username: user.username, typing });
  });

  socket.on('disconnect', async () => {
    users.delete(socket.userId);
    await redis.del(`typing:${socket.userId}`);
    io.emit('online', Array.from(users.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`server on port ${PORT}`));
