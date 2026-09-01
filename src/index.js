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
        const email = String(body.email || "")
          .trim()
          .toLowerCase();
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

        const passwordHash =
          await hashPassword(password);

        const result = await env.DB
          .prepare(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
          )
          .bind(
            name,
            email,
            passwordHash
          )
          .run();

        return Response.json({
          success: true,
          id: result.meta?.last_row_id || null,
          name,
          email
        });

      } catch (error) {
        console.error(
          "SIGNUP ERROR:",
          error
        );

        if (
          error.message &&
          error.message
            .toLowerCase()
            .includes("unique")
        ) {
          return Response.json(
            {
              success: false,
              error:
                "Email already registered."
            },
            { status: 409 }
          );
        }

        return Response.json(
          {
            success: false,
            error:
              "Could not create account."
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
        const body =
          await request.json();

        const email =
          String(body.email || "")
            .trim()
            .toLowerCase();

        const password =
          String(body.password || "");

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

        const passwordHash =
          await hashPassword(password);

        const user =
          await env.DB
            .prepare(
              "SELECT id, name, email FROM users WHERE email = ? AND password_hash = ?"
            )
            .bind(
              email,
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
        console.error(
          "LOGIN ERROR:",
          error
        );

        return Response.json(
          {
            success: false,
            error:
              "Login failed."
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
          String(
            body.question || ""
          ).trim();

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
        console.error(
          "TUTOR ERROR:",
          error
        );

        return Response.json(
          {
            success: false,
            error:
              "AI Tutor could not answer right now."
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
        const body =
          await request.json();

        const topic =
          String(
            body.topic || ""
          ).trim();

        let count =
          Number(body.count) || 5;

        if (count < 1) count = 1;
        if (count > 10) count = 10;

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

        const prompt =
          `Create exactly ${count} multiple choice questions about "${topic}".

Return ONLY JSON.

Format:
{"questions":[{"question":"...","options":["...","...","...","..."],"answer":0}]}

Rules:
- Exactly ${count} questions.
- Exactly four options per question.
- answer must be 0, 1, 2, or 3.
- No markdown.
- No explanation outside JSON.`;

        const result =
          await env.AI.run(
            "@cf/meta/llama-3.1-8b-instruct-fast",
            {
              messages: [
                {
                  role: "system",
                  content:
                    "You are PadhAI Quiz Generator. Create accurate educational multiple-choice questions and return valid JSON only."
                },
                {
                  role: "user",
                  content: prompt
                }
              ]
            }
          );

        let raw =
          result?.response;

        let questions = [];

        if (
          raw &&
          typeof raw === "object" &&
          Array.isArray(raw.questions)
        ) {
          questions =
            raw.questions;
        }

        if (
          typeof raw === "string"
        ) {
          try {
            let cleaned =
              raw
                .replace(
                  /```json/gi,
                  ""
                )
                .replace(
                  /```/g,
                  ""
                )
                .trim();

            const firstBrace =
              cleaned.indexOf("{");

            const lastBrace =
              cleaned.lastIndexOf("}");

            if (
              firstBrace !== -1 &&
              lastBrace !== -1
            ) {
              cleaned =
                cleaned.substring(
                  firstBrace,
                  lastBrace + 1
                );
            }

            const parsed =
              JSON.parse(cleaned);

            if (
              Array.isArray(parsed)
            ) {
              questions =
                parsed;
            } else if (
              Array.isArray(
                parsed.questions
              )
            ) {
              questions =
                parsed.questions;
            }

          } catch (error) {
            console.error(
              "QUIZ PARSE ERROR:",
              error
            );
          }
        }

        const validQuestions = [];

        for (
          const item of questions
        ) {
          if (!item) continue;

          const question =
            String(
              item.question || ""
            ).trim();

          if (!question) continue;

          if (
            !Array.isArray(
              item.options
            )
          ) {
            continue;
          }

          if (
            item.options.length < 4
          ) {
            continue;
          }

          const options =
            item.options
              .slice(0, 4)
              .map((x) =>
                String(
                  x || ""
                ).trim()
              );

          if (
            options.some(
              (x) => !x
            )
          ) {
            continue;
          }

          const answer =
            Number(item.answer);

          if (
            !Number.isInteger(answer) ||
            answer < 0 ||
            answer > 3
          ) {
            continue;
          }

          validQuestions.push({
            question,
            options,
            answer
          });

          if (
            validQuestions.length >=
            count
          ) {
            break;
          }
        }

        if (
          !validQuestions.length
        ) {
          return Response.json(
            {
              success: false,
              error:
                "PadhAI could not create valid questions. Please try another topic."
            },
            { status: 500 }
          );
        }

        return Response.json({
          success: true,
          topic,
          questions:
            validQuestions
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
              "Quiz generation failed."
          },
          { status: 500 }
        );
      }
    }

    // ==========================================
    // SAVE QUIZ SCORE
    // ==========================================

    if (
      url.pathname ===
        "/api/quiz-score" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

        const userId =
          Number(body.userId);

        const topic =
          String(
            body.topic || ""
          ).trim();

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
      url.pathname ===
        "/api/quiz-history" &&
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
              `SELECT id, topic, score, total, created_at
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
              "Could not load quiz history."
          },
          { status: 500 }
        );
      }
    }

    // ==========================================
    // AI STUDY
    // ==========================================

    if (
      url.pathname === "/api/study" &&
      request.method === "POST"
    ) {
      try {

        const body =
          await request.json();

        const topic =
          String(
            body.topic || ""
          ).trim();

        const level =
          String(
            body.level || "beginner"
          )
            .trim()
            .toLowerCase();


        if (!topic) {
          return Response.json(
            {
              success: false,
              error:
                "Please enter a study topic."
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


        const allowedLevels = [
          "beginner",
          "intermediate",
          "advanced"
        ];


        const safeLevel =
          allowedLevels.includes(level)
            ? level
            : "beginner";


        let difficulty =
          "";


        if (
          safeLevel ===
          "beginner"
        ) {

          difficulty = `
Teach the topic from the basics.
Assume the student has little previous knowledge.
Use simple language and easy examples.
`;

        }


        if (
          safeLevel ===
          "intermediate"
        ) {

          difficulty = `
Assume the student understands the basics.
Teach at an intermediate academic level.
Include deeper concepts, relationships,
applications and useful examples.
`;

        }


        if (
          safeLevel ===
          "advanced"
        ) {

          difficulty = `
Assume the student already understands
the fundamentals.
Teach at an advanced academic level.
Include deeper technical concepts,
detailed reasoning, applications,
limitations and advanced examples.
`;

        }


        const prompt = `
Create a complete educational lesson
about "${topic}".

Student level:
${safeLevel}

${difficulty}

Return ONLY valid JSON.

Use EXACTLY this structure:

{
  "title": "Lesson title",
  "introduction": "Introduction",
  "explanation": "Detailed explanation",
  "keyPoints": [
    "Important point 1",
    "Important point 2",
    "Important point 3",
    "Important point 4",
    "Important point 5"
  ],
  "example": "Useful example",
  "summary": "Short revision summary"
}

IMPORTANT:

- Return JSON only.
- No markdown.
- No code fences.
- No text outside JSON.
- keyPoints must be an array.
- All other fields must be strings.
- Do not leave introduction empty.
- Do not leave explanation empty.
- Do not leave summary empty.
- Make the lesson accurate.
- Match the requested difficulty.
`;


        const result =
          await env.AI.run(
            "@cf/meta/llama-3.2-3b-instruct",
            {
              messages: [
                {
                  role: "system",
                  content:
                    "You are PadhAI Study Teacher. Create accurate educational lessons and always return valid JSON only."
                },
                {
                  role: "user",
                  content: prompt
                }
              ]
            }
          );


        let raw =
          result?.response || "";


        if (
          typeof raw !==
          "string"
        ) {

          try {
            raw =
              JSON.stringify(
                raw
              );
          } catch {
            raw = "";
          }

        }


        console.log(
          "RAW STUDY RESPONSE:",
          raw
        );


        let cleaned =
          raw
            .replace(
              /```json/gi,
              ""
            )
            .replace(
              /```/g,
              ""
            )
            .trim();


        let study = null;


        // First JSON attempt

        try {

          study =
            JSON.parse(
              cleaned
            );

        } catch (error) {

          console.log(
            "DIRECT STUDY JSON PARSE FAILED"
          );

        }


        // Second JSON attempt

        if (!study) {

          try {

            const firstBrace =
              cleaned.indexOf(
                "{"
              );

            const lastBrace =
              cleaned.lastIndexOf(
                "}"
              );


            if (
              firstBrace !== -1 &&
              lastBrace !== -1 &&
              lastBrace >
                firstBrace
            ) {

              const extracted =
                cleaned.substring(
                  first
