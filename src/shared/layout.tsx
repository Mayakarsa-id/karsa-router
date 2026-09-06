export const Layout = (props: { children: any }) => (
  <html>
    <head>
      <title>Entity CRUD - Modular</title>
      <style>{`
        body { font-family: system-ui; padding: 20px; max-width: 800px; margin: 0 auto; }
        nav a { margin-right: 15px; font-weight: bold; text-decoration: none; color: #0066cc; }
        form { margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px; }
        input { margin-right: 10px; padding: 5px; }
        button { padding: 5px 15px; cursor: pointer; }
      `}</style>
    </head>
    <body>
      <nav>
        <a href="/users">Users</a>
        <a href="/providers">Providers</a>
        <a href="/keys">Keys</a>
        <a href="/usages">Usages</a>
      </nav>
      <hr />
      {props.children}
    </body>
  </html>
)
