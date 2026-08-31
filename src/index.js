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

        const hashBuffer =
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(password)
          );

        const passwordHash =
          Array.from(new Uint8Array(hashBuffer))
            .map(byte =>
              byte.toString(16).padStart(2, "0")
            )
            .join("");

        const result =
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
          id: result.meta?.last_row_id || null,
          name: name.trim(),
          email: cleanEmail
        });

      } catch (error) {

        console.error("SIGNUP ERROR:", error);

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

        const hashBuffer =
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(password)
          );

        const passwordHash =
          Array.from(new Uint8Array(hashBuffer))
            .map(byte =>
              byte.toString(16).padStart(2, "0")
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

        console.error("LOGIN ERROR:", error);

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

        const result =
          await env.AI.run(
            "@cf/meta/llama-3.2-3b-instruct",
            {
              messages: [
                {
                  role: "system",
                  content:
                    `You are PadhAI, a friendly educational AI tutor.

Explain difficult topics in simple language.

Give step-by-step explanations.

Use examples when useful.

Help students understand instead of simply giving answers.`
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
          "TUTOR ERROR:",
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
    // AI QUIZ GENERATOR
    // ==========================================

    if (
      url.pathname === "/api/quiz" &&
      request.method === "POST"
    ) {
      try {

        const body =
          await request.json();

        const topic =
          body.topic?.trim();

        const count =
          Math.min(
            Math.max(
              Number(body.count) || 5,
              1
            ),
            10
          );

        if (!topic) {
          return Response.json(
            {
              success: false,
              error:
                "Please enter a quiz topic."
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
         * IMPORTANT:
         * This model supports Cloudflare JSON Mode.
         */

        const model =
          "@cf/meta/llama-3.1-8b-instruct-fast";

        const result =
          await env.AI.run(
            model,
            {
              messages: [
                {
                  role: "system",
                  content:
                    `You are PadhAI Quiz Generator.

Create educational multiple-choice questions.

Always follow the provided JSON schema.

Make questions factually correct.

Create exactly the requested number of questions.`
                },

                {
                  role: "user",
                  content:
                    `Create exactly ${count} multiple-choice questions about ${topic}.`
                }
              ],

              response_format: {
                type: "json_schema",

                json_schema: {
                  type: "object",

                  properties: {

                    questions: {
                      type: "array",

                      items: {
                        type: "object",

                        properties: {

                          question: {
                            type: "string"
                          },

                          options: {
                            type: "array",

                            items: {
                              type: "string"
                            }
                          },

                          answer: {
                            type: "integer"
                          }

                        },

                        required: [
                          "question",
                          "options",
                          "answer"
                        ]
                      }
                    }

                  },

                  required: [
                    "questions"
                  ]
                }
              },

              temperature: 0.2,

              max_tokens: 2000
            }
          );


        console.log(
          "QUIZ AI RESULT:",
          JSON.stringify(result)
        );


        // ======================================
        // GET STRUCTURED RESPONSE
        // ======================================

        let questions =
          result?.response?.questions;


        // ======================================
        // FALLBACK:
        // SOME AI RESPONSES MAY RETURN A STRING
        // ======================================

        if (
          typeof result?.response === "string"
        ) {

          try {

            const parsed =
              JSON.parse(
                result.response
              );

            questions =
              parsed.questions;

          } catch (error) {

            console.error(
              "STRING JSON PARSE ERROR:",
              error
            );

          }

        }


        if (
          !Array.isArray(questions)
        ) {

          console.error(
            "INVALID STRUCTURED RESPONSE:",
            JSON.stringify(result)
          );

          return Response.json(
            {
              success: false,
              error:
                "AI returned an invalid quiz. Please try again."
            },
            { status: 500 }
          );

        }


        // ======================================
        // CLEAN AND VALIDATE
        // ======================================

        const cleanQuestions = [];

        for (
          const q of questions
        ) {

          if (!q) continue;

          if (
            typeof q.question !==
            "string"
          ) {
            continue;
          }

          if (
            !Array.isArray(q.options)
          ) {
            continue;
          }

          if (
            q.options.length !== 4
          ) {
            continue;
          }

          const answer =
            Number(q.answer);

          if (
            !Number.isInteger(answer) ||
            answer < 0 ||
            answer > 3
          ) {
            continue;
          }

          const options =
            q.options.map(
              option =>
                String(option).trim()
            );

          if (
            options.some(
              option => !option
            )
          ) {
            continue;
          }

          cleanQuestions.push({

            question:
              q.question.trim(),

            options,

            answer

          });

        }


        if (
          cleanQuestions.length <
          count
        ) {

          console.error(
            "NOT ENOUGH VALID QUESTIONS:",
            cleanQuestions.length,
            "EXPECTED:",
            count
          );

          return Response.json(
            {
              success: false,
              error:
                "AI did not create enough valid questions. Please try again."
            },
            { status: 500 }
          );

        }


        return Response.json({

          success: true,

          topic,

          questions:
            cleanQuestions.slice(
              0,
              count
            )

        });


      } catch (error) {

        console.error(
          "QUIZ ERROR:",
          error
        );

        return Response.json(
          {
            success: false,
            error:
              "Quiz generation failed.",
            details:
              error.message ||
              "Unknown error"
          },
          { status: 500 }
        );

      }
    }


    // ==========================================
    // SAVE QUIZ SCORE
    // ==========================================

    if (
      url.pathname === "/api/quiz-score" &&
      request.method === "POST"
    ) {
      try {

        const body =
          await request.json();

        const userId =
          Number(body.userId);

        const topic =
          body.topic?.trim();

        const score =
          Number(body.score);

        const total =
          Number(body.total);

        if (
          !userId ||
          !topic ||
          !Number.isFinite(score) ||
          !Number.isFinite(total)
        ) {

          return Response.json(
            {
              success: false,
              error:
                "Invalid quiz score data."
            },
            { status: 400 }
          );

        }

        await env.DB
          .prepare(
            `CREATE TABLE IF NOT EXISTS quiz_scores (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              topic TEXT NOT NULL,
              score INTEGER NOT NULL,
              total INTEGER NOT NULL,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`
          )
          .run();

        await env.DB
          .prepare(
            `INSERT INTO quiz_scores
             (user_id, topic, score, total)
             VALUES (?, ?, ?, ?)`
          )
          .bind(
            userId,
            topic,
            score,
            total
          )
          .run();

        return Response.json({
          success: true,
          message:
            "Quiz score saved."
        });

      } catch (error) {

        console.error(
          "SCORE ERROR:",
          error
        );

        return Response.json(
          {
            success: false,
            error:
              "Could not save quiz score.",
            details:
              error.message ||
              "Unknown error"
          },
          { status: 500 }
        );

      }
    }


    // ==========================================
    // QUIZ HISTORY
    // ==========================================

    if (
      url.pathname === "/api/quiz-history" &&
      request.method === "GET"
    ) {
      try {

        const userId =
          Number(
            url.searchParams.get(
              "userId"
            )
          );

        if (!userId) {

          return Response.json(
            {
              success: false,
              error:
                "User ID is required."
            },
            { status: 400 }
          );

        }

        await env.DB
          .prepare(
            `CREATE TABLE IF NOT EXISTS quiz_scores (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              topic TEXT NOT NULL,
              score INTEGER NOT NULL,
              total INTEGER NOT NULL,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`
          )
          .run();

        const result =
          await env.DB
            .prepare(
              `SELECT
                id,
                topic,
                score,
                total,
                created_at
               FROM quiz_scores
               WHERE user_id = ?
               ORDER BY id DESC
               LIMIT 20`
            )
            .bind(userId)
            .all();

        return Response.json({

          success: true,

          scores:
            result.results || []

        });

      } catch (error) {

        console.error(
          "HISTORY ERROR:",
          error
        );

        return Response.json(
          {
            success: false,
            error:
              "Could not load quiz history.",
            details:
              error.message ||
              "Unknown error"
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

          tables:
            result.results

        });

      } catch (error) {

        return Response.json(
          {
            success: false,
            error:
              error.message
          },
          { status: 500 }
        );

      }
    }


    // ==========================================
    // WEBSITE
    // ==========================================

    if (env.ASSETS) {

      return env.ASSETS.fetch(
        request
      );

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
