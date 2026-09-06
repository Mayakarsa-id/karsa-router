export const Layout = (props: { children: any; user?: string }) => (
  <html>
    <head>
      <title>Karsa Router</title>
      <style>{`
        body { font-family: system-ui; padding: 20px; max-width: 800px; margin: 0 auto; }
        nav { display: flex; justify-content: space-between; align-items: center; }
        nav a { margin-right: 15px; font-weight: bold; text-decoration: none; color: #0066cc; }
        form { margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px; }
        input { margin-right: 10px; padding: 5px; }
        button { padding: 5px 15px; cursor: pointer; }
      `}</style>
    </head>
    <body>
      <nav>
        <div>
          <a href="/users">Dashboard</a>
          <a href="/providers">Providers</a>
        </div>
        <div>
          {props.user ? (
            <a href="/users/logout">Logout ({props.user})</a>
          ) : (
            <>
              <a href="/register">Register</a>
              <a href="/users/verify">Login</a>
            </>
          )}
        </div>
      </nav>
      <hr />
      {props.children}
    </body>
  </html>
)
