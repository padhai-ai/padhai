// ============================================
// PADHAI AI TUTOR - CLOUDFLARE WORKER
// PART 1 / 2
// ============================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // --------------------------------------------
    // CORS
    // --------------------------------------------
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    try {
      // ------------------------------------------
      // API: SIGN UP
      // ------------------------------------------
      if (path === "/api/signup" && method === "POST") {
        const body = await request.json();

        const name = String(body.name || "").trim();
        const email = String(body.email || "")
          .trim()
          .toLowerCase();
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

        const emailPattern =
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email)) {
          return json({
            success: false,
            message: "Please enter a valid email."
          }, 400);
        }

        const existing = await env.DB
          .prepare(
            "SELECT id FROM users WHERE email = ? LIMIT 1"
          )
          .bind(email)
          .first();

        if (existing) {
          return json({
            success: false,
            message: "An account with this email already exists."
          }, 409);
        }

        const passwordHash =
          await hashPassword(password);

        const result = await env.DB
          .prepare(
            `INSERT INTO users
             (name, email, password_hash)
             VALUES (?, ?, ?)`
          )
          .bind(name, email, passwordHash)
          .run();

        if (!result.success) {
          return json({
            success: false,
            message: "Could not create account."
          }, 500);
        }

        const user = await env.DB
          .prepare(
            `SELECT id, name, email
             FROM users
             WHERE email = ?
             LIMIT 1`
          )
          .bind(email)
          .first();

        return json({
          success: true,
          message: "Account created successfully.",
          user
        });
      }

      // ------------------------------------------
      // API: LOGIN
      // ------------------------------------------
      if (path === "/api/login" && method === "POST") {
        const body = await request.json();

        const email = String(body.email || "")
          .trim()
          .toLowerCase();

        const password = String(body.password || "");

        if (!email || !password) {
          return json({
            success: false,
            message: "Please enter email and password."
          }, 400);
        }

        const passwordHash =
          await hashPassword(password);

        const user = await env.DB
          .prepare(
            `SELECT id, name, email
             FROM users
             WHERE email = ?
             AND password_hash = ?
             LIMIT 1`
          )
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

      // ------------------------------------------
      // API: AI TUTOR
      // ------------------------------------------
      if (path === "/api/tutor" && method === "POST") {
        const body = await request.json();

        const question = String(
          body.question || ""
        ).trim();

        if (!question) {
          return json({
            success: false,
            message: "Please enter a question."
          }, 400);
        }

        if (question.length > 4000) {
          return json({
            success: false,
            message: "Question is too long."
          }, 400);
        }

        const result = await env.AI.run(
          "@cf/meta/llama-3.2-3b-instruct",
          {
            messages: [
              {
                role: "system",
                content:
                  `You are PadhAI, a friendly AI tutor.

Your job is to help students understand subjects
clearly and simply.

Rules:
- Explain step by step.
- Use simple language.
- Give examples when useful.
- Do not make up facts.
- If a question is unclear, explain what is unclear.
- Be encouraging but do not be overly verbose.
- For academic questions, focus on learning and understanding.
- Use headings and bullet points when they improve readability.`
              },
              {
                role: "user",
                content: question
              }
            ]
          }
        );

        const answer =
          result?.response ||
          "Sorry, I couldn't generate an answer right now.";

        return json({
          success: true,
          answer
        });
      }

      // ------------------------------------------
      // API: GENERATE QUIZ
      // ------------------------------------------
      if (path === "/api/quiz" && method === "POST") {
        const body = await request.json();

        const topic = String(
          body.topic || ""
        ).trim();

        let count = Number(body.count || 5);

        if (!topic) {
          return json({
            success: false,
            message: "Please enter a quiz topic."
          }, 400);
        }

        if (!Number.isFinite(count)) {
          count = 5;
        }

        count = Math.floor(count);

        if (count < 1) count = 1;
        if (count > 10) count = 10;

        const prompt =
          `Create exactly ${count} multiple-choice questions
about "${topic}".

Return ONLY valid JSON.

The JSON must have exactly this structure:

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
      "answer": 0
    }
  ]
}

Rules:
- Exactly ${count} questions.
- Every question must have exactly 4 options.
- "answer" must be the zero-based index of the correct option.
- answer must be 0, 1, 2, or 3.
- Questions should be educational and accurate.
- Do not include explanations.
- Do not include markdown.
- Do not include text before or after the JSON.`;

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "You generate accurate educational multiple-choice quizzes."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            response_format: {
              type: "json_object"
            }
          }
        );

        let raw = "";

        if (typeof result?.response === "string") {
          raw = result.response;
        } else {
          raw = JSON.stringify(result?.response || "");
        }

        let quizData = null;

        // Try direct JSON
        try {
          quizData = JSON.parse(raw);
        } catch (error) {
          quizData = null;
        }

        // Try extracting JSON if AI added extra text
        if (!quizData) {
          try {
            const firstBrace = raw.indexOf("{");
            const lastBrace = raw.lastIndexOf("}");

            if (
              firstBrace !== -1 &&
              lastBrace !== -1 &&
              lastBrace > firstBrace
            ) {
              const extracted =
                raw.substring(
                  firstBrace,
                  lastBrace + 1
                );

              quizData = JSON.parse(extracted);
            }
          } catch (error) {
            quizData = null;
          }
        }

        if (
          !quizData ||
          !Array.isArray(quizData.questions)
        ) {
          return json({
            success: false,
            message:
              "The AI returned an invalid quiz. Please try again."
          }, 500);
        }

        const validQuestions =
          quizData.questions
            .slice(0, count)
            .filter((item) => {
              if (!item) return false;

              if (
                typeof item.question !== "string" ||
                !item.question.trim()
              ) {
                return false;
              }

              if (
                !Array.isArray(item.options) ||
                item.options.length !== 4
              ) {
                return false;
              }

              if (
                item.options.some(
                  (option) =>
                    typeof option !== "string" ||
                    !option.trim()
                )
              ) {
                return false;
              }

              const answer =
                Number(item.answer);

              if (
                !Number.isInteger(answer) ||
                answer < 0 ||
                answer > 3
              ) {
                return false;
              }

              return true;
            })
            .map((item) => ({
              question:
                item.question.trim(),
              options:
                item.options.map(
                  (option) => option.trim()
                ),
              answer:
                Number(item.answer)
            }));

        if (validQuestions.length === 0) {
          return json({
            success: false,
            message:
              "Could not create valid quiz questions."
          }, 500);
        }

        return json({
          success: true,
          topic,
          questions: validQuestions
        });
      }

      // ------------------------------------------
      // API: SAVE QUIZ SCORE
      // ------------------------------------------
      if (
        path === "/api/quiz-score" &&
        method === "POST"
      ) {
        const body = await request.json();

        const userId = Number(body.userId);
        const topic = String(
          body.topic || ""
        ).trim();

        const score = Number(body.score);
        const total = Number(body.total);

        if (
          !Number.isInteger(userId) ||
          userId <= 0
        ) {
          return json({
            success: false,
            message: "Invalid user."
          }, 400);
        }

        if (!topic) {
          return json({
            success: false,
            message: "Quiz topic is required."
          }, 400);
        }

        if (
          !Number.isFinite(score) ||
          !Number.isFinite(total)
        ) {
          return json({
            success: false,
            message: "Invalid quiz score."
          }, 400);
        }

        // Create table if it doesn't exist.
        await env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS quiz_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            topic TEXT NOT NULL,
            score INTEGER NOT NULL,
            total INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`
        ).run();

        await env.DB
          .prepare(
            `INSERT INTO quiz_scores
             (user_id, topic, score, total)
             VALUES (?, ?, ?, ?)`
          )
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

      // ------------------------------------------
      // API: QUIZ HISTORY
      // ------------------------------------------
      if (
        path === "/api/quiz-history" &&
        method === "GET"
      ) {
        const userId = Number(
          url.searchParams.get("userId")
        );

        if (
          !Number.isInteger(userId) ||
          userId <= 0
        ) {
          return json({
            success: false,
            message: "Invalid user."
          }, 400);
        }

        // Make sure table exists.
        await env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS quiz_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            topic TEXT NOT NULL,
            score INTEGER NOT NULL,
            total INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`
        ).run();

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

        return json({
          success: true,
          history: result.results || []
        });
      }

      // ------------------------------------------
      // API: STUDY LESSON
      // ------------------------------------------
      if (
        path === "/api/study" &&
        method === "POST"
      ) {
        const body = await request.json();

        const topic = String(
          body.topic || ""
        ).trim();

        let level = String(
          body.level || "beginner"
        )
          .trim()
          .toLowerCase();

        if (!topic) {
          return json({
            success: false,
            message: "Please enter a study topic."
          }, 400);
        }

        const allowedLevels = [
          "beginner",
          "intermediate",
          "advanced"
        ];

        if (!allowedLevels.includes(level)) {
          level = "beginner";
        }

        let levelInstruction = "";

        if (level === "beginner") {
          levelInstruction =
            `Explain the topic for a beginner.
Use simple words and basic examples.
Assume the student is learning the topic for the first time.`;
        }

        if (level === "intermediate") {
          levelInstruction =
            `Explain the topic at an intermediate level.
Include more detail, concepts, relationships,
and practical examples.`;
        }

        if (level === "advanced") {
          levelInstruction =
            `Explain the topic at an advanced level.
Include deeper concepts, technical details,
important exceptions, and meaningful examples.`;
        }

        const studyPrompt =
          `Create a complete educational lesson about:

"${topic}"

Student level:
${level}

${levelInstruction}

Return ONLY valid JSON using exactly this structure:

{
  "title": "Lesson title",
  "introduction": "Short introduction",
  "explanation": "Detailed explanation",
  "keyPoints": [
    "Important point 1",
    "Important point 2",
    "Important point 3",
    "Important point 4",
    "Important point 5"
  ],
  "example": "A useful example",
  "summary": "Short revision summary"
}

Rules:
- Keep the content educational and accurate.
- Make the explanation easy to study.
- Use plain text.
- Do not use markdown outside the JSON.
- Do not include anything before or after the JSON.`;

        const result = await env.AI.run(
          "@cf/meta/llama-3.2-3b-instruct",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are PadhAI's educational lesson generator. Create accurate, clear and student-friendly lessons."
              },
              {
                role: "user",
                content: studyPrompt
              }
            ]
          }
        );

        let rawStudy = "";

        if (
          typeof result?.response === "string"
        ) {
          rawStudy = result.response;
        } else {
          rawStudy = JSON.stringify(
            result?.response || ""
          );
        }

        let study = null;

        // Direct JSON parsing
        try {
          study = JSON.parse(rawStudy);
        } catch (error) {
          study = null;
        }

        // Extract JSON from AI response
        if (!study) {
          try {
            const cleaned =
              rawStudy
                .replace(/```json/gi, "")
                .replace(/```/g, "")
                .trim();

            const firstBrace =
              cleaned.indexOf("{");

            const lastBrace =
              cleaned.lastIndexOf("}");

            if (
              firstBrace !== -1 &&
              lastBrace !== -1 &&
              lastBrace > firstBrace
            ) {
              const extracted =
                cleaned.substring(
                  firstBrace,
                  lastBrace + 1
                );

              study = JSON.parse(extracted);
            }
          } catch (error) {
            study = null;
          }
        }

        if (!study) {
          return json({
            success: false,
            message:
              "Could not create lesson. Please try again."
          }, 500);
        }

        // Basic validation
        const title =
          typeof study.title === "string"
            ? study.title.trim()
            : "Study Lesson";

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
                .filter(
                  (point) =>
                    typeof point === "string"
                )
                .map((point) => point.trim())
                .filter(Boolean)
                .slice(0, 10)
            : [];

        const example =
          typeof study.example === "string"
            ? study.example.trim()
            : "";

        const summary =
          typeof study.summary === "string"
            ? study.summary.trim()
            : "";

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

      // ------------------------------------------
      // API: DATABASE TEST
      // ------------------------------------------
      if (
        path === "/api/test-db" &&
        method === "GET"
      ) {
        const result = await env.DB
          .prepare(
            `SELECT name
             FROM sqlite_master
             WHERE type = 'table'
             ORDER BY name`
          )
          .all();

        return json({
          success: true,
          database: "padhai-db",
          tables: result.results || []
        });
      }

      // ------------------------------------------
      // FRONTEND ASSETS
      // ------------------------------------------
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
        message:
          "Something went wrong on the server.",
        error:
          error?.message || String(error)
      }, 500);
    }
  }
};


// ============================================
// HELPER: JSON RESPONSE
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
// HELPER: CORS HEADERS
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
// HELPER: PASSWORD HASH
// ============================================

async function hashPassword(password) {
  const encoder =
    new TextEncoder();

  const data =
    encoder.encode(password);

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return Array
    .from(new Uint8Array(hash))
    .map(
      (byte) =>
        byte.toString(16).padStart(2, "0")
    )
    .join("");
}
