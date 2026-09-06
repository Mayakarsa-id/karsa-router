import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { getDb, Bindings } from '../shared/db-client'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.html(
    <html>
      <head>
        <title>Register — Karsa Router</title>
        <link rel="stylesheet" href="/src/style.css" />
      </head>
      <body>
        <h2>REGISTER</h2>
        <p>TOTP secured — create identity</p>
        <form method="post" action="/register" style="display:grid; gap:14px;">
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label>Username</label>
            <input name="Username" placeholder="USERNAME" required />
          </div>
          <div><button type="submit">Register</button></div>
        </form>
        <p><a href="/users/verify">Already have account? Login</a></p>
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
