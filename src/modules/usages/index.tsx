import { Hono } from 'hono'
import { getDb, Bindings } from '../../shared/db-client'
import { Layout } from '../../shared/layout'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  const db = getDb(c.env)
  const usages = await db.execQuery('SELECT * FROM Usages')
  return c.html(
    <Layout>
      <h2>Usages</h2>
      <form method="post" action="/usages">
        <input name="APIKEY" placeholder="API Key" required />
        <input name="InputToken" placeholder="Input Tokens" type="number" required />
        <input name="OutputToken" placeholder="Output Tokens" type="number" required />
        <button type="submit">Record Usage</button>
      </form>
      <ul>
        {usages.map((u: any) => (
          <li>ID: {u.Id} | Key: {u.APIKEY} | In: {u.InputToken} | Out: {u.OutputToken} - <a href={`/usages/delete?id=${u.Id}`}>Delete</a></li>
        ))}
      </ul>
    </Layout>
  )
})

app.post('/', async (c) => {
  const { APIKEY, InputToken, OutputToken } = await c.req.parseBody()
  await getDb(c.env).execRun('INSERT INTO Usages (APIKEY, InputToken, OutputToken) VALUES (?, ?, ?)', APIKEY, InputToken, OutputToken)
  return c.redirect('/usages')
})

app.get('/delete', async (c) => {
  await getDb(c.env).execRun('DELETE FROM Usages WHERE Id = ?', c.req.query('id'))
  return c.redirect('/usages')
})

export default app
