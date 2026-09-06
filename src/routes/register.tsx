import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { getDb, Bindings } from '../shared/db-client'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.html(
    <html>
      <head>
        <title>Register — Karsa Router</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <h2>JOIN<br/>KARSA</h2>
        <p style="font-size:14px; letter-spacing:0.06em; text-transform:uppercase; border-left:8px solid var(--accent); padding-left:12px">Create identity — TOTP secured</p>
        <form method="post" action="/register">
          <input name="Username" placeholder="USERNAME" required style="text-transform:uppercase" />
          <button type="submit">Register →</button>
        </form>
        <p><a href="/users/verify" style="font-weight:800; text-transform:uppercase; letter-spacing:0.08em; text-decoration:none; border-bottom:3px solid var(--black)">Already have account? Login</a></p>
      </body>
    </html>
  )
})

app.post('/', async (c) => {
  const { Username } = await c.req.parseBody()
  const username = Username as string
  const db = getDb(c.env)
  const existing = await db.execQuery('SELECT * FROM Users WHERE Username = ?', username)
  if (existing.length > 0) return c.redirect('/register?error=exists')
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let secret = ''
  const randomValues = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 16; i++) secret += chars[randomValues[i] % chars.length]
  await db.execRun('INSERT INTO Users (Username, TotpSecret) VALUES (?, ?)', username, secret)
  const apiKey = `sk-kr-${crypto.randomUUID().replace(/-/g, '')}`
  await db.execRun('UPDATE Users SET APIKEY = ? WHERE Username = ?', apiKey, username)
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 86400000).toISOString()
  await db.execRun('INSERT INTO Sessions (Token, Username, ExpiresAt) VALUES (?, ?, ?)', token, username, expiresAt)
  setCookie(c, 'session', token, { expires: new Date(expiresAt), httpOnly: true, path: '/' })
  return c.redirect(`/users/qr?username=${encodeURIComponent(username)}`)
})

export default app
