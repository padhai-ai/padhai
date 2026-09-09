export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CORS
    // =========================
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    try {

      // =========================
      // SIGNUP
      // =========================
      if (
        url.pathname === "/api/signup" &&
        request.method === "POST"
      ) {
        await createUserTable(env);

        const body = await request.json();

        const name = String(body.name || "").trim();
        const email = String(body.email || "")
          .trim()
          .toLowerCase();
        const password = String(body.password || "");

        if (!name || !email || !password) {
          return json(
            { error: "All fields are required." },
            400
          );
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json(
            { error: "Please enter a valid email." },
            400
          );
        }

        if (password.length < 6) {
          return json(
            {
              error:
                "Password must be at least 6 characters."
            },
            400
          );
        }

        const existing = await env.DB
          .prepare(
            "SELECT id FROM users WHERE email = ?"
          )
          .bind(email)
          .first();

        if (existing) {
          return json(
            {
              error:
                "Email is already registered."
            },
            409
          );
        }

        const userId = crypto.randomUUID();
        const passwordHash =
          await hashPassword(password);

        await env.DB
          .prepare(`
            INSERT INTO users
            (id, name, email, password_hash)
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            userId,
            name,
            email,
            passwordHash
          )
          .run();

        return json({
          success: true,
          user: {
            id: userId,
            name,
            email
          }
        });
      }


      // =========================
      // LOGIN
      // =========================
      if (
        url.pathname === "/api/login" &&
        request.method === "POST"
      ) {
        await createUserTable(env);

        const body = await request.json();

        const email = String(body.email || "")
          .trim()
          .toLowerCase();

        const password = String(
          body.password || ""
        );

        if (!email || !password) {
          return json(
            {
              error:
                "Email and password are required."
            },
            400
          );
        }

        const passwordHash =
          await hashPassword(password);

        const user = await env.DB
          .prepare(`
            SELECT
              id,
              name,
              email
            FROM users
            WHERE email = ?
            AND password_hash = ?
          `)
          .bind(
            email,
            passwordHash
          )
          .first();

        if (!user) {
          return json(
            {
              error:
                "Invalid email or password."
            },
            401
          );
        }

        return json({
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email
          }
        });
      }


      // =========================
      // AI TUTOR
      // =========================
      if (
        url.pathname === "/api/tutor" &&
        request.method === "POST"
      ) {
        const body = await request.json();

        const message = String(
          body.message || ""
        ).trim();

        if (!message) {
          return json(
            {
              error:
                "Please enter a question."
            },
            400
          );
        }

        const result = await env.AI.run(
          "@cf/meta/llama-3.2-3b-instruct",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are PadhAI, a friendly AI tutor for PU students. Explain academic topics clearly and step by step. Use simple language, examples, and short sections. Never make the student feel bad for asking basic questions."
              },
              {
                role: "user",
                content: message
              }
            ],
            max_tokens: 700
          }
        );

        const answer =
          result?.response ||
          result?.result?.response ||
          "Sorry, I could not generate an answer.";

        return json({
          success: true,
          answer
        });
      }


      // =========================
      // AI STUDY
      // =========================
      if (
        url.pathname === "/api/study" &&
        request.method === "POST"
      ) {
        const body = await request.json();

        const topic = String(
          body.topic || ""
        ).trim();

        const level = String(
          body.level || "beginner"
        ).trim().toLowerCase();

        if (!topic) {
          return json(
            {
              error:
                "Please enter a study topic."
            },
            400
          );
        }

        const safeLevel = [
          "beginner",
          "intermediate",
          "advanced"
        ].includes(level)
          ? level
          : "beginner";

        const prompt = `
You are PadhAI, an educational AI tutor for PU students.

Create a clear lesson about:
${topic}

Difficulty:
${safeLevel}

Return ONLY valid JSON.

The JSON must have exactly these fields:

{
  "title": "string",
  "introduction": "string",
  "explanation": "string",
  "keyPoints": [
    "string",
    "string",
    "string",
    "string",
    "string"
  ],
  "example": "string",
  "summary": "string"
}

Rules:
- keyPoints must contain exactly 5 items.
- All fields must contain useful content.
- Keep language simple and student-friendly.
- Do not use markdown.
- Do not put JSON inside markdown fences.
`;

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "Return only valid JSON."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            max_tokens: 1600
          }
        );

        const text =
          result?.response ||
          result?.result?.response ||
          "";

        const lesson = parseAIJson(text);

        if (
          !lesson ||
          !lesson.title ||
          !lesson.introduction ||
          !lesson.explanation ||
          !Array.isArray(
            lesson.keyPoints
          ) ||
          lesson.keyPoints.length !== 5 ||
          !lesson.summary
        ) {
          return json(
            {
              error:
                "AI returned an incomplete lesson."
            },
            500
          );
        }

        return json({
          success: true,
          lesson
        });
      }


      // =========================
      // AI QUIZ
      // =========================
      if (
        url.pathname === "/api/quiz" &&
        request.method === "POST"
      ) {
        const body = await request.json();

        const topic = String(
          body.topic || ""
        ).trim();

        const requestedCount =
          Number(body.count) || 5;

        const count = Math.min(
          Math.max(requestedCount, 1),
          10
        );

        if (!topic) {
          return json(
            {
              error:
                "Please enter a quiz topic."
            },
            400
          );
        }

        const prompt = `
Create exactly ${count} multiple-choice questions about:

${topic}

Return ONLY valid JSON.

Format:

{
  "questions": [
    {
      "question": "Question text",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "answer": 0,
      "explanation": "Short explanation"
    }
  ]
}

Rules:
- Exactly ${count} questions.
- Every question must have exactly 4 options.
- answer must be a number from 0 to 3.
- Questions must be educational and factually correct.
- No markdown.
- Do not wrap the JSON in code fences.
`;

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "Return only valid JSON."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            max_tokens: 2200
          }
        );

        const text =
          result?.response ||
          result?.result?.response ||
          "";

        const data = parseAIJson(text);

        if (
          !data ||
          !Array.isArray(data.questions)
        ) {
          return json(
            {
              error:
                "AI did not create a valid quiz. Please try again."
            },
            500
          );
        }

        const questions = data.questions
          .filter((q) => {
            return (
              q &&
              typeof q.question === "string" &&
              Array.isArray(q.options) &&
              q.options.length === 4 &&
              q.options.every(
                (x) =>
                  typeof x === "string" &&
                  x.trim()
              ) &&
              Number.isInteger(q.answer) &&
              q.answer >= 0 &&
              q.answer <= 3
            );
          })
          .slice(0, count)
          .map((q) => ({
            question: q.question.trim(),
            options: q.options.map(
              (x) => x.trim()
            ),
            answer: q.answer,
            explanation:
              typeof q.explanation ===
              "string"
                ? q.explanation.trim()
                : ""
          }));

        if (
          questions.length !== count
        ) {
          return json(
            {
              error:
                "AI did not create enough valid questions. Please try again."
            },
            500
          );
        }

        return json({
          success: true,
          topic,
          questions
        });
      }


      // =========================
      // SAVE QUIZ SCORE
      // =========================
      if (
        url.pathname === "/api/quiz-score" &&
        request.method === "POST"
      ) {
        try {
          await createProgressTables(env);

          const body = await request.json();

          const userId = String(
            body.userId || ""
          ).trim();

          const topic = String(
            body.topic || "General"
          ).trim();

          const score =
            Number(body.score);

          const total =
            Number(body.total);

          if (!userId) {
            return json(
              {
                error:
                  "User ID is missing."
              },
              400
            );
          }

          if (
            !Number.isFinite(score) ||
            !Number.isFinite(total) ||
            total <= 0 ||
            score < 0 ||
            score > total
          ) {
            return json(
              {
                error:
                  "Invalid score data."
              },
              400
            );
          }

          const quizId =
            crypto.randomUUID();

          const createdAt =
            new Date().toISOString();

          await env.DB
            .prepare(`
              INSERT INTO quiz_scores
              (
                id,
                user_id,
                topic,
                score,
                total,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `)
            .bind(
              quizId,
              userId,
              topic || "General",
              Math.round(score),
              Math.round(total),
              createdAt
            )
            .run();

          return json({
            success: true,
            saved: true,
            score: Math.round(score),
            total: Math.round(total)
          });

        } catch (error) {
          console.error(
            "SAVE QUIZ SCORE ERROR:",
            error
          );

          return json(
            {
              error:
                "Could not save quiz score.",
              details:
                String(error?.message || error)
            },
            500
          );
        }
      }


      // =========================
      // QUIZ HISTORY
      // =========================
      if (
        url.pathname === "/api/quiz-history" &&
        request.method === "GET"
      ) {
        await createProgressTables(env);

        const userId = String(
          url.searchParams.get("userId") || ""
        ).trim();

        if (!userId) {
          return json(
            {
              error:
                "User ID is required."
            },
            400
          );
        }

        const result = await env.DB
          .prepare(`
            SELECT
              id,
              topic,
              score,
              total,
              created_at
            FROM quiz_scores
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 20
          `)
          .bind(userId)
          .all();

        return json({
          success: true,
          quizzes: result.results || []
        });
      }


      // =========================
      // PROGRESS
      // =========================
      if (
        url.pathname === "/api/progress" &&
        request.method === "GET"
      ) {
        await createProgressTables(env);

        const userId = String(
          url.searchParams.get("userId") || ""
        ).trim();

        if (!userId) {
          return json(
            {
              error:
                "User ID is required."
            },
            400
          );
        }

        const stats = await env.DB
          .prepare(`
            SELECT
              COUNT(*) AS total_quizzes,
              COALESCE(
                AVG(
                  CASE
                    WHEN total > 0
                    THEN (score * 100.0 / total)
                    ELSE 0
                  END
                ),
                0
              ) AS average_score,
              COALESCE(
                SUM(score),
                0
              ) AS correct_answers,
              COALESCE(
                SUM(total),
                0
              ) AS total_questions
            FROM quiz_scores
            WHERE user_id = ?
          `)
          .bind(userId)
          .first();

        const topics = await env.DB
          .prepare(`
            SELECT
              topic,
              COUNT(*) AS quizzes,
              SUM(score) AS correct,
              SUM(total) AS questions,
              AVG(
                CASE
                  WHEN total > 0
                  THEN (score * 100.0 / total)
                  ELSE 0
                END
              ) AS percentage
            FROM quiz_scores
            WHERE user_id = ?
            GROUP BY topic
            ORDER BY quizzes DESC
          `)
          .bind(userId)
          .all();

        const recent = await env.DB
          .prepare(`
            SELECT
              id,
              topic,
              score,
              total,
              created_at
            FROM quiz_scores
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 10
          `)
          .bind(userId)
          .all();

        return json({
          success: true,

          stats: {
            totalQuizzes:
              Number(
                stats?.total_quizzes || 0
              ),

            averageScore:
              Math.round(
                Number(
                  stats?.average_score || 0
                )
              ),

            correctAnswers:
              Number(
                stats?.correct_answers || 0
              ),

            totalQuestions:
              Number(
                stats?.total_questions || 0
              )
          },

          topics:
            (topics.results || []).map(
              (item) => ({
                topic: item.topic,
                quizzes:
                  Number(
                    item.quizzes || 0
                  ),
                correct:
                  Number(
                    item.correct || 0
                  ),
                questions:
                  Number(
                    item.questions || 0
                  ),
                percentage:
                  Math.round(
                    Number(
                      item.percentage || 0
                    )
                  )
              })
            ),

          recent:
            recent.results || []
        });
      }


      // =========================
      // TEST DATABASE
      // =========================
      if (
        url.pathname === "/api/test-db" &&
        request.method === "GET"
      ) {
        await createUserTable(env);
        await createProgressTables(env);

        const result = await env.DB
          .prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            ORDER BY name
          `)
          .all();

        return json({
          success: true,
          tables: result.results || []
        });
      }


      // =========================
      // FRONTEND
      // =========================
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return json(
        {
          error:
            "PadhAI frontend is unavailable."
        },
        404
      );

    } catch (error) {

      console.error(
        "PadhAI SERVER ERROR:",
        error
      );

      return json(
        {
          error:
            "Something went wrong on the server.",
          details:
            String(error?.message || error)
        },
        500
      );
    }
  }
};


// ==================================================
// DATABASE: USERS
// ==================================================
async function createUserTable(env) {
  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL
      )
    `)
    .run();
}


// ==================================================
// DATABASE: QUIZ SCORES
// ==================================================
async function createProgressTables(env) {

  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS quiz_scores (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `)
    .run();

  // Check existing columns so an older table
  // does not break the new application.
  const info = await env.DB
    .prepare(`
      PRAGMA table_info(quiz_scores)
    `)
    .all();

  const columns =
    (info.results || []).map(
      (column) => column.name
    );

  if (!columns.includes("id")) {
    await env.DB
      .prepare(
        `ALTER TABLE quiz_scores ADD COLUMN id TEXT`
      )
      .run();
  }

  if (!columns.includes("user_id")) {
    await env.DB
      .prepare(
        `ALTER TABLE quiz_scores ADD COLUMN user_id TEXT`
      )
      .run();
  }

  if (!columns.includes("topic")) {
    await env.DB
      .prepare(
        `ALTER TABLE quiz_scores ADD COLUMN topic TEXT`
      )
      .run();
  }

  if (!columns.includes("score")) {
    await env.DB
      .prepare(
        `ALTER TABLE quiz_scores ADD COLUMN score INTEGER`
      )
      .run();
  }

  if (!columns.includes("total")) {
    await env.DB
      .prepare(
        `ALTER TABLE quiz_scores ADD COLUMN total INTEGER`
      )
      .run();
  }

  if (!columns.includes("created_at")) {
    await env.DB
      .prepare(
        `ALTER TABLE quiz_scores ADD COLUMN created_at TEXT`
      )
      .run();
  }
}


// ==================================================
// PASSWORD HASH
// ==================================================
async function hashPassword(password) {

  const data =
    new TextEncoder().encode(password);

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return Array.from(
    new Uint8Array(hash)
  )
    .map(
      (byte) =>
        byte.toString(16).padStart(2, "0")
    )
    .join("");
}


// ==================================================
// AI JSON PARSER
// ==================================================
function parseAIJson(text) {

  if (!text) {
    return null;
  }

  let cleaned = String(text).trim();

  // Remove markdown code fences
  cleaned = cleaned
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  // First attempt
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Continue below
  }

  // Find first JSON object
  const start =
    cleaned.indexOf("{");

  const end =
    cleaned.lastIndexOf("}");

  if (
    start !== -1 &&
    end !== -1 &&
    end > start
  ) {
    const possibleJson =
      cleaned.slice(start, end + 1);

    try {
      return JSON.parse(
        possibleJson
      );
    } catch (error) {
      return null;
    }
  }

  return null;
}


// ==================================================
// JSON RESPONSE
// ==================================================
function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Methods":
          "GET, POST, OPTIONS",

        "Access-Control-Allow-Headers":
          "Content-Type"
      }
    }
  );
}
