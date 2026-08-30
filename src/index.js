export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve the PadhAI website
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(
        `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PadhAI</title>
</head>
<body>
  <h1>📚 PadhAI</h1>
  <p>Your PadhAI website is connected to Cloudflare!</p>
</body>
</html>`,
        {
          headers: {
            "content-type": "text/html;charset=UTF-8"
          }
        }
      );
    }

    // Test D1
    if (url.pathname === "/api/test-db") {
      const result = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();

      return Response.json({
        success: true,
        tables: result.results
      });
    }

    return new Response("PadhAI backend is running 🚀");
  }
};
