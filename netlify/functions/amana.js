import { getDatabase } from "@netlify/database";

const GOOGLE_SHEETS_AMANA_WEBHOOK = "https://script.google.com/macros/s/AKfycbzpOrk30NTdDkRrIJMFhRuXtRpJlfJaOJabem2t9xtcdu1J2TupIPUXkNl7BBYOBtEg2w/exec";

export default async (req) => {
  const method = req.method.toUpperCase();

  // GET: Return signatures count and recent visible names
  if (method === "GET") {
    try {
      const db = getDatabase();
      const countRes = await db.sql`SELECT COUNT(*)::int AS total FROM amana_signatures`;
      const recentRes = await db.sql`
        SELECT name FROM amana_signatures 
        WHERE hide_name = false 
        ORDER BY id DESC 
        LIMIT 12
      `;

      const total = countRes[0]?.total || 0;
      const recentNames = recentRes.map((r) => r.name);

      return new Response(JSON.stringify({ total, recentNames }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Database query error:", err);
      // Fallback: try fetching from Google Sheets if database isn't populated or error occurs
      try {
        const gsRes = await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK);
        const gsData = await gsRes.json();
        return new Response(JSON.stringify(gsData), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ total: 0, recentNames: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  }

  // POST: Save signature to Database and forward to Google Sheets
  if (method === "POST") {
    try {
      const body = await req.json();
      const { name, email, hideName } = body;

      if (!name || !email) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 1. Save to Netlify Postgres Database
      try {
        const db = getDatabase();
        await db.sql`
          INSERT INTO amana_signatures (name, email, hide_name)
          VALUES (${name}, ${email}, ${Boolean(hideName)})
        `;
      } catch (dbErr) {
        console.error("Error saving to database:", dbErr);
      }

      // 2. Forward to Google Sheets asynchronously (non-blocking, so user gets immediate response)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: JSON.stringify({
          action: "sign_amana",
          name,
          email,
          hideName: Boolean(hideName),
          timestamp: new Date().toISOString()
        }),
        signal: controller.signal
      })
      .catch((sheetErr) => console.error("Error forwarding to Google Sheets:", sheetErr))
      .finally(() => clearTimeout(timeoutId));

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
  path: "/api/amana"
};
