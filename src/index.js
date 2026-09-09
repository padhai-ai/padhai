export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CORS / OPTIONS
    // =========================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    try {

      // =========================
      // SIGNUP
      // =========================
      if (url.pathname === "/api/signup" && request.method === "POST") {
        const body = await request.json();

        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
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
            { error: "Password must be at least 6 characters." },
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
            { error: "Email is already registered." },
            409
          );
        }

        const passwordHash =
          await hashPassword(password);

        const userId = crypto.randomUUID();

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
      if (url.pathname === "/api/login" && request.method === "POST") {
        const body = await request.json();

        const email =
          String(body.email || "")
            .trim()
            .toLowerCase();

        const password =
          String(body.password || "");

        if (!email || !password) {
          return json(
            {
              error:
                "Email and password are required."
            },
            400
          );
        }

        const user = await env.DB
          .prepare(`
            SELECT
              id,
              name,
              email,
              password_hash
            FROM users
            WHERE email = ?
          `)
          .bind(email)
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

        const passwordHash =
          await hashPassword(password);

        if (
          passwordHash !==
          user.password_hash
        ) {
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

        const message =
          String(body.message || "").trim();

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
                  "You are PadhAI, a friendly AI tutor for PU students. " +
                  "Explain concepts simply and step by step. " +
                  "Use examples when useful. " +
                  "Be accurate, clear and student-friendly."
              },
              {
                role: "user",
                content: message
              }
            ],
            max_tokens: 700,
            temperature: 0.4
          }
        );

        return json({
          success: true,
          answer:
            result?.response ||
            result?.result?.response ||
            "Sorry, I could not generate an answer."
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

        const topic =
          String(body.topic || "").trim();

        const requestedCount = Math.min(
          Math.max(
            Number(body.count) || 5,
            1
          ),
          10
        );

        if (!topic) {
          return json(
            {
              error:
                "Please enter a topic."
            },
            400
          );
        }

        const prompt = `
Create exactly ${requestedCount} multiple-choice questions for a PU student about:

${topic}

Return ONLY valid JSON in this exact format:

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

IMPORTANT RULES:
- Create exactly ${requestedCount} questions.
- Every question must have exactly 4 options.
- answer must be 0, 1, 2 or 3.
- Questions must be factually accurate.
- Do not use markdown.
- Do not write anything outside the JSON.
`;

        let result;

        try {
          result = await env.AI.run(
            "@cf/meta/llama-3.1-8b-instruct-fast",
            {
              messages: [
                {
                  role: "system",
                  content:
                    "You generate accurate educational multiple-choice quizzes. " +
                    "Always follow the requested JSON format exactly."
                },
                {
                  role: "user",
                  content: prompt
                }
              ],
              response_format: {
                type: "json_object"
              },
              max_tokens: 1600,
              temperature: 0.2
            }
          );
        } catch (error) {
          console.error(
            "Quiz AI error:",
            error
          );

          return json(
            {
              error:
                "AI quiz service is temporarily unavailable. Please try again."
            },
            500
          );
        }

        const raw =
          result?.response ||
          result?.result?.response ||
          result;

        const data = parseAIJson(raw);

        if (
          !data ||
          !Array.isArray(data.questions)
        ) {
          return json(
            {
              error:
                "Could not create quiz. Please try again."
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
              q.options.length >= 4 &&
              Number.isInteger(
                Number(q.answer)
              )
            );
          })
          .slice(0, requestedCount)
          .map((q) => {
            let answer =
              Number(q.answer);

            if (answer < 0) answer = 0;
            if (answer > 3) answer = 3;

            return {
              question:
                String(q.question).trim(),

              options:
                q.options
                  .slice(0, 4)
                  .map((x) =>
                    String(x).trim()
                  ),

              answer,

              explanation:
                String(
                  q.explanation || ""
                ).trim()
            };
          });

        if (
          questions.length <
          requestedCount
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
        await createProgressTables(env);

        const body =
          await request.json();

        const userId =
          String(body.userId || "").trim();

        const topic =
          String(body.topic || "").trim();

        const score =
          Number(body.score);

        const total =
          Number(body.total);

        if (!userId || !topic) {
          return json(
            {
              error:
                "Missing quiz information."
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
                "Invalid quiz score."
            },
            400
          );
        }

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
            crypto.randomUUID(),
            userId,
            topic,
            score,
            total,
            new Date().toISOString()
          )
          .run();

        return json({
          success: true
        });
      }


      // =========================
      // QUIZ HISTORY
      // =========================
      if (
        url.pathname === "/api/quiz-history" &&
        request.method === "GET"
      ) {
        await createProgressTables(env);

        const userId =
          String(
            url.searchParams.get(
              "userId"
            ) || ""
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


      // =========================
      // AI STUDY
      // =========================
      if (
        url.pathname === "/api/study" &&
        request.method === "POST"
      ) {
        const body =
          await request.json();

        const topic =
          String(body.topic || "").trim();

        const level =
          String(
            body.level || "beginner"
          )
            .trim()
            .toLowerCase();

        if (!topic) {
          return json(
            {
              error:
                "Please enter a topic."
            },
            400
          );
        }

        const allowedLevels = [
          "beginner",
          "intermediate",
          "advanced"
        ];

        const safeLevel =
          allowedLevels.includes(level)
            ? level
            : "beginner";

        const prompt = `
You are PadhAI, an educational AI tutor for PU students.

Create a complete lesson about:

${topic}

Difficulty:
${safeLevel}

Return ONLY valid JSON using this exact structure:

{
  "title": "Lesson title",
  "introduction": "Short introduction",
  "explanation": "Detailed but easy explanation",
  "keyPoints": [
    "Point 1",
    "Point 2",
    "Point 3",
    "Point 4",
    "Point 5"
  ],
  "example": "Simple example",
  "summary": "Short summary"
}

IMPORTANT RULES:
- keyPoints must contain exactly 5 points.
- Explain the topic accurately.
- Keep it appropriate for PU students.
- Use simple language.
- Do not use markdown.
- Do not write anything outside JSON.
`;

        let result;
        let data = null;

        try {
          result = await env.AI.run(
            "@cf/meta/llama-3.1-8b-instruct-fast",
            {
              messages: [
                {
                  role: "system",
                  content:
                    "You create complete, accurate educational lessons. " +
                    "Always return valid JSON."
                },
                {
                  role: "user",
                  content: prompt
                }
              ],
              response_format: {
                type: "json_object"
              },
              max_tokens: 1800,
              temperature: 0.2
            }
          );

          const raw =
            result?.response ||
            result?.result?.response ||
            result;

          data = normalizeLesson(
            parseAIJson(raw),
            topic,
            safeLevel
          );

        } catch (error) {
          console.error(
            "Study AI error:",
            error
          );
        }

        // =========================
        // SECOND ATTEMPT
        // =========================
        if (!data) {
          try {
            result = await env.AI.run(
              "@cf/meta/llama-3.1-8b-instruct-fast",
              {
                messages: [
                  {
                    role: "system",
                    content:
                      "Return ONLY valid JSON. " +
                      "No markdown. " +
                      "No explanation outside JSON."
                  },
                  {
                    role: "user",
                    content: prompt
                  }
                ],
                response_format: {
                  type: "json_object"
                },
                max_tokens: 1800,
                temperature: 0.1
              }
            );

            const retryRaw =
              result?.response ||
              result?.result?.response ||
              result;

            data = normalizeLesson(
              parseAIJson(retryRaw),
              topic,
              safeLevel
            );

          } catch (error) {
            console.error(
              "Study retry error:",
              error
            );
          }
        }

        if (!data) {
          return json(
            {
              error:
                "Could not create lesson. Please try again."
            },
            500
          );
        }

        return json({
          success: true,
          lesson: data
        });
      }


      // =========================
      // PROGRESS
      // =========================
      if (
        url.pathname === "/api/progress" &&
        request.method === "GET"
      ) {
        // Make absolutely sure the table exists
        await createProgressTables(env);

        const userId =
          String(
            url.searchParams.get(
              "userId"
            ) || ""
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

        const stats =
          await env.DB
            .prepare(`
              SELECT
                COUNT(*) AS total_quizzes,

                COALESCE(
                  AVG(
                    CASE
                      WHEN total > 0
                      THEN
                        (score * 100.0 / total)
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

        const topics =
          await env.DB
            .prepare(`
              SELECT
                topic,
                COUNT(*) AS quizzes,

                COALESCE(
                  AVG(
                    CASE
                      WHEN total > 0
                      THEN
                        (score * 100.0 / total)
                      ELSE 0
                    END
                  ),
                  0
                ) AS average_score

              FROM quiz_scores
              WHERE user_id = ?

              GROUP BY topic

              ORDER BY quizzes DESC
            `)
            .bind(userId)
            .all();

        const recent =
          await env.DB
            .prepare(`
              SELECT
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
              Number(
                Number(
                  stats?.average_score || 0
                ).toFixed(1)
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
            (topics?.results || [])
              .map((row) => ({
                topic:
                  row.topic,

                quizzes:
                  Number(
                    row.quizzes || 0
                  ),

                averageScore:
                  Number(
                    Number(
                      row.average_score ||
                      0
                    ).toFixed(1)
                  )
              })),

          recent:
            recent?.results || []
        });
      }


      // =========================
      // TEST DATABASE
      // =========================
      if (
        url.pathname === "/api/test-db" &&
        request.method === "GET"
      ) {
        await createProgressTables(env);

        const result =
          await env.DB
            .prepare(`
              SELECT
                name
              FROM sqlite_master
              WHERE type = 'table'
              ORDER BY name
            `)
            .all();

        return json({
          success: true,
          tables:
            result.results || []
        });
      }


      // =========================
      // FRONTEND
      // =========================
      return env.ASSETS.fetch(request);

    } catch (error) {

      console.error(
        "PadhAI API Error:",
        error
      );

      return json(
        {
          error:
            "Something went wrong on the server.",
          details:
            "Please try again."
        },
        500
      );
    }
  }
};


// ========================================
// CREATE PROGRESS TABLES
// ========================================

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
}


// ========================================
// NORMALIZE AI STUDY LESSON
// ========================================

function normalizeLesson(
  data,
  topic,
  level
) {

  if (
    !data ||
    typeof data !== "object"
  ) {
    return null;
  }

  const title =
    String(
      data.title ||
      data.lessonTitle ||
      topic
    ).trim();

  const introduction =
    String(
      data.introduction ||
      data.intro ||
      data.overview ||
      ""
    ).trim();

  const explanation =
    String(
      data.explanation ||
      data.content ||
      data.details ||
      ""
    ).trim();

  let points =
    data.keyPoints ||
    data.key_points ||
    data.keypoints ||
    data.points ||
    [];

  if (!Array.isArray(points)) {
    points = [];
  }

  points = points
    .map((x) =>
      String(x || "").trim()
    )
    .filter(Boolean);

  // Add safe fallback points
  // if the AI returns fewer than 5.
  const fallbackPoints = [
    `Understand the basic idea of ${topic}.`,
    `Remember the important terms related to ${topic}.`,
    `Focus on how ${topic} works.`,
    `Use examples to understand ${topic} better.`,
    `Review the main concepts of ${topic}.`
  ];

  while (points.length < 5) {
    const fallback =
      fallbackPoints[points.length];

    if (fallback) {
      points.push(fallback);
    } else {
      break;
    }
  }

  points =
    points.slice(0, 5);

  const example =
    String(
      data.example ||
      data.examples ||
      ""
    ).trim();

  const summary =
    String(
      data.summary ||
      data.conclusion ||
      data.takeaway ||
      ""
    ).trim();

  if (
    !title ||
    !introduction ||
    !explanation ||
    !summary
  ) {
    return null;
  }

  if (points.length !== 5) {
    return null;
  }

  return {
    title,
    introduction,
    explanation,
    keyPoints: points,
    example,
    summary,
    level
  };
}


// ========================================
// AI JSON PARSER
// ========================================

function parseAIJson(raw) {

  if (!raw) {
    return null;
  }

  if (
    typeof raw === "object"
  ) {

    if (
      typeof raw.response ===
      "string"
    ) {
      raw = raw.response;

    } else if (
      raw.result &&
      typeof raw.result.response ===
      "string"
    ) {
      raw =
        raw.result.response;

    } else {
      return raw;
    }
  }

  let text =
    String(raw).trim();

  // Remove markdown fences
  text =
    text
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();

  // Direct JSON parse
  try {
    return JSON.parse(text);
  } catch (error) {
    // Continue below
  }

  // Try extracting JSON object
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
        text.substring(
          first,
          last + 1
        )
      );
    } catch (error) {
      return null;
    }
  }

  return null;
}


// ========================================
// PASSWORD HASH
// ========================================

async function hashPassword(
  password
) {

  const data =
    new TextEncoder()
      .encode(password);

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return Array.from(
    new Uint8Array(hash)
  )
    .map((b) =>
      b.toString(16)
        .padStart(2, "0")
    )
    .join("");
}


// ========================================
// JSON RESPONSE
// ========================================

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...corsHeaders(),

        "Content-Type":
          "application/json"
      }
    }
  );
}


// ========================================
// CORS HEADERS
// ========================================

function corsHeaders() {

  return {
    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type"
  };
}
