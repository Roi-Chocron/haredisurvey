import { getDatabase } from "@netlify/database";

const GOOGLE_SHEETS_AMANA_WEBHOOK = "https://script.google.com/macros/s/AKfycbx1CE_NjUQ4WGN3ovmePw6OoDJGMQDP1NVNruT5v54JvngwuXdMsi9FOUpcuQI44uwUaQ/exec";

// In-memory cache for Google Sheets data to keep API response times ultra-fast (<50ms)
let sheetCache = {
  timestamp: 0,
  total: 0,
  names: []
};
const CACHE_TTL_MS = 25000; // 25 seconds cache

async function fetchGoogleSheetsData() {
  const now = Date.now();
  if (now - sheetCache.timestamp < CACHE_TTL_MS && sheetCache.total > 0) {
    return sheetCache;
  }
  try {
    const res = await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.total === "number") {
        const names = Array.isArray(data.allNames) 
          ? data.allNames 
          : (Array.isArray(data.recentNames) ? data.recentNames : []);
        sheetCache = {
          timestamp: now,
          total: data.total || 0,
          names: names
        };
      }
    }
  } catch (e) {
    // If Google Sheets is slow or times out, proceed seamlessly with cached or DB data
  }
  return sheetCache;
}

function normalizeName(name) {
  if (!name) return "";
  const trimmed = name.trim();
  if (trimmed === "אביה רווי" || trimmed.includes("רווי")) {
    return "אביה רווח";
  }
  return trimmed;
}

export default async (req) => {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);

  // GET: Return signatures count, recent visible names, and ALL visible names for scroll/search
  if (method === "GET") {
    // Admin / Inspection: export all signatures
    if (url.searchParams.get("export") === "1" || url.searchParams.get("export") === "all") {
      try {
        const db = getDatabase();
        let allSignatures;
        try {
          allSignatures = await db.sql`
            SELECT id, name, email, hide_name, selected_sections, created_at 
            FROM amana_signatures 
            ORDER BY id ASC
          `;
        } catch (colErr) {
          allSignatures = await db.sql`
            SELECT id, name, email, hide_name, created_at 
            FROM amana_signatures 
            ORDER BY id ASC
          `;
        }
        return new Response(JSON.stringify({ total: allSignatures.length, signatures: allSignatures }), {
          status: 200,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Clean test data and empty rows from database and Google Sheets
    if (url.searchParams.get("action") === "clean_test_data" || url.searchParams.get("clean") === "test_data") {
      try {
        const db = getDatabase();
        const deleted = await db.sql`
          DELETE FROM amana_signatures 
          WHERE 
            name ILIKE '%בדיקה%' 
            OR name ILIKE '%check%' 
            OR name ILIKE '%test%' 
            OR email ILIKE '%test%' 
            OR email ILIKE '%example.com%' 
            OR email ILIKE '%check%' 
            OR email = '123@1.1'
            OR TRIM(name) = '' 
            OR TRIM(email) = ''
          RETURNING id, name, email
        `;
        sheetCache.timestamp = 0; // invalidate cache

        // Also notify Google Sheets webhook to clean
        let sheetsCleanRes = null;
        try {
          const gRes = await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "clean_test_data" }),
            signal: AbortSignal.timeout(10000)
          });
          sheetsCleanRes = await gRes.json().catch(() => null);
        } catch (gErr) {
          sheetsCleanRes = { error: gErr.message };
        }

        return new Response(JSON.stringify({ 
          status: "success", 
          deletedDbCount: deleted.length, 
          deletedDbRows: deleted,
          sheetsCleanRes
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Sync all database signatures with selected_sections to Google Sheets
    if (url.searchParams.get("sync") === "sheets") {
      try {
        const db = getDatabase();
        let rows;
        try {
          rows = await db.sql`
            SELECT id, name, email, hide_name, selected_sections, created_at 
            FROM amana_signatures 
            ORDER BY id ASC
          `;
        } catch (colErr) {
          rows = await db.sql`
            SELECT id, name, email, hide_name, created_at 
            FROM amana_signatures 
            ORDER BY id ASC
          `;
        }

        const preparedRows = rows.map(r => ({
          name: normalizeName(r.name),
          email: r.email,
          hideName: Boolean(r.hide_name),
          hide_name: Boolean(r.hide_name),
          selectedSections: r.selected_sections || "כל 100 הסעיפים (פרקים 1-11)",
          selected_sections: r.selected_sections || "כל 100 הסעיפים (פרקים 1-11)",
          sections: r.selected_sections || "כל 100 הסעיפים (פרקים 1-11)",
          timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
        }));

        // 1. Try instant batch sync
        try {
          const batchRes = await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
              action: "batch_sync",
              signatures: preparedRows
            }),
            signal: AbortSignal.timeout(10000)
          });
          const batchData = await batchRes.json().catch(() => null);
          if (batchData && (batchData.status === "success" || batchData.updatedCount !== undefined)) {
            return new Response(JSON.stringify({ 
              status: "success", 
              mode: "batch", 
              total: rows.length, 
              details: batchData 
            }), {
              status: 200,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
          }
        } catch (bErr) {
          console.log("Batch sync fallback:", bErr.message);
        }

        // 2. Fallback to parallel individual posts
        let syncedCount = 0;
        for (let i = 0; i < preparedRows.length; i += 5) {
          const batch = preparedRows.slice(i, i + 5);
          await Promise.all(batch.map(async (row) => {
            try {
              const res = await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({
                  action: "sign_amana",
                  name: row.name,
                  email: row.email,
                  hideName: row.hideName,
                  selectedSections: row.selectedSections,
                  selected_sections: row.selectedSections,
                  sections: row.selectedSections,
                  timestamp: row.timestamp
                }),
                signal: AbortSignal.timeout(6000)
              });
              if (res.ok) syncedCount++;
            } catch (err) {}
          }));
        }

        return new Response(JSON.stringify({ status: "success", mode: "individual", syncedCount, total: rows.length }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
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

      // Proactively fix any typo of 'רווי' to 'רווח' in database
      try {
        await db.sql`UPDATE amana_signatures SET name = 'אביה רווח' WHERE name LIKE '%רווי%'`;
      } catch (fixErr) {
        // Non-critical if table is not yet created
      }

      const countRes = await db.sql`SELECT COUNT(*)::int AS total FROM amana_signatures`;
      const allRes = await db.sql`
        SELECT name FROM amana_signatures 
        WHERE hide_name = false 
        ORDER BY id DESC
      `;

      const dbTotal = countRes[0]?.total || 0;
      const dbNames = allRes.map((r) => normalizeName(r.name)).filter(Boolean);

      // Total and names are pulled directly and strictly from the database
      const total = dbTotal;
      const recentNames = dbNames.slice(0, 12);
      const allNames = dbNames;

      return new Response(JSON.stringify({ 
        total, 
        recentNames,
        allNames 
      }), {
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        }
      });
    } catch (err) {
      console.error("Database query error:", err);
      // Fallback: try fetching from Google Sheets if database isn't populated or error occurs
      try {
        const gsData = await fetchGoogleSheetsData();
        const gsNames = (gsData.names || []).map(normalizeName).filter(Boolean);
        return new Response(JSON.stringify({ 
          total: gsData.total || gsNames.length, 
          recentNames: gsNames.slice(0, 12),
          allNames: gsNames
        }), {
          status: 200,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ total: 0, recentNames: [], allNames: [] }), {
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
      let { name, email, hideName, selectedSectionsSummary, selectedTopics } = body;

      if (!name || !email) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      name = normalizeName(name);
      const sectionsText = selectedSectionsSummary || (Array.isArray(selectedTopics) ? selectedTopics.join(", ") : "כל 100 הסעיפים (פרקים 1-11)");

      // Check if email already signed - if so, update their selected_sections and forward update to Sheets!
      try {
        const db = getDatabase();
        const existing = await db.sql`
          SELECT id FROM amana_signatures 
          WHERE LOWER(TRIM(email)) = ${email.toLowerCase().trim()} 
          LIMIT 1
        `;
        if (existing.length > 0) {
          try {
            await db.sql`
              UPDATE amana_signatures 
              SET selected_sections = ${sectionsText}, name = ${name}, hide_name = ${Boolean(hideName)}
              WHERE LOWER(TRIM(email)) = ${email.toLowerCase().trim()}
            `;
          } catch (updErr) {
            console.error("Error updating existing record in db:", updErr);
          }
          // Forward update to Google Sheets
          try {
            await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, {
              method: "POST",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify({
                action: "sign_amana",
                name,
                email,
                hideName: Boolean(hideName),
                hide_name: Boolean(hideName),
                selectedSections: sectionsText,
                selected_sections: sectionsText,
                sections: sectionsText,
                timestamp: new Date().toISOString()
              }),
              signal: AbortSignal.timeout(8000)
            });
          } catch (sheetErr) {
            console.error("Error updating Google Sheets:", sheetErr);
          }

          return new Response(JSON.stringify({ status: "success", updated: true }), {
            status: 200,
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
        }
      } catch (checkErr) {
        console.error("Duplicate check error:", checkErr);
      }

      // 1. Save to Netlify Postgres Database
      const saveDbPromise = (async () => {
        try {
          const db = getDatabase();
          try {
            await db.sql`
              INSERT INTO amana_signatures (name, email, hide_name, selected_sections)
              VALUES (${name}, ${email}, ${Boolean(hideName)}, ${sectionsText})
            `;
          } catch (colErr) {
            try {
              await db.sql`ALTER TABLE amana_signatures ADD COLUMN IF NOT EXISTS selected_sections TEXT`;
              await db.sql`
                INSERT INTO amana_signatures (name, email, hide_name, selected_sections)
                VALUES (${name}, ${email}, ${Boolean(hideName)}, ${sectionsText})
              `;
            } catch (fallbackErr) {
              await db.sql`
                INSERT INTO amana_signatures (name, email, hide_name)
                VALUES (${name}, ${email}, ${Boolean(hideName)})
              `;
            }
          }
          return true;
        } catch (dbErr) {
          console.error("Error saving to database:", dbErr);
          return false;
        }
      })();

      // 2. Forward to Google Sheets
      const forwardSheetPromise = (async () => {
        try {
          const res = await fetch(GOOGLE_SHEETS_AMANA_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
              action: "sign_amana",
              name,
              email,
              hideName: Boolean(hideName),
              hide_name: Boolean(hideName),
              selectedSections: sectionsText,
              selected_sections: sectionsText,
              sections: sectionsText,
              timestamp: new Date().toISOString()
            }),
            signal: AbortSignal.timeout(8000)
          });
          return res.ok;
        } catch (sheetErr) {
          console.error("Error forwarding to Google Sheets:", sheetErr);
          return false;
        }
      })();

      // Invalidate sheet cache so next GET reflects the new signature
      sheetCache.timestamp = 0;

      await Promise.all([saveDbPromise, forwardSheetPromise]);

      return new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
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
