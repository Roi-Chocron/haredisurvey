import { getDatabase } from "@netlify/database";

const GOOGLE_SHEETS_AMANA_WEBHOOK = "https://script.google.com/macros/s/AKfycbzpOrk30NTdDkRrIJMFhRuXtRpJlfJaOJabem2t9xtcdu1J2TupIPUXkNl7BBYOBtEg2w/exec";

export default async (req) => {
  const method = req.method.toUpperCase();

  const url = new URL(req.url);

  // GET: Return signatures count and recent visible names (or export all for admin/sync)
  if (method === "GET") {
    // Admin / Inspection: export all signatures
    if (url.searchParams.get("export") === "1" || url.searchParams.get("export") === "all") {
      try {
        const db = getDatabase();
        const allSignatures = await db.sql`
          SELECT id, name, email, hide_name, created_at 
          FROM amana_signatures 
          ORDER BY id ASC
        `;
        return new Response(JSON.stringify({ total: allSignatures.length, signatures: allSignatures }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Admin / Sync: push signatures from database to Google Sheets
    if (url.searchParams.get("sync") === "1" || url.searchParams.get("sync") === "all") {
      try {
        const db = getDatabase();
        const fromId = parseInt(url.searchParams.get("fromId") || "0", 10);
        const toId = url.searchParams.get("toId") ? parseInt(url.searchParams.get("toId"), 10) : null;
        
        let rows;
        if (toId) {
          rows = await db.sql`
            SELECT id, name, email, hide_name, created_at 
            FROM amana_signatures 
            WHERE id > ${fromId} AND id <= ${toId}
            ORDER BY id ASC
          `;
        } else {
          rows = await db.sql`
            SELECT id, name, email, hide_name, created_at 
            FROM amana_signatures 
            WHERE id > ${fromId}
            ORDER BY id ASC
          `;
        }

        const results = [];
        // Process in small batches of 3 to avoid Google Apps Script rate limits
        for (let i = 0; i < rows.length; i += 3) {
          const batch = rows.slice(i, i + 3);
          await Promise.all(batch.map(async (row) => {
            try {
              const res = await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: JSON.stringify({
                  action: "sign_amana",
                  name: row.name,
                  email: row.email,
                  hideName: Boolean(row.hide_name),
                  timestamp: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
                }),
                signal: AbortSignal.timeout(10000)
              });
              results.push({ id: row.id, name: row.name, email: row.email, ok: res.ok });
            } catch (postErr) {
              results.push({ id: row.id, name: row.name, email: row.email, ok: false, error: postErr.message });
            }
          }));
          if (i + 3 < rows.length) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        return new Response(JSON.stringify({ syncedCount: results.length, details: results }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (syncErr) {
        return new Response(JSON.stringify({ error: syncErr.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

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

      // Support manual sync via POST
      if (body.action === "sync_to_sheets") {
        try {
          const db = getDatabase();
          const fromId = body.fromId ? parseInt(body.fromId, 10) : 0;
          const toId = body.toId ? parseInt(body.toId, 10) : null;
          let rows;
          if (toId) {
            rows = await db.sql`
              SELECT id, name, email, hide_name, created_at 
              FROM amana_signatures 
              WHERE id > ${fromId} AND id <= ${toId}
              ORDER BY id ASC
            `;
          } else {
            rows = await db.sql`
              SELECT id, name, email, hide_name, created_at 
              FROM amana_signatures 
              WHERE id > ${fromId}
              ORDER BY id ASC
            `;
          }

          const results = [];
          for (let i = 0; i < rows.length; i += 3) {
            const batch = rows.slice(i, i + 3);
            await Promise.all(batch.map(async (row) => {
              try {
                const res = await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: JSON.stringify({
                    action: "sign_amana",
                    name: row.name,
                    email: row.email,
                    hideName: Boolean(row.hide_name),
                    timestamp: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
                  }),
                  signal: AbortSignal.timeout(10000)
                });
                results.push({ id: row.id, name: row.name, email: row.email, ok: res.ok });
              } catch (postErr) {
                results.push({ id: row.id, name: row.name, email: row.email, ok: false, error: postErr.message });
              }
            }));
            if (i + 3 < rows.length) {
              await new Promise((r) => setTimeout(r, 400));
            }
          }

          return new Response(JSON.stringify({ syncedCount: results.length, details: results }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        } catch (syncErr) {
          return new Response(JSON.stringify({ error: syncErr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      }

      const { name, email, hideName } = body;

      if (!name || !email) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 1. Save to Netlify Postgres Database & 2. Forward to Google Sheets concurrently, awaiting both
      const saveDbPromise = (async () => {
        try {
          const db = getDatabase();
          await db.sql`
            INSERT INTO amana_signatures (name, email, hide_name)
            VALUES (${name}, ${email}, ${Boolean(hideName)})
          `;
          return true;
        } catch (dbErr) {
          console.error("Error saving to database:", dbErr);
          return false;
        }
      })();

      const forwardSheetPromise = (async () => {
        try {
          const res = await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: JSON.stringify({
              action: "sign_amana",
              name,
              email,
              hideName: Boolean(hideName),
              timestamp: new Date().toISOString()
            }),
            signal: AbortSignal.timeout(10000)
          });
          return res.ok;
        } catch (sheetErr) {
          console.error("Error forwarding to Google Sheets:", sheetErr);
          return false;
        }
      })();

      // Await both promises so the serverless function does not exit/freeze before completion
      await Promise.all([saveDbPromise, forwardSheetPromise]);

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
