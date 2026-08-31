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
              error: "Please enter a quiz topic."
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

        const model =
          "@cf/meta/llama-3.2-3b-instruct";

        const prompt = `
Create exactly ${count} multiple-choice quiz questions about:

${topic}

Return ONLY valid JSON.

The JSON must be an array.

Each question must have exactly this structure:

{
  "question": "Question text",
  "options": [
    "Option A",
    "Option B",
    "Option C",
    "Option D"
  ],
  "answer": 0
}

The answer must be the NUMBER of the correct option:
0 = first option
1 = second option
2 = third option
3 = fourth option

Rules:
- Exactly ${count} questions.
- Exactly 4 options per question.
- Only one correct answer.
- Questions should be educational.
- Avoid ambiguous questions.
- Do not include explanations.
- Do not use markdown.
- Return JSON only.
`;

        const result =
          await env.AI.run(
            model,
            {
              messages: [
                {
                  role: "system",
                  content:
                    "You are an educational quiz generator. Always return valid JSON only."
                },
                {
                  role: "user",
                  content: prompt
                }
              ]
            }
          );

        let raw =
          result.response || "";

        raw = raw.trim();

        // Remove accidental markdown fences
        raw = raw
          .replace(/^```json/i, "")
          .replace(/^```/i, "")
          .replace(/```$/i, "")
          .trim();

        let questions;

        try {

          questions =
            JSON.parse(raw);

        } catch (parseError) {

          console.error(
            "Quiz JSON parse error:",
            parseError,
            raw
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

        if (!Array.isArray(questions)) {
          return Response.json(
            {
              success: false,
              error:
                "Invalid quiz format."
            },
            { status: 500 }
          );
        }

        // Validate and clean questions
        const cleanQuestions =
          questions
            .slice(0, count)
            .filter(question => {

              return (
                question &&
                typeof question.question === "string" &&
                Array.isArray(question.options) &&
                question.options.length === 4 &&
                Number.isInteger(Number(question.answer)) &&
                Number(question.answer) >= 0 &&
                Number(question.answer) <= 3
              );

            })
            .map(question => ({

              question:
                question.question.trim(),

              options:
                question.options.map(
                  option => String(option).trim()
                ),

              answer:
                Number(question.answer)

            }));

        if (cleanQuestions.length === 0) {
          return Response.json(
            {
              success: false,
              error:
                "Could not create valid quiz questions."
            },
            { status: 500 }
          );
        }

        return Response.json({

          success: true,

          topic,

          questions:
            cleanQuestions

        });

      } catch (error) {

        console.error(
          "PadhAI Quiz Error:",
          error
        );

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
          "Quiz score error:",
          error
        );

        return Response.json(
          {
            success: false,
            error:
              "Could not save quiz score.",
            details:
              error.message || "Unknown error"
          },
          { status: 500 }
        );
      }
    }


    // ==========================================
    // QUIZ SCORE HISTORY
    // ==========================================

    if (
      url.pathname === "/api/quiz-history" &&
      request.method === "GET"
    ) {
      try {

        const userId =
          Number(
            url.searchParams.get("userId")
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
          "Quiz history error:",
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
