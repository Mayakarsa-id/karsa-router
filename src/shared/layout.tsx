export const Layout = (props: { children: any; user?: string }) => (
  <html>
    <head>
      <title>Karsa Router</title>
      <link rel="stylesheet" href="/src/style.css" />
      <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch{}})()` }}></script>
    </head>
    <body>
      <nav>
        <div>
          <a href="/users">Dashboard</a>
          <a href="/providers">Providers</a>
          <a href="/combos">Combos</a>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button type="button" onclick="try{var d=document.documentElement.classList.toggle('dark');localStorage.setItem('theme',d?'dark':'light')}catch{}" style="padding:4px 10px; font-size:11px;">◐ Theme</button>
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
