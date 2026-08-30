import html from "../index.html";

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CREATE ACCOUNT
    if (url.pathname === "/api/signup" && request.method === "POST") {
      try {
        const { name, email, password } = await request.json();

        if (!name || !email || !password) {
          return Response.json(
            { success: false, error: "All fields are required." },
            { status: 400 }
          );
        }

        if (password.length < 6) {
          return Response.json(
            { success: false, error: "Password must be at least 6 characters." },
            { status: 400 }
          );
        }

        const passwordHash = await hashPassword(password);

        const result = await env.DB
          .prepare(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
          )
          .bind(name, email.toLowerCase().trim(), passwordHash)
          .run();

        return Response.json({
          success: true,
          userId: result.meta.last_row_id
        });

      } catch (error) {
        if (error.message && error.message.includes("UNIQUE")) {
          return Response.json(
            { success: false, error: "Email already registered." },
            { status: 409 }
          );
        }

        return Response.json(
          { success: false, error: "Could not create account." },
          { status: 500 }
        );
      }
    }

    // TEST DATABASE
    if (url.pathname === "/api/test-db") {
      const result = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();

      return Response.json({
        success: true,
        tables: result.results
      });
    }

    // WEBSITE
    return new Response(html, {
      headers: {
        "content-type": "text/html;charset=UTF-8"
      }
    });
  }
};
