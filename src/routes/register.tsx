import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { getDb, Bindings } from '../shared/db-client'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.html(
    <html>
      <head>
        <title>Register — Karsa Router</title>
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Syne:wght@800&display=swap" rel="stylesheet" />
        <style>{` :root{--black:#0a0a0a;--white:#fffef7;--accent:#ff3b30;--yellow:#ffe600} *{box-sizing:border-box} body{margin:0;font-family:'Space Grotesk',system-ui,sans-serif;background:var(--white);color:var(--black);max-width:560px;margin:0 auto;padding:40px 20px} h2{font-family:'Syne',sans-serif;font-weight:800;font-size:56px;line-height:0.85;letter-spacing:-0.04em;text-transform:uppercase;margin:0 0 18px} p{font-weight:700} form{padding:24px;background:var(--white);border:4px solid var(--black);box-shadow:8px 8px 0 var(--black)} input{font-weight:700;font-size:14px;padding:12px 14px;border:3px solid var(--black);width:100%} input:focus{background:var(--yellow);outline:none} button{margin-top:14px;font-family:'Syne',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;font-size:13px;padding:12px 20px;background:var(--black);color:var(--white);border:3px solid var(--black);cursor:pointer;box-shadow:4px 4px 0 var(--black);width:100%} button:hover{background:var(--accent);border-color:var(--accent)}`}</style>
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
