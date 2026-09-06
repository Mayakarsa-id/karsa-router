export const Layout = (props: { children: any; user?: string }) => (
  <html>
    <head>
      <title>Karsa Router</title>
      <link rel="stylesheet" href="/src/style.css" />
    </head>
    <body>
      <nav>
        <div>
          <a href="/users">Dashboard</a>
          <a href="/providers">Providers</a>
          <a href="/combos">Combos</a>
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
      {props.children}
    </body>
  </html>
)
