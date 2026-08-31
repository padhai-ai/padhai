export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    // ==========================================
    // HELPER: PASSWORD HASH
    // ==========================================

    async function hashPassword(password) {

      const hashBuffer =
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(password)
        );

      return Array.from(
        new Uint8Array(hashBuffer)
      )
        .map(byte =>
          byte.toString(16).padStart(2, "0")
        )
        .join("");
    }


    // ==========================================
    // HELPER: VALIDATE QUESTIONS
    // ==========================================

    function validateQuestions(
      questions,
      count
    ) {

      if (!Array.isArray(questions)) {
        return [];
      }

      const valid = [];

      for (const q of questions) {

        if (!q) continue;

        if (
          typeof q.question !== "string" ||
          !q.question.trim()
        ) {
          continue;
        }

        if (
          !Array.isArray(q.options) ||
          q.options.length !== 4
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

        const answer =
          Number(q.answer);

        if (
          !Number.isInteger(answer) ||
          answer < 0 ||
          answer > 3
        ) {
          continue;
        }

        valid.push({

          question:
            q.question.trim(),

          options,

          answer

        });

        if (valid.length >= count) {
          break;
        }
      }

      return valid;
    }


    // ==========================================
    // HELPER: EXTRACT JSON
    // ==========================================

    function extractQuestions(response) {

      if (!response) {
        return null;
      }

      // Already an object
      if (
        typeof response === "object"
      ) {

        if (
          Array.isArray(
            response.questions
          )
        ) {
          return response.questions;
        }

        if (
          Array.isArray(response)
        ) {
          return response;
        }
      }

      let raw =
        String(response).trim();

      // Remove markdown fences
      raw =
        raw.replace(
          /```json/gi,
          ""
        );

      raw =
        raw.replace(
          /```/g,
          ""
        );

      raw =
        raw.trim();

      // Try complete JSON first
      try {

        const parsed =
          JSON.parse(raw);

        if (
          Array.isArray(parsed)
        ) {
          return parsed;
        }

        if (
          Array.isArray(
            parsed.questions
          )
        ) {
          return parsed.questions;
        }

      } catch (error) {
        // Continue to extraction
      }

      // Find object containing questions
      const objectStart =
        raw.indexOf("{");

      const objectEnd =
        raw.lastIndexOf("}");

      if (
        objectStart !== -1 &&
        objectEnd > objectStart
      ) {

        try {

          const parsed =
            JSON.parse(
              raw.substring(
                objectStart,
                objectEnd + 1
              )
            );

          if (
            Array.isArray(
              parsed.questions
            )
          ) {
            return parsed.questions;
          }

        } catch (error) {
          // Continue
        }
      }

      // Find array
      const arrayStart =
        raw.indexOf("[");

      const arrayEnd =
        raw.lastIndexOf("]");

      if (
        arrayStart !== -1 &&
        arrayEnd > arrayStart
      ) {

        try {

          const parsed =
            JSON.parse(
              raw.substring(
                arrayStart,
                arrayEnd + 1
              )
            );

          if (
            Array.isArray(parsed)
          ) {
            return parsed;
          }

        } catch (error) {
          // Invalid JSON
        }
      }

      return null;
    }


    // ==========================================
    // SIGNUP
    // ==========================================

    if (
      url.pathname === "/api/signup" &&
      request.method === "POST"
    ) {

      try {

        const {
          name,
          email,
          password
        } = await request.json();

        if (
          !name ||
          !email ||
          !password
        ) {

          return Response.json(
            {
              success: false,
              error:
                "All fields are required."
            },
            { status: 400 }
          );
        }

        if (
          password.length < 6
        ) {

          return Response.json(
            {
              success: false,
              error:
                "Password must be at least 6 characters."
            },
            { status: 400 }
          );
        }

        const cleanEmail =
          email.toLowerCase().trim();

        const passwordHash =
          await hashPassword(
            password
          );

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

          id:
            result.meta?.last_row_id ||
            null,

          name:
            name.trim(),

          email:
            cleanEmail

        });

      } catch (error) {

        console.error(
          "SIGNUP ERROR:",
          error
        );

        if (
          error.message &&
          error.message.includes(
            "UNIQUE"
          )
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

        const {
          email,
          password
        } = await request.json();

        if (
          !email ||
          !password
        ) {

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

        const passwordHash =
          await hashPassword(
            password
          );

        const user =
          await env.DB
            .prepare(
              `SELECT
                 id,
                 name,
                 email
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

          id:
            user.id,

          name:
            user.name,

          email:
            user.email

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

                  content:
                    question
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
              error.message ||
              "Unknown error"
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


        // ======================================
        // GENERATE FUNCTION
        // ======================================

        async function generateQuiz(
          retry = false
        ) {

          const model =
            "@cf/meta/llama-3.1-8b-instruct-fast";

          let userPrompt;

          if (!retry) {

            userPrompt = `
Create ${count} educational multiple-choice questions about:

${topic}

Return ONLY JSON.

Use this exact structure:

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

- Create exactly ${count} questions.
- Every question MUST have exactly 4 options.
- answer MUST be 0, 1, 2, or 3.
- answer identifies the correct option.
- Only one option is correct.
- Make questions factually correct.
- Do not use markdown.
- Do not add explanations.
- JSON ONLY.
`;

          } else {

            userPrompt = `
Create ${count} simple and reliable multiple-choice questions about:

${topic}

This is a retry.

Return ONLY a JSON object.

Every question MUST contain:
- question
- exactly 4 options
- answer from 0 to 3

Format:

{
  "questions": [
    {
      "question": "Question",
      "options": [
        "A",
        "B",
        "C",
        "D"
      ],
      "answer": 0
    }
  ]
}

Return exactly ${count} questions.

JSON ONLY.
`;
          }


          const result =
            await env.AI.run(
              model,
              {
                messages: [

                  {
                    role: "system",

                    content:
                      `You are PadhAI's quiz generator.

Your job is to create valid educational multiple-choice questions.

Always follow the requested JSON format.`
                  },

                  {
                    role: "user",

                    content:
                      userPrompt
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
                              },

                              minItems: 4,
                              maxItems: 4
                            },

                            answer: {

                              type: "integer",

                              minimum: 0,
                              maximum: 3

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

                temperature:
                  retry ? 0.1 : 0.2,

                max_tokens:
                  2500

              }
            );

          console.log(
            "QUIZ AI RESULT:",
            JSON.stringify(result)
          );

          return extractQuestions(
            result?.response
          );
        }


        // ======================================
        // FIRST ATTEMPT
        // ======================================

        let questions =
          await generateQuiz(false);

        let validQuestions =
          validateQuestions(
            questions,
            count
          );


        // ======================================
        // RETRY IF NEEDED
        // ======================================

        if (
          validQuestions.length <
          count
        ) {

          console.log(
            "Quiz incomplete. Retrying..."
          );

          questions =
            await generateQuiz(true);

          validQuestions =
            validateQuestions(
              questions,
              count
            );
        }


        // ======================================
        // FINAL RESPONSE
        // ======================================

        if (
          validQuestions.length <
          count
        ) {

          console.error(
            "FINAL INVALID QUIZ:",
            JSON.stringify(
              validQuestions
            )
          );

          return Response.json(
            {
              success: false,
              error:
                "PadhAI couldn't generate a complete quiz this time. Please try again."
            },
            { status: 500 }
          );

        }


        return Response.json({

          success: true,

          topic,

          questions:
            validQuestions.slice(
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
              total INTEGER NOT NU
