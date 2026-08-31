export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // PASSWORD HASH
    // ==========================================

    async function hashPassword(password) {
      const buffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(password)
      );

      return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }

    // ==========================================
    // SIGNUP
    // ==========================================

    if (
      url.pathname === "/api/signup" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

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

        const passwordHash = await hashPassword(password);

        const result = await env.DB
          .prepare(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
          )
          .bind(name, email, passwordHash)
          .run();

        return Response.json({
          success: true,
          id: result.meta?.last_row_id || null,
          name: name,
          email: email
        });
      } catch (error) {
        console.error("SIGNUP ERROR:", error);

        if (
          error.message &&
          error.message.toLowerCase().includes("unique")
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
        const body = await request.json();

        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (!email || !password) {
          return Response.json(
            {
              success: false,
              error: "Email and password are required."
            },
            { status: 400 }
          );
        }

        const passwordHash = await hashPassword(password);

        const user = await env.DB
          .prepare(
            "SELECT id, name, email FROM users WHERE email = ? AND password_hash = ?"
          )
          .bind(email, passwordHash)
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
        const body = await request.json();
        const question = String(body.question || "").trim();

        if (!question) {
          return Response.json(
            {
              success: false,
              error: "Please enter a question."
            },
            { status: 400 }
          );
        }

        if (!env.AI) {
          return Response.json(
            {
              success: false,
              error: "Workers AI is not connected."
            },
            { status: 500 }
          );
        }

        const result = await env.AI.run(
          "@cf/meta/llama-3.2-3b-instruct",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are PadhAI, a friendly educational AI tutor. Explain difficult topics in simple language. Give step-by-step explanations and examples when useful. Help students understand instead of simply giving answers."
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
            "I could not generate an answer."
        });
      } catch (error) {
        console.error("TUTOR ERROR:", error);

        return Response.json(
          {
            success: false,
            error: "AI Tutor could not answer right now."
          },
          { status: 500 }
        );
      }
    }

    // ==========================================
    // AI QUIZ
    // ==========================================

    if (
      url.pathname === "/api/quiz" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const topic = String(body.topic || "").trim();

        let count = Number(body.count) || 5;

        if (count < 1) {
          count = 1;
        }

        if (count > 10) {
          count = 10;
        }

        if (!topic) {
          return Response.json(
            {
              success: false,
              error: "Please enter a quiz topic."
            },
            { status: 400 }
          );
        }

        if (!env.AI) {
          return Response.json(
            {
              success: false,
              error: "Workers AI is not connected."
            },
            { status: 500 }
          );
        }

        const prompt =
          "Create exactly " +
          count +
          " multiple choice questions about " +
          topic +
          ". " +
          "Return ONLY valid JSON. " +
          "The JSON must have this format: " +
          '{"questions":[{"question":"Question text","options":["Option A","Option B","Option C","Option D"],"answer":0}]}' +
          ". " +
          "Every question must have exactly four options. " +
          "The answer must be a number from 0 to 3. " +
          "Do not write markdown. " +
          "Do not write explanations.";

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are PadhAI Quiz Generator. Generate simple, accurate educational multiple choice questions. Always return valid JSON."
              },
              {
                role: "user",
                content: prompt
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
            max_tokens: 3000,
            temperature: 0.1
          }
        );

        console.log(
          "QUIZ RESULT:",
          JSON.stringify(result)
        );

        let questions = null;

        if (
          result &&
          result.response &&
          typeof result.response === "object"
        ) {
          questions = result.response.questions;
        }

        if (
          typeof result?.response === "string"
        ) {
          try {
            const parsed = JSON.parse(result.response);

            if (Array.isArray(parsed)) {
              questions = parsed;
            } else if (
              Array.isArray(parsed.questions)
            ) {
              questions = parsed.questions;
            }
          } catch (error) {
            console.error(
              "QUIZ JSON PARSE ERROR:",
              error
            );
          }
        }

        if (!Array.isArray(questions)) {
          return Response.json(
            {
              success: false,
              error:
                "PadhAI could not create the quiz. Please try again."
            },
            { status: 500 }
          );
        }

        const validQuestions = [];

        for (const item of questions) {
          if (!item) {
            continue;
          }

          const question =
            String(item.question || "").trim();

          if (!question) {
            continue;
          }

          if (!Array.isArray(item.options)) {
            continue;
          }

          if (item.options.length < 4) {
            continue;
          }

          const options = item.options
            .slice(0, 4)
            .map((option) =>
              String(option || "").trim()
            );

          if (
            options.some(
              (option) => option.length === 0
            )
          ) {
            continue;
          }

          let answer = Number(item.answer);

          if (
            !Number.isInteger(answer) ||
            answer < 0 ||
            answer > 3
          ) {
            continue;
          }

          validQuestions.push({
            question: question,
            options: options,
            answer: answer
          });

          if (
            validQuestions.length >= count
          ) {
            break;
          }
        }

        if (
          validQuestions.length === 0
        ) {
          return Response.json(
            {
              success: false,
              error:
                "PadhAI could not create valid questions. Please try again."
            },
            { status: 500 }
          );
        }

        return Response.json({
          success: true,
          topic: topic,
          questions: validQuestions
        });
      } catch (error) {
        console.error("QUIZ ERROR:", error);

        return Response.json(
          {
            success: false,
            error:
              "Quiz generation failed.",
            details:
              error.message || "Unknown error"
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
        const body = await request.json();

        const userId = Number(body.userId);
        const topic = String(body.topic || "").trim();
        const score = Number(body.score);
        const total = Number(body.total);

        if (
          !userId ||
          !topic ||
          !Number.isFinite(score) ||
          !Number.isFinite(total)
        ) {
          return Response.json(
            {
              success: false,
              error: "Invalid quiz score data."
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
          message: "Quiz score saved."
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
              "Could not save quiz score."
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
        const userId = Number(
          url.searchParams.get("userId")
        );

        if (!userId) {
          return Response.json(
            {
              success: false,
              error: "User ID is required."
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

        const result = await env.DB
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
          scores: result.results || []
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
              "Could not load quiz history."
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
        const result = await env.DB
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table'"
          )
          .all();

        return Response.json({
          success: true,
          tables: result.results || []
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
