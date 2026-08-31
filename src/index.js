export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    // ==========================================
    // SIGNUP
    // ==========================================

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

        const encoder = new TextEncoder();

        const passwordData =
          encoder.encode(password);

        const hashBuffer =
          await crypto.subtle.digest(
            "SHA-256",
            passwordData
          );

        const passwordHash =
          Array.from(
            new Uint8Array(hashBuffer)
          )
            .map(
              byte =>
                byte
                  .toString(16)
                  .padStart(2, "0")
            )
            .join("");

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


    // ==========================================
    // LOGIN
    // ==========================================

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
              error:
                "Email and password are required."
            },
            { status: 400 }
          );
        }

        const cleanEmail =
          email.toLowerCase().trim();

        const encoder = new TextEncoder();

        const passwordData =
          encoder.encode(password);

        const hashBuffer =
          await crypto.subtle.digest(
            "SHA-256",
            passwordData
          );

        const passwordHash =
          Array.from(
            new Uint8Array(hashBuffer)
          )
            .map(
              byte =>
                byte
                  .toString(16)
                  .padStart(2, "0")
            )
            .join("");

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
              error:
                "Invalid email or password."
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


    // ==========================================
    // AI TUTOR
    // ==========================================

    if (
      url.pathname === "/api/tutor" &&
      request.method === "POST"
    ) {
      try {

        const body =
          await request.json();

        const question =
          body.question?.trim();

        if (!question) {
          return Response.json(
            {
              success: false,
              error:
                "Please enter a question."
            },
            { status: 400 }
          );
        }

        if (!env.AI) {
          return Response.json(
            {
              success: false,
              error:
                "Workers AI is not connected."
            },
            { status: 500 }
          );
        }

        /*
         * AI MODEL
         *
         * We will verify the available model
         * before locking this to a production model.
         */

        const model =
          "@cf/meta/llama-3.2-3b-instruct";

        const result =
          await env.AI.run(
            model,
            {
              messages: [
                {
                  role: "system",
                  content:
                    `You are PadhAI, a friendly
                     educational AI tutor.

                     Explain difficult topics
                     in simple language.

                     Give step-by-step explanations.

                     Use examples when useful.

                     Help students understand
                     instead of simply giving
                     answers.`
                },

                {
                  role: "user",
                  content: question
                }
              ]
            }
          );

        return Response.json({
          success: true,
          answer:
            result.response ||
            "I couldn't generate an answer."
        });

      } catch (error) {

        console.error(
          "PadhAI Tutor Error:",
          error
        );

        return Response.json(
          {
            success: false,
            error:
              "AI Tutor could not answer right now.",
            details:
              error.message || "Unknown error"
          },
          { status: 500 }
        );
      }
    }


    // ==========================================
    // DATABASE TEST
    // ==========================================

    if (
      url.pathname === "/api/test-db"
    ) {

      try {

        const result =
          await env.DB
            .prepare(
              `SELECT name
               FROM sqlite_master
               WHERE type='table'`
            )
            .all();

        return Response.json({
          success: true,
          tables: result.results
        });

      } catch (error) {

        return Response.json(
          {
            success: false,
            error: error.message
          },
          { status: 500 }
        );
      }
    }


    // ==========================================
    // WEBSITE
    // ==========================================

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "PadhAI Worker is running.",
      {
        status: 200,
        headers: {
          "content-type":
            "text/plain;charset=UTF-8"
        }
      }
    );
  }
};
