import { getDatabase } from "@netlify/database";

const GOOGLE_SHEETS_SURVEY_WEBHOOK = "https://script.google.com/macros/s/AKfycbze-gp1fhKJX-UfDAbacHEBaam4gzuQ4Gs-YP2Aru5h0bGxHI5wNb3Z8d6RHcHP3PJ5/exec";

export default async (req) => {
  const method = req.method.toUpperCase();

  // GET: Return vote count
  if (method === "GET") {
    try {
      const db = getDatabase();
      const countRes = await db.sql`SELECT COUNT(*)::int AS total FROM survey_votes WHERE type = 'vote'`;
      const total = countRes[0]?.total || 0;

      return new Response(JSON.stringify({ total }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Database query error:", err);
      // Fallback: try fetching from Google Sheets
      try {
        const gsRes = await fetch(GOOGLE_SHEETS_SURVEY_WEBHOOK);
        const gsData = await gsRes.json();
        return new Response(JSON.stringify(gsData), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  }

  // POST: Save vote or notify lead to Database and forward to Google Sheets
  if (method === "POST") {
    try {
      const body = await req.json();
      const { type, name, phone, email, votes, timestamp } = body;

      if (!name || !phone) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Check duplicate vote by phone if type === 'vote'
      if (type === "vote") {
        try {
          const db = getDatabase();
          const cleanPhone = phone.replace(/[\s\-]/g, "");
          const existing = await db.sql`
            SELECT id FROM survey_votes 
            WHERE type = 'vote' AND REPLACE(REPLACE(phone, ' ', ''), '-', '') = ${cleanPhone}
            LIMIT 1
          `;
          if (existing.length > 0) {
            return new Response(JSON.stringify({ error: "Phone number already voted" }), {
              status: 409,
              headers: { "Content-Type": "application/json" }
            });
          }
        } catch (dbCheckErr) {
          console.error("Duplicate check error:", dbCheckErr);
        }
      }

      // 1. Save to Netlify Postgres Database
      try {
        const db = getDatabase();
        await db.sql`
          INSERT INTO survey_votes (type, name, phone, email, votes)
          VALUES (${type || "vote"}, ${name}, ${phone}, ${email || ""}, ${votes || ""})
        `;
      } catch (dbErr) {
        console.error("Error saving vote to database:", dbErr);
      }

      // 2. Forward to Google Sheets from the server
      try {
        await fetch(GOOGLE_SHEETS_SURVEY_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: type || "vote",
            name,
            phone,
            email: email || "",
            votes: votes || "",
            timestamp: timestamp || new Date().toLocaleString("he-IL")
          })
        });
      } catch (sheetErr) {
        console.error("Error forwarding to Google Sheets:", sheetErr);
      }

      return new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Error processing POST request:", err);
      return new Response(JSON.stringify({ error: "Invalid request payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = {
  path: "/api/survey"
};
