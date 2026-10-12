// Only this reviewed, static demo may be embedded in the bundled help site.
// Its sandbox has an opaque origin and cannot contact the app or model server.
export function websiteDemoHeaders(file) {
  if (file === 'demos/red-ball-original.html') return {
    'Content-Disposition': 'attachment; filename="red-ball.html"',
    'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
  if (file !== 'demos/red-ball.html') return {};
  return {
    'Content-Security-Policy': "default-src 'none'; script-src 'sha256-RXiiXfzWai+ANLvbJwSHcJg+jYeAqyRa1l7COkJYEuU='; style-src 'sha256-fkdb4Po/lSjLjnscoX9/UM6E95XC6NLjD6sumVb7+ls='; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts",
    'Referrer-Policy': 'no-referrer',
  };
}
