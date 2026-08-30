import html from "../index.html";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test-db") {
      const result = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();

      return Response.json({
        success: true,
        tables: result.results
      });
    }

    return new Response(html, {
      headers: {
        "content-type": "text/html;charset=UTF-8"
      }
    });
  }
};
