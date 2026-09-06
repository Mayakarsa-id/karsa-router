import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { getDb, Bindings } from '../../shared/db-client'
import { Layout } from '../../shared/layout'
import { getCurrentUser } from '../../shared/auth'
import { generateBase32Secret, verifyTOTP } from '../../shared/totp'

const app = new Hono<{ Bindings: Bindings }>()

// --- Routes ---

app.get('/', async (c) => {
  const username = await getCurrentUser(c)
  if (!username) return c.redirect('/users/verify')

  const db = getDb(c.env)
  const users = await db.execQuery('SELECT * FROM Users WHERE Username = ?', username)
  const user = users[0] as any
  let usages: any[] = []
  if (user.APIKEY) {
    try {
      usages = await db.execQuery('SELECT * FROM Usages WHERE APIKEY = ? ORDER BY Id DESC LIMIT 10', user.APIKEY) as any[]
    } catch {}
  }

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

      <h3>User Stats</h3>
      <table border={1} cellpadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th>Request</th><th>Input Token</th><th>Cached Token</th><th>Output Token</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{(user as any).RequestCount ?? 0}</td>
            <td>{(user as any).InputToken ?? 0}</td>
            <td>{(user as any).CachedToken ?? 0}</td>
            <td>{(user as any).OutputToken ?? 0}</td>
          </tr>
        </tbody>
      </table>

      <h3>Usage Logs (10 newest)</h3>
      <table border={1} cellpadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th>#</th><th>Provider</th><th>Model</th><th>Input</th><th>Output</th><th>Cached</th><th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {usages.length === 0 ? (
            <tr><td colspan={7} style={{ textAlign: 'center' }}>No usage yet</td></tr>
          ) : (
            usages.map((u: any, i: number) => (
              <tr>
                <td>{i + 1}</td>
                <td>{u.Provider || '-'}</td>
                <td>{u.Model || '-'}</td>
                <td>{u.InputToken ?? 0}</td>
                <td>{u.OutputToken ?? 0}</td>
                <td>{u.CachedToken ?? 0}</td>
                <td><span data-ts={u.TriggerAt}>{u.TriggerAt}</span></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <script dangerouslySetInnerHTML={{ __html: `document.querySelectorAll('[data-ts]').forEach(el=>{try{const v=el.getAttribute('data-ts');const d=new Date(v.replace(' ','T')+(v.endsWith('Z')?'':'Z'));el.textContent=d.toLocaleString();}catch{}})` }}></script>

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
  const currentUser = await getCurrentUser(c)
  const username = c.req.query('username')
  if (!username) return c.redirect('/users')
  if (!currentUser || currentUser !== username) return c.text('Forbidden: cannot access other user QR', 403)

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
    await db.execRun('UPDATE Users SET IsVerified = 1 WHERE Username = ?', Username)
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
