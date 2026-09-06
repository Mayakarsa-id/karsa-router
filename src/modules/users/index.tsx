import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { getDb, Bindings } from '../../shared/db-client'
import { Layout } from '../../shared/layout'

const app = new Hono<{ Bindings: Bindings }>()

// --- TOTP Utilities ---

function generateBase32Secret(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let secret = ''
  const randomValues = crypto.getRandomValues(new Uint8Array(length))
  for (let i = 0; i < length; i++) {
    secret += chars[randomValues[i] % chars.length]
  }
  return secret
}

function base32ToBuffer(base32: string): Uint8Array {
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (let i = 0; i < base32.length; i++) {
    const val = base32chars.indexOf(base32.charAt(i).toUpperCase())
    bits += val.toString(2).padStart(5, '0')
  }
  const buffer = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2)
  }
  return buffer
}

async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  const keyBuffer = base32ToBuffer(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )

  // Validate against current time, 30s before, and 30s after to account for clock drift
  const timeStep = Math.floor(Date.now() / 30000)

  for (let offset = -1; offset <= 1; offset++) {
    const step = timeStep + offset
    const counterBuffer = new ArrayBuffer(8)
    const counterView = new DataView(counterBuffer)
    counterView.setUint32(4, step, false) // DataView sets big-endian by default when littleEndian is false

    const signature = await crypto.subtle.sign('HMAC', key, counterBuffer)
    const hash = new Uint8Array(signature)
    const offsetByte = hash[19] & 0xf

    const otp = (
      ((hash[offsetByte] & 0x7f) << 24) |
      ((hash[offsetByte + 1] & 0xff) << 16) |
      ((hash[offsetByte + 2] & 0xff) << 8) |
      (hash[offsetByte + 3] & 0xff)
    ) % 1000000

    if (otp.toString().padStart(6, '0') === code.trim()) {
      return true
    }
  }
  return false
}

// --- Routes ---

app.get('/', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const db = getDb(c.env)
  const users = await db.execQuery('SELECT * FROM Users WHERE Username = ?', username)
  const user = users[0]

  return c.html(
    <Layout user={username}>
      <h2>Dashboard</h2>
      <h3>Your API Key</h3>
      {user.APIKEY ? (
        <div style={{ display: 'flex', gap: '10px' }}>
          <input id="apiKey" value={user.APIKEY} readOnly style={{ width: '300px' }} />
          <button onclick="navigator.clipboard.writeText(document.getElementById('apiKey').value).then(() => alert('Copied!'))">Copy</button>
          <form method="post" action="/users/revoke-key">
            <button type="submit">Revoke Key</button>
          </form>
        </div>
      ) : (
        <form method="post" action="/users/generate-key">
          <button type="submit">Generate API Key</button>
        </form>
      )}
      
      <br />
      <a href="/providers">Go to Providers</a>
    </Layout>
  )
})

app.post('/generate-key', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const apiKey = `sk-kr-${crypto.randomUUID().replace(/-/g, '')}`
  await getDb(c.env).execRun('UPDATE Users SET APIKEY = ? WHERE Username = ?', apiKey, username)
  return c.redirect('/users')
})

app.post('/revoke-key', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  await getDb(c.env).execRun('UPDATE Users SET APIKEY = NULL WHERE Username = ?', username)
  return c.redirect('/users')
})

app.post('/', async (c) => {
  const data = await c.req.parseBody()
  const username = data.Username as string
  const secret = generateBase32Secret()

  await getDb(c.env).execRun(
    'INSERT INTO Users (Username, TotpSecret) VALUES (?, ?)',
    username,
    secret
  )
  return c.redirect(`/users/qr?username=${encodeURIComponent(username)}`)
})

app.get('/qr', async (c) => {
  const username = c.req.query('username')
  if (!username) return c.redirect('/users')

  const db = getDb(c.env)
  const users = await db.execQuery('SELECT TotpSecret FROM Users WHERE Username = ?', username)
  if (users.length === 0) return c.redirect('/users')

  const secret = users[0].TotpSecret
  const appName = encodeURIComponent('Karsa Router')
  const otpAuthUrl = `otpauth://totp/${appName}:${username}?secret=${secret}&issuer=${appName}`

  return c.html(
    <Layout>
      <h2>Authenticator Setup for {username}</h2>
      <p>Scan this QR code with your Authenticator app.</p>

      <div id="qrcode" style={{ margin: '20px 0', padding: '20px', background: 'white', display: 'inline-block' }}></div>
      <p><strong>Manual Secret Key:</strong> <code>{secret}</code></p>

      <br />
      <a href={`/users/verify?username=${username}`}>Proceed to Verification →</a>

      <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
      <script dangerouslySetInnerHTML={{
        __html: `
          var qr = qrcode(0, 'M');
          qr.addData('${otpAuthUrl}');
          qr.make();
          document.getElementById('qrcode').innerHTML = qr.createImgTag(5);
        `
      }}></script>
    </Layout>
  )
})

// UI for inputting the code
app.get('/verify', (c) => {
  const username = c.req.query('username')
  const status = c.req.query('status')

  return c.html(
    <Layout>
      <h2>Verify Login</h2>
      {status === 'success' && <p style={{ color: 'green', fontWeight: 'bold' }}>✅ Verification Successful!</p>}
      {status === 'failed' && <p style={{ color: 'red', fontWeight: 'bold' }}>❌ Invalid Code. Try again.</p>}

      <form method="post" action="/users/verify">
        <input name="Username" placeholder="Username" required value={username || ''} />
        <input name="Code" placeholder="Enter 6-digit code" maxLength={6} required autocomplete="off" />
        <button type="submit">Verify</button>
      </form>
      <br />
      <a href="/users">← Back to Users</a>
    </Layout>
  )
})

// POST endpoint to validate the code
app.post('/verify', async (c) => {
  const { Username, Code } = await c.req.parseBody()

  const db = getDb(c.env)
  const users = await db.execQuery('SELECT TotpSecret FROM Users WHERE Username = ?', Username)

  if (users.length === 0) return c.redirect('/users/verify?status=failed')

  const secret = users[0].TotpSecret
  const isValid = await verifyTOTP(secret, Code as string)

  if (isValid) {
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 86400000).toISOString() // 1 day
    await db.execRun('INSERT INTO Sessions (Token, Username, ExpiresAt) VALUES (?, ?, ?)', token, Username, expiresAt)
    setCookie(c, 'session', token, { expires: new Date(expiresAt), httpOnly: true, path: '/' })
    return c.redirect('/users')
  } else {
    return c.redirect(`/users/verify?username=${Username}&status=failed`)
  }
})

app.get('/logout', (c) => {
  deleteCookie(c, 'session')
  return c.redirect('/users/verify')
})

app.get('/delete', async (c) => {
  await getDb(c.env).execRun('DELETE FROM Users WHERE Username = ?', c.req.query('id'))
  return c.redirect('/users')
})

export default app
