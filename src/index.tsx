import { Hono } from 'hono'
import { DBServer } from './db'
import { Bindings } from './shared/db-client'
import { authMiddleware } from './middleware/auth'
import usersModule from './modules/users'
import providersModule from './modules/providers'
import combosModule from './modules/combos'
import registerRoutes from './routes/register'
import aiRoutes from './routes/ai/index'

export { DBServer }

const app = new Hono<{ Bindings: Bindings }>()

app.use(authMiddleware)

app.get('/', (c) => c.redirect('/users'))

app.route('/register', registerRoutes)
app.route('/users', usersModule)
app.route('/providers', providersModule)
app.route('/combos', combosModule)
app.route('/ai/openai-compatible/v1', aiRoutes)

export default app
