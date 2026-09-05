// ============================================
// PADHAI AI - CLOUDFLARE WORKER
// FINAL VERSION
// ============================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    try {

      // ==========================================
      // SIGN UP
      // ==========================================
      if (path === "/api/signup" && method === "POST") {
        const body = await request.json();

        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (!name || !email || !password) {
          return json({
            success: false,
            message: "Please fill all fields."
          }, 400);
        }

        if (password.length < 6) {
          return json({
            success: false,
            message: "Password must be at least 6 characters."
          }, 400);
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({
            success: false,
            message: "Please enter a valid email."
          }, 400);
        }

        const existing = await env.DB
          .prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
          .bind(email)
          .first();

        if (existing) {
          return json({
            success: false,
            message: "An account with this email already exists."
          }, 409);
        }

        const passwordHash = await hashPassword(password);

        const result = await env.DB
          .prepare(`
            INSERT INTO users (name, email, password_hash)
            VALUES (?, ?, ?)
          `)
          .bind(name, email, passwordHash)
          .run();

        if (!result.success) {
          return json({
            success: false,
            message: "Could not create account."
          }, 500);
        }

        const user = await env.DB
          .prepare(`
            SELECT id, name, email
            FROM users
            WHERE email = ?
            LIMIT 1
          `)
          .bind(email)
          .first();

        return json({
          success: true,
          message: "Account created successfully.",
          user
        });
      }


      // ==========================================
      // LOGIN
      // ==========================================
      if (path === "/api/login" && method === "POST") {
        const body = await request.json();

        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (!email || !password) {
          return json({
            success: false,
            message: "Please enter email and password."
          }, 400);
        }

        const passwordHash = await hashPassword(password);

        const user = await env.DB
          .prepare(`
            SELECT id, name, email
            FROM users
            WHERE email = ?
            AND password_hash = ?
            LIMIT 1
          `)
          .bind(email, passwordHash)
          .first();

        if (!user) {
          return json({
            success: false,
            message: "Invalid email or password."
          }, 401);
        }

        return json({
          success: true,
          message: "Login successful.",
          user
        });
      }


      // ==========================================
      // AI TUTOR
      // ==========================================
      if (path === "/api/tutor" && method === "POST") {
        const body = await request.json();

        const question = String(body.question || "").trim();

        if (!question) {
          return json({
            success: false,
            message: "Please enter a question."
          }, 400);
        }

        const result = await env.AI.run(
          "@cf/meta/llama-3.2-3b-instruct",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are PadhAI, a friendly student tutor. " +
                  "Explain things clearly, simply and step by step. " +
                  "Give examples when useful."
              },
              {
                role: "user",
                content: question
              }
            ],
            max_tokens: 1000,
            temperature: 0.4
          }
        );

        return json({
          success: true,
          answer:
            result?.response ||
            "Sorry, I couldn't generate an answer right now."
        });
      }


      // ==========================================
      // AI QUIZ
      // ==========================================
      if (path === "/api/quiz" && method === "POST") {
        const body = await request.json();

        const topic = String(body.topic || "").trim();

        let count = Number(body.count || 5);

        if (!topic) {
          return json({
            success: false,
            message: "Please enter a quiz topic."
          }, 400);
        }

        if (!Number.isFinite(count)) count = 5;

        count = Math.floor(count);

        if (count < 1) count = 1;
        if (count > 10) count = 10;

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "Create accurate educational multiple-choice quizzes. " +
                  "Return only the requested JSON."
              },
              {
                role: "user",
                content: `
Create exactly ${count} multiple-choice questions about "${topic}".

Each question must contain:
- question
- exactly 4 options
- answer as a number from 0 to 3

Keep questions and options concise.
`
              }
            ],

            max_tokens: Math.min(
              3000,
              600 + count * 300
            ),

            temperature: 0.2,

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
            }
          }
        );

        const quizData = parseAIJson(result);

        if (!quizData || !Array.isArray(quizData.questions)) {
          return json({
            success: false,
            message: "The AI could not create the quiz. Please try again."
          }, 500);
        }

        const questions = quizData.questions
          .filter(q =>
            q &&
            typeof q.question === "string" &&
            Array.isArray(q.options) &&
            q.options.length === 4 &&
            q.options.every(o => typeof o === "string") &&
            Number.isInteger(Number(q.answer)) &&
            Number(q.answer) >= 0 &&
            Number(q.answer) <= 3
          )
          .slice(0, count)
          .map(q => ({
            question: q.question.trim(),
            options: q.options.map(o => o.trim()),
            answer: Number(q.answer)
          }));

        if (questions.length < count) {
          return json({
            success: false,
            message: "The AI could not create enough questions. Please try again."
          }, 500);
        }

        return json({
          success: true,
          topic,
          questions
        });
      }


      // ==========================================
      // SAVE QUIZ SCORE
      // ==========================================
      if (path === "/api/quiz-score" && method === "POST") {
        const body = await request.json();

        const userId = Number(body.userId);
        const topic = String(body.topic || "").trim();
        const score = Number(body.score);
        const total = Number(body.total);

        if (
          !Number.isInteger(userId) ||
          userId <= 0 ||
          !topic ||
          !Number.isFinite(score) ||
          !Number.isFinite(total) ||
          total <= 0 ||
          score < 0 ||
          score > total
        ) {
          return json({
            success: false,
            message: "Invalid quiz score."
          }, 400);
        }

        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS quiz_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            topic TEXT NOT NULL,
            score INTEGER NOT NULL,
            total INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `).run();

        await env.DB
          .prepare(`
            INSERT INTO quiz_scores
            (user_id, topic, score, total)
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            userId,
            topic,
            Math.floor(score),
            Math.floor(total)
          )
          .run();

        return json({
          success: true,
          message: "Quiz score saved."
        });
      }


      // ==========================================
      // QUIZ HISTORY
      // ==========================================
      if (path === "/api/quiz-history" && method === "GET") {
        const userId = Number(
          url.searchParams.get("userId")
        );

        if (!Number.isInteger(userId) || userId <= 0) {
          return json({
            success: false,
            message: "Invalid user."
          }, 400);
        }

        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS quiz_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            topic TEXT NOT NULL,
            score INTEGER NOT NULL,
            total INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `).run();

        const result = await env.DB
          .prepare(`
            SELECT id, topic, score, total, created_at
            FROM quiz_scores
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 20
          `)
          .bind(userId)
          .all();

        return json({
          success: true,
          history: result.results || []
        });
      }


      // ==========================================
      // AI STUDY
      // ==========================================
      if (path === "/api/study" && method === "POST") {
        const body = await request.json();

        const topic = String(body.topic || "").trim();

        let level = String(
          body.level || "beginner"
        ).trim().toLowerCase();

        if (!topic) {
          return json({
            success: false,
            message: "Please enter a study topic."
          }, 400);
        }

        if (topic.length > 300) {
          return json({
            success: false,
            message: "Study topic is too long."
          }, 400);
        }

        if (![
          "beginner",
          "intermediate",
          "advanced"
        ].includes(level)) {
          level = "beginner";
        }

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are PadhAI's educational lesson generator. " +
                  "Create accurate, clear and student-friendly lessons. " +
                  "Return only the requested JSON."
              },
              {
                role: "user",
                content: `
Create a lesson about "${topic}".

Student level: ${level}

For beginner:
Use simple words and basic examples.

For intermediate:
Give more detail and practical examples.

For advanced:
Give deeper concepts and technical details.

Create exactly 5 key points.
Keep the explanation detailed but concise.
`
              }
            ],

            max_tokens: 2200,

            temperature: 0.3,

            response_format: {
              type: "json_schema",
              json_schema: {
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
              }
            }
          }
        );

        const study = parseAIJson(result);

        if (!study) {
          return json({
            success: false,
            message: "Could not create lesson. Please try again."
          }, 500);
        }

        const title =
          typeof study.title === "string"
            ? study.title.trim()
            : "";

        const introduction =
          typeof study.introduction === "string"
            ? study.introduction.trim()
            : "";

        const explanation =
          typeof study.explanation === "string"
            ? study.explanation.trim()
            : "";

        const keyPoints =
          Array.isArray(study.keyPoints)
            ? study.keyPoints
                .filter(p => typeof p === "string")
                .map(p => p.trim())
                .filter(Boolean)
                .slice(0, 5)
            : [];

        const example =
          typeof study.example === "string"
            ? study.example.trim()
            : "";

        const summary =
          typeof study.summary === "string"
            ? study.summary.trim()
            : "";

        if (
          !title ||
          !introduction ||
          !explanation ||
          keyPoints.length < 5 ||
          !summary
        ) {
          return json({
            success: false,
            message: "The AI returned an incomplete lesson. Please try again."
          }, 500);
        }

        return json({
          success: true,
          topic,
          level,
          lesson: {
            title,
            introduction,
            explanation,
            keyPoints,
            example,
            summary
          }
        });
      }


      // ==========================================
      // DATABASE TEST
      // ==========================================
      if (path === "/api/test-db" && method === "GET") {
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
          database: "padhai-db",
          tables: result.results || []
        });
      }


      // ==========================================
      // FRONTEND
      // ==========================================
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response(
        "PadhAI Worker is running.",
        {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=UTF-8"
          }
        }
      );

    } catch (error) {
      console.error("PadhAI Worker Error:", error);

      return json({
        success: false,
        message: "Something went wrong on the server.",
        error: error?.message || String(error)
      }, 500);
    }
  }
};


// ============================================
// AI JSON PARSER
// ============================================

function parseAIJson(result) {
  if (!result) return null;

  let value = result.response;

  if (
    value &&
    typeof value === "object"
  ) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  let text = value
    .replace(/^\uFEFF/, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(text);
  } catch (_) {}

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");

  if (first === -1 || last === -1) {
    return null;
  }

  try {
    return JSON.parse(
      text.substring(first, last + 1)
    );
  } catch (_) {
    return null;
  }
}


// ============================================
// JSON RESPONSE
// ============================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders(),
        "content-type":
          "application/json; charset=UTF-8"
      }
    }
  );
}


// ============================================
// CORS
// ============================================

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods":
      "GET, POST, OPTIONS",
    "access-control-allow-headers":
      "Content-Type"
  };
}


// ============================================
// PASSWORD HASH
// ============================================

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(
    new Uint8Array(hash)
  )
    .map(byte =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}
