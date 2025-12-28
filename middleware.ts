// Vercel Edge Middleware - runs server-side on Vercel's edge network
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static assets (assets folder)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|assets).*)',
  ],
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  
  // Allow static assets, API routes, and Next.js internals to pass through
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/') ||
    url.pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|woff|woff2|ttf|eot)$/)
  ) {
    // Let static assets pass through - don't return anything to allow default behavior
    return;
  }
  
  // Get password from environment variable (set in Vercel dashboard)
  // Default to 'elvin' if not set (for local dev, set APP_PASSWORD in .env)
  const expectedPassword = process.env.APP_PASSWORD || 'elvin';
  
  // Check if user is authenticated via cookie
  const cookies = request.headers.get('cookie') || '';
  const authCookie = cookies.includes('paper-lab-auth=authenticated');
  
  // Handle password submission via query parameter
  const submittedPassword = url.searchParams.get('password');
  if (submittedPassword) {
    if (submittedPassword === expectedPassword) {
      // Password correct - set auth cookie and redirect to remove password from URL
      return new Response(null, {
        status: 302,
        headers: {
          'Location': url.pathname,
          'Set-Cookie': 'paper-lab-auth=authenticated; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800', // 7 days
        },
      });
    } else {
      // Wrong password - show error
      url.searchParams.set('auth_error', '1');
      url.searchParams.delete('password');
      return new Response(null, {
        status: 302,
        headers: {
          'Location': url.toString(),
        },
      });
    }
  }
  
  // If authenticated, let request pass through (don't return anything)
  if (authCookie) {
    return;
  }
  
  // Not authenticated - show password form
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paper Lab - Authentication Required</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Display', 'Segoe UI', sans-serif;
      background: #f5f5f7;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; }
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 2rem;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    @media (prefers-color-scheme: dark) {
      .container { background: #2a2a2a; }
    }
    .icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 1.5rem;
      background: #f5f5f7;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }
    @media (prefers-color-scheme: dark) {
      .icon { background: #3a3a3a; }
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #1a1a1a;
    }
    @media (prefers-color-scheme: dark) {
      h1 { color: #f5f5f7; }
    }
    p {
      color: #666;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
    }
    @media (prefers-color-scheme: dark) {
      p { color: #999; }
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    input {
      width: 100%;
      padding: 0.75rem 1rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 0.875rem;
      background: #fafafa;
    }
    @media (prefers-color-scheme: dark) {
      input {
        background: #3a3a3a;
        border-color: #4a4a4a;
        color: #f5f5f7;
      }
    }
    input:focus {
      outline: none;
      border-color: #007AFF;
      background: white;
    }
    @media (prefers-color-scheme: dark) {
      input:focus { background: #4a4a4a; }
    }
    button {
      width: 100%;
      padding: 0.75rem;
      background: #1a1a1a;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    @media (prefers-color-scheme: dark) {
      button { background: #f5f5f7; color: #1a1a1a; }
    }
    button:hover { opacity: 0.9; }
    .error {
      color: #ff3b30;
      font-size: 0.875rem;
      margin-top: -0.5rem;
    }
    @media (prefers-color-scheme: dark) {
      .error { color: #ff453a; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🔒</div>
    <h1>Paper Lab</h1>
    <p>Enter password to continue</p>
    <form method="GET" action="${url.pathname}">
      <input type="password" name="password" placeholder="Password" autofocus required>
      ${url.searchParams.get('auth_error') ? '<div class="error">Incorrect password</div>' : ''}
      <button type="submit">Unlock</button>
    </form>
  </div>
</body>
</html>`;
  
  return new Response(html, {
    status: 401,
    headers: {
      'Content-Type': 'text/html',
    },
  });
}
