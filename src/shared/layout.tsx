export const Layout = (props: { children: any; user?: string }) => (
  <html>
    <head>
      <title>Karsa Router</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Syne:wght@800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />
      <style>{`
        :root { --black:#0a0a0a; --white:#fffef7; --accent:#ff3b30; --yellow:#ffe600; }
        *{box-sizing:border-box}
        html{{background:var(--white)}}
        body{{margin:0; font-family:'Space Grotesk',system-ui,sans-serif; background:var(--white); color:var(--black); max-width:960px; margin:0 auto; padding:0 20px 40px;}}
        nav{{display:flex; justify-content:space-between; align-items:center; border-bottom:6px solid var(--black); padding:18px 0 14px; margin-bottom:28px; position:sticky; top:0; background:var(--white); z-index:10;}}
        nav div{{display:flex; gap:18px; align-items:center;}}
        nav a{{font-family:'Syne',sans-serif; font-weight:800; font-size:14px; letter-spacing:0.12em; text-transform:uppercase; text-decoration:none; color:var(--black); border-bottom:3px solid transparent; padding-bottom:2px;}}
        nav a:hover{{border-bottom-color:var(--accent); color:var(--accent);}}
        h2{{font-family:'Syne',sans-serif; font-weight:800; font-size:56px; line-height:0.85; letter-spacing:-0.04em; text-transform:uppercase; margin:12px 0 18px;}}
        h3{{font-family:'Syne',sans-serif; font-weight:800; font-size:22px; letter-spacing:-0.02em; text-transform:uppercase; border-left:8px solid var(--accent); padding-left:12px; margin:32px 0 14px;}}
        p, li{{font-weight:700; line-height:1.4;}}
        code{{font-family:'JetBrains Mono',monospace; background:var(--black); color:var(--yellow); padding:2px 6px; font-size:13px;}}
        a{{color:var(--black); font-weight:700}}
        a:hover{{color:var(--accent)}}
        form{{margin-bottom:22px; padding:20px; background:var(--white); border:4px solid var(--black); box-shadow:8px 8px 0 var(--black);}}
        label{{font-weight:800; text-transform:uppercase; font-size:12px; letter-spacing:0.08em;}}
        input, select{{font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:14px; padding:12px 14px; border:3px solid var(--black); background:var(--white); outline:none; flex:1 1 auto; min-width:160px;}}
        input:focus, select:focus{{background:var(--yellow);}}
        input[readonly]{{background:#f0ede6;}}
        button{{font-family:'Syne',sans-serif; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; font-size:13px; padding:12px 20px; background:var(--black); color:var(--white); border:3px solid var(--black); cursor:pointer; box-shadow:4px 4px 0 var(--black); transition:all 0.1s;}}
        button:hover{{background:var(--accent); border-color:var(--accent); transform:translate(-1px,-1px); box-shadow:5px 5px 0 var(--black);}}
        button:active{{transform:translate(2px,2px); box-shadow:2px 2px 0 var(--black);}}
        table{{width:100%; border-collapse:collapse; border:4px solid var(--black); background:var(--white); box-shadow:8px 8px 0 var(--black); margin-bottom:24px;}}
        thead tr{{background:var(--black); color:var(--white);}}
        th{{font-family:'Syne',sans-serif; font-weight:800; text-transform:uppercase; font-size:11px; letter-spacing:0.1em; padding:14px 10px; text-align:left; white-space:nowrap;}}
        td{{font-weight:700; font-size:13px; padding:10px; border-top:2px solid var(--black); border-right:2px solid #111;}}
        tr:nth-child(even) td{{background:#f7f5eb;}}
        ul, ol{{padding-left:22px;}}
        ul li::marker{{color:var(--accent);}}
        hr{{border:none; border-top:4px solid var(--black); margin:20px 0;}}
      `}</style>
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
