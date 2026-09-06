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
  const censoredKey = user.APIKEY ? `${(user.APIKEY as string).slice(0, 8)}${'•'.repeat(8)}${(user.APIKEY as string).slice(-4)}` : ''
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
        <div class="card">
          <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; font-weight:700; margin-bottom:8px;">API Key — keep secret (censored)</div>
          <div style="display:flex; gap:10px; align-items:stretch; flex-wrap:wrap;">
            <input id="apiKey" value={censoredKey} data-full={user.APIKEY} readOnly style="flex:1 1 340px; font-family:ui-monospace,monospace; font-size:13px; letter-spacing:0.02em;" />
            <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('apiKey').dataset.full).then(()=>{const b=event.target;b.textContent='Copied!';setTimeout(()=>b.textContent='Copy',1500)})">Copy</button>
            <form method="post" action="/users/revoke-key" style="margin:0; border:none; padding:0; box-shadow:none; background:none;">
              <button type="submit">Revoke</button>
            </form>
          </div>
          <div style="font-size:12px; margin-top:8px;">Use as <code>Authorization: Bearer $KARSA_API_KEY</code></div>
        </div>
      ) : (
        <div class="card-muted">
          <p style="margin:0 0 10px; font-size:13px;">No API key yet — generate to call <code>/ai/openai-compatible/v1/*</code></p>
          <form method="post" action="/users/generate-key" style="margin:0; border:none; padding:0; box-shadow:none; background:none;">
            <button type="submit">Generate API Key</button>
          </form>
        </div>
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

      <h3>How to Use</h3>
      <div class="card" style="display:grid; gap:12px;">
        <div><strong>Base URL</strong> <code>{c.req.url.replace(/\/users.*$/, '')}/ai/openai-compatible/v1</code></div>
        <div><strong>Auth</strong> <code>Authorization: Bearer $KARSA_API_KEY</code> <span style="font-size:12px; opacity:0.7;">— export KARSA_API_KEY="sk-kr-..."</span></div>
        <div style="display:grid; gap:8px;">
          <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; font-weight:700;">List models</div>
          <pre style="margin:0; padding:10px; border:2px solid #000; background:#fff; overflow:auto; font-size:12px;"><code>curl -H "Authorization: Bearer $KARSA_API_KEY" \
  {c.req.url.replace(/\/users.*$/, '')}/ai/openai-compatible/v1/models</code></pre>
        </div>
        <div style="display:grid; gap:8px;">
          <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; font-weight:700;">Chat completions — prefix/model</div>
          <pre style="margin:0; padding:10px; border:2px solid #000; background:#fff; overflow:auto; font-size:12px;"><code>{`curl -X POST ${c.req.url.replace(/\/users.*$/, '')}/ai/openai-compatible/v1/chat/completions \\
  -H "Authorization: Bearer $KARSA_API_KEY" -H "Content-Type: application/json" \\
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'`}</code></pre>
        </div>
        <div style="display:grid; gap:8px;">
          <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; font-weight:700;">Combo fallback</div>
          <pre style="margin:0; padding:10px; border:2px solid #000; background:#fff; overflow:auto; font-size:12px;"><code>{`curl -X POST ${c.req.url.replace(/\/users.*$/, '')}/ai/openai-compatible/v1/chat/completions \\
  -H "Authorization: Bearer $KARSA_API_KEY" -H "Content-Type: application/json" \\
  -d '{"model":"combo/fast","messages":[{"role":"user","content":"hi"}]}'`}</code></pre>
        </div>
        <p style="margin:0; font-size:12px;">Model format: <code>Prefix/model-id</code> or <code>combo/NAME</code>. Timeout & key fallback automatic.</p>
      </div>



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

      <form method="post" action="/users/verify" style="display:grid; gap:14px;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label>Username</label>
          <input name="Username" placeholder="Username" required value={username || ''} />
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; align-items:center;">
          <label>6-digit Code</label>
          <input name="Code" placeholder="· · · · · ·" maxLength={6} required autocomplete="off" inputmode="numeric" pattern="[0-9]*" oninput="this.value=this.value.replace(/[^0-9]/g,'')" style="text-align:center; letter-spacing:0.55em; font-size:32px; font-weight:900; padding:16px 12px; max-width:340px; font-family:ui-monospace,monospace; text-indent:0.55em;" />
          <span style="font-size:11px; letter-spacing:0.06em; opacity:0.7;">Authenticator app • 30s window</span>
        </div>
        <div><button type="submit">Verify</button></div>
      </form>
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
