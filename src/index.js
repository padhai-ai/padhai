export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

      // =====================================================
      // SIGNUP
      // =====================================================
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
          return json({
            error: "All fields are required."
          }, 400);
        }

        if (password.length < 6) {
          return json({
            error: "Password must be at least 6 characters."
          }, 400);
        }

        const existing = await env.DB
          .prepare(
            "SELECT id FROM users WHERE email = ?"
          )
          .bind(email)
          .first();

        if (existing) {
          return json({
            error: "Email is already registered."
          }, 409);
        }

        const id = crypto.randomUUID();
        const passwordHash = await hashPassword(password);

        await env.DB
          .prepare(`
            INSERT INTO users
            (id, name, email, password_hash)
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            id,
            name,
            email,
            passwordHash
          )
          .run();

        return json({
          success: true,
          user: {
            id,
            name,
            email
          }
        });
      }


      // =====================================================
      // LOGIN
      // =====================================================
      if (
        url.pathname === "/api/login" &&
        request.method === "POST"
      ) {
        await createUserTable(env);

        const body = await request.json();

        const email = String(body.email || "")
          .trim()
          .toLowerCase();

        const password = String(body.password || "");

        if (!email || !password) {
          return json({
            error: "Email and password are required."
          }, 400);
        }

        const passwordHash =
          await hashPassword(password);

        const user = await env.DB
          .prepare(`
            SELECT id, name, email
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
          return json({
            error: "Invalid email or password."
          }, 401);
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


      // =====================================================
      // AI TUTOR
      // =====================================================
      if (
        url.pathname === "/api/tutor" &&
        request.method === "POST"
      ) {
        const body = await request.json();

        const message = String(
          body.message || ""
        ).trim();

        if (!message) {
          return json({
            error: "Please enter a question."
          }, 400);
        }

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are PadhAI, a friendly AI tutor for PU students. Explain subjects clearly using simple language, examples and step-by-step explanations."
              },
              {
                role: "user",
                content: message
              }
            ],
            max_tokens: 900
          }
        );

        const answer =
          result?.response ||
          result?.result?.response ||
          "";

        if (!answer) {
          return json({
            error: "AI could not generate an answer."
          }, 500);
        }

        return json({
          success: true,
          answer: answer
        });
      }


      // =====================================================
      // AI STUDY
      // =====================================================
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
        ).trim();

        if (!topic) {
          return json({
            error: "Please enter a study topic."
          }, 400);
        }

        const studySchema = {
          type: "object",
          properties: {
            title: {
              type: "string"
            },
            introduction: {
              type: "string"
            },
            explanation: {
              type: "string"
            },
            keyPoints: {
              type: "array",
              items: {
                type: "string"
              }
            },
            example: {
              type: "string"
            },
            summary: {
              type: "string"
            }
          },
          required: [
            "title",
            "introduction",
            "explanation",
            "keyPoints",
            "example",
            "summary"
          ]
        };

        const prompt = `
You are PadhAI, an AI study teacher for PU students.

Create a complete lesson about:

${topic}

Difficulty level:
${level}

Requirements:

1. Explain the topic clearly.
2. Use simple student-friendly language.
3. Give one useful example.
4. Give exactly 5 important key points.
5. Give a useful summary.
6. Do not use markdown.
7. Return only JSON matching the required structure.
`;

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are PadhAI. Return only valid JSON."
              },
              {
                role: "user",
                content: prompt
              }
            ],

            response_format: {
              type: "json_schema",
              json_schema: studySchema
            },

            max_tokens: 1800,
            temperature: 0.2
          }
        );

        const lesson =
          getAIJson(result);

        if (
          !lesson ||
          typeof lesson !== "object"
        ) {
          return json({
            error: "Could not create lesson."
          }, 500);
        }

        if (
          !lesson.title ||
          !lesson.introduction ||
          !lesson.explanation ||
          !Array.isArray(lesson.keyPoints) ||
          lesson.keyPoints.length < 5 ||
          !lesson.example ||
          !lesson.summary
        ) {
          return json({
            error: "AI returned an incomplete lesson."
          }, 500);
        }

        lesson.keyPoints =
          lesson.keyPoints.slice(0, 5);

        return json({
          success: true,
          lesson: lesson
        });
      }


      // =====================================================
      // AI QUIZ
      // =====================================================
      if (
        url.pathname === "/api/quiz" &&
        request.method === "POST"
      ) {
        const body = await request.json();

        const topic = String(
          body.topic || ""
        ).trim();

        const count = Math.min(
          Math.max(
            Number(body.count) || 5,
            1
          ),
          10
        );

        if (!topic) {
          return json({
            error: "Please enter a quiz topic."
          }, 400);
        }

        const quizSchema = {
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
                  },
                  explanation: {
                    type: "string"
                  }
                },
                required: [
                  "question",
                  "options",
                  "answer",
                  "explanation"
                ]
              }
            }
          },
          required: [
            "questions"
          ]
        };

        const prompt = `
You are PadhAI, an AI quiz generator for PU students.

Create exactly ${count} multiple-choice questions about:

${topic}

Rules:

- Exactly ${count} questions.
- Every question must have exactly 4 options.
- "answer" must be the zero-based correct option number.
- Therefore answer must be 0, 1, 2 or 3.
- Every question needs a short explanation.
- Questions must be educational and factually correct.
- Do not use markdown.
- Return only JSON matching the required structure.
`;

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are PadhAI. Return only valid JSON."
              },
              {
                role: "user",
                content: prompt
              }
            ],

            response_format: {
              type: "json_schema",
              json_schema: quizSchema
            },

            max_tokens: 2200,
            temperature: 0.2
          }
        );

        const data =
          getAIJson(result);

        if (
          !data ||
          !Array.isArray(data.questions)
        ) {
          return json({
            error: "Could not create quiz."
          }, 500);
        }

        const questions =
          data.questions
            .filter((q) => {
              return (
                q &&
                typeof q.question === "string" &&
                Array.isArray(q.options) &&
                q.options.length === 4 &&
                q.options.every(
                  option =>
                    typeof option === "string" &&
                    option.trim().length > 0
                ) &&
                Number.isInteger(q.answer) &&
                q.answer >= 0 &&
                q.answer <= 3
              );
            })
            .slice(0, count)
            .map(q => ({
              question:
                q.question.trim(),

              options:
                q.options.map(
                  option => option.trim()
                ),

              answer:
                Number(q.answer),

              explanation:
                String(
                  q.explanation || ""
                ).trim()
            }));

        if (questions.length !== count) {
          return json({
            error:
              "Could not create enough valid questions. Please try again."
          }, 500);
        }

        return json({
          success: true,
          topic: topic,
          questions: questions
        });
      }


      // =====================================================
// SAVE QUIZ SCORE
// =====================================================
if (
  url.pathname === "/api/quiz-score" &&
  request.method === "POST"
) {
  try {
    const body = await request.json();

    const userId = String(
      body.userId || ""
    ).trim();

    const topic = String(
      body.topic || "General"
    ).trim();

    const score = Number(body.score);
    const total = Number(body.total);

    if (!userId) {
      return json(
        {
          error: "User ID is missing."
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
          error: "Invalid score data."
        },
        400
      );
    }

    /*
      IMPORTANT:
      The existing D1 table uses:

      user_id
      subject
      quiz_name
      score
      total_questions
      created_at
      topic
      total

      So we must insert into that existing schema.
      We intentionally do NOT insert "id" because
      the database already generates the INTEGER id.
    */

    await env.DB
      .prepare(`
        INSERT INTO quiz_scores
        (
          user_id,
          subject,
          quiz_name,
          score,
          total_questions,
          created_at,
          topic,
          total
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
      `)
      .bind(
        userId,
        topic || "General",
        "AI Quiz",
        Math.round(score),
        Math.round(total),
        topic || "General",
        Math.round(total)
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
      "QUIZ SCORE SAVE ERROR:",
      error
    );

    return json(
      {
        success: false,
        saved: false,
        error:
          "Could not save quiz score.",
        details:
          String(
            error?.message || error
          )
      },
      500
    );
  }
}


      // =====================================================
      // QUIZ HISTORY
      // =====================================================
      if (
        url.pathname === "/api/quiz-history" &&
        request.method === "GET"
      ) {
        await createProgressTables(env);

        const userId = String(
          url.searchParams.get("userId") || ""
        ).trim();

        if (!userId) {
          return json({
            error: "User ID is required."
          }, 400);
        }

        const result =
          await env.DB
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
          quizzes:
            result.results || []
        });
      }


      // =====================================================
// PROGRESS
// =====================================================
if (
  url.pathname === "/api/progress" &&
  request.method === "GET"
) {
  try {
    const userId = String(
      url.searchParams.get("userId") || ""
    ).trim();

    if (!userId) {
      return json(
        {
          error: "User ID is required."
        },
        400
      );
    }

    const stats = await env.DB
      .prepare(`
        SELECT
          COUNT(*) AS total_quizzes,
          COALESCE(SUM(score), 0) AS correct_answers,
          COALESCE(SUM(total_questions), 0) AS total_questions,
          COALESCE(
            AVG(
              CASE
                WHEN total_questions > 0
                THEN score * 100.0 / total_questions
                ELSE 0
              END
            ),
            0
          ) AS average_percentage
        FROM quiz_scores
        WHERE user_id = ?
      `)
      .bind(userId)
      .first();

    const topics = await env.DB
      .prepare(`
        SELECT
          COALESCE(topic, subject, 'General') AS topic,
          COALESCE(SUM(total_questions), 0) AS questions,
          COALESCE(SUM(score), 0) AS correct
        FROM quiz_scores
        WHERE user_id = ?
        GROUP BY COALESCE(topic, subject, 'General')
        ORDER BY questions DESC
      `)
      .bind(userId)
      .all();

    const recent = await env.DB
      .prepare(`
        SELECT
          COALESCE(topic, subject, 'General') AS topic,
          score,
          COALESCE(total_questions, total, 0) AS total,
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

      progress: {
        totalQuizzes:
          Number(stats?.total_quizzes || 0),

        averagePercentage:
          Math.round(
            Number(
              stats?.average_percentage || 0
            )
          ),

        correctAnswers:
          Number(
            stats?.correct_answers || 0
          ),

        totalQuestions:
          Number(
            stats?.total_questions || 0
          ),

        topics:
          (topics.results || []).map(item => ({
            topic: item.topic,
            questions:
              Number(item.questions || 0),
            correct:
              Number(item.correct || 0)
          })),

        recent:
          recent.results || []
      }
    });

  } catch (error) {
    console.error(
      "PROGRESS ERROR:",
      error
    );

    return json({
      success: false,
      error: "Could not load progress.",
      details:
        String(error?.message || error)
    }, 500);
  }
}


      // =====================================================
      // DATABASE TEST
      // =====================================================
      if (
        url.pathname === "/api/test-db" &&
        request.method === "GET"
      ) {
        await createUserTable(env);
        await createProgressTables(env);

        const tables =
          await env.DB
            .prepare(`
              SELECT name
              FROM sqlite_master
              WHERE type = 'table'
              ORDER BY name
            `)
            .all();

        const schema =
          await env.DB
            .prepare(`
              PRAGMA table_info(quiz_scores)
            `)
            .all();

        return json({
          success: true,
          tables:
            tables.results || [],
          quizScoresSchema:
            schema.results || []
        });
      }


      // =====================================================
      // FRONTEND
      // =====================================================
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return json({
        error:
          "PadhAI frontend is unavailable."
      }, 404);

    } catch (error) {

      console.error(
        "PADHAI ERROR:",
        error
      );

      return json({
        error:
          "Something went wrong on the server.",
        details:
          String(
            error?.message ||
            error
          )
      }, 500);
    }
  }
};


// =========================================================
// CREATE USERS TABLE
// =========================================================
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


// =========================================================
// CREATE QUIZ SCORE TABLE
// =========================================================
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

  // Check current database schema.
  const result =
    await env.DB
      .prepare(`
        PRAGMA table_info(quiz_scores)
      `)
      .all();

  const columns =
    (result.results || [])
      .map(column => column.name);

  // Add missing columns from older versions.
  if (!columns.includes("user_id")) {
    await env.DB
      .prepare(`
        ALTER TABLE quiz_scores
        ADD COLUMN user_id TEXT
      `)
      .run();
  }

  if (!columns.includes("topic")) {
    await env.DB
      .prepare(`
        ALTER TABLE quiz_scores
        ADD COLUMN topic TEXT
      `)
      .run();
  }

  if (!columns.includes("score")) {
    await env.DB
      .prepare(`
        ALTER TABLE quiz_scores
        ADD COLUMN score INTEGER
      `)
      .run();
  }

  if (!columns.includes("total")) {
    await env.DB
      .prepare(`
        ALTER TABLE quiz_scores
        ADD COLUMN total INTEGER
      `)
      .run();
  }

  if (!columns.includes("created_at")) {
    await env.DB
      .prepare(`
        ALTER TABLE quiz_scores
        ADD COLUMN created_at TEXT
      `)
      .run();
  }

  if (!columns.includes("id")) {
    await env.DB
      .prepare(`
        ALTER TABLE quiz_scores
        ADD COLUMN id TEXT
      `)
      .run();
  }
}


// =========================================================
// PASSWORD HASH
// =========================================================
async function hashPassword(password) {

  const data =
    new TextEncoder()
      .encode(password);

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return Array
    .from(new Uint8Array(hash))
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


// =========================================================
// GET AI JSON
// =========================================================
function getAIJson(result) {

  if (!result) {
    return null;
  }

  // JSON Mode can return an actual object.
  if (
    result.response &&
    typeof result.response === "object"
  ) {
    return result.response;
  }

  if (
    result.result &&
    typeof result.result === "object" &&
    !Array.isArray(result.result)
  ) {
    if (
      result.result.response &&
      typeof result.result.response === "object"
    ) {
      return result.result.response;
    }
  }

  let text = "";

  if (
    typeof result.response === "string"
  ) {
    text = result.response;
  } else if (
    result.result &&
    typeof result.result.response === "string"
  ) {
    text =
      result.result.response;
  }

  if (!text) {
    return null;
  }

  text = text.trim();

  // Remove markdown fences if AI adds them.
  text =
    text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

  try {
    return JSON.parse(text);
  } catch (error) {
    // Try extracting JSON object.
  }

  const first =
    text.indexOf("{");

  const last =
    text.lastIndexOf("}");

  if (
    first !== -1 &&
    last !== -1 &&
    last > first
  ) {
    try {
      return JSON.parse(
        text.slice(first, last + 1)
      );
    } catch (error) {
      return null;
    }
  }

  return null;
}


// =========================================================
// JSON RESPONSE
// =========================================================
function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status: status,

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
