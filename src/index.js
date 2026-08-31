async function hashPassword(password) {
  const data = new TextEncoder().encode(password);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}


export default {

  async fetch(request, env) {

    const url = new URL(request.url);


    // =========================
    // SIGNUP
    // =========================

    if (
      url.pathname === "/api/signup" &&
      request.method === "POST"
    ) {

      try {

        const { name, email, password } =
          await request.json();

        if (!name || !email || !password) {
          return Response.json(
            {
              success: false,
              error: "All fields are required."
            },
            { status: 400 }
          );
        }

        if (password.length < 6) {
          return Response.json(
            {
              success: false,
              error: "Password must be at least 6 characters."
            },
            { status: 400 }
          );
        }

        const cleanEmail =
          email.toLowerCase().trim();

        const passwordHash =
          await hashPassword(password);

        await env.DB
          .prepare(
            `INSERT INTO users
             (name, email, password_hash)
             VALUES (?, ?, ?)`
          )
          .bind(
            name.trim(),
            cleanEmail,
            passwordHash
          )
          .run();

        return Response.json({
          success: true,
          name: name.trim(),
          email: cleanEmail
        });

      } catch (error) {

        console.error(error);

        if (
          error.message &&
          error.message.includes("UNIQUE")
        ) {
          return Response.json(
            {
              success: false,
              error: "Email already registered."
            },
            { status: 409 }
          );
        }

        return Response.json(
          {
            success: false,
            error: "Could not create account."
          },
          { status: 500 }
        );
      }
    }


    // =========================
    // LOGIN
    // =========================

    if (
      url.pathname === "/api/login" &&
      request.method === "POST"
    ) {

      try {

        const { email, password } =
          await request.json();

        if (!email || !password) {
          return Response.json(
            {
              success: false,
              error: "Email and password are required."
            },
            { status: 400 }
          );
        }

        const cleanEmail =
          email.toLowerCase().trim();

        const passwordHash =
          await hashPassword(password);

        const user =
          await env.DB
            .prepare(
              `SELECT id, name, email
               FROM users
               WHERE email = ?
               AND password_hash = ?`
            )
            .bind(
              cleanEmail,
              passwordHash
            )
            .first();

        if (!user) {
          return Response.json(
            {
              success: false,
              error: "Invalid email or password."
            },
            { status: 401 }
          );
        }

        return Response.json({
          success: true,
          id: user.id,
          name: user.name,
          email: user.email
        });

      } catch (error) {

        console.error(error);

        return Response.json(
          {
            success: false,
            error: "Login failed."
          },
          { status: 500 }
        );
      }
    }


    // =========================
    // DATABASE TEST
    // =========================

    if (url.pathname === "/api/test-db") {

      const result =
        await env.DB
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table'"
          )
          .all();

      return Response.json({
        success: true,
        tables: result.results
      });
    }


    // =========================
    // WEBSITE
    // =========================

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "PadhAI website assets are not configured.",
      { status: 500 }
    );

  }

};
