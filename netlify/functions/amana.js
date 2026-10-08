import { getDatabase } from "@netlify/database";

const GOOGLE_SHEETS_AMANA_WEBHOOK = "https://script.google.com/macros/s/AKfycbzpOrk30NTdDkRrIJMFhRuXtRpJlfJaOJabem2t9xtcdu1J2TupIPUXkNl7BBYOBtEg2w/exec";

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
        const allSignatures = await db.sql`
          SELECT id, name, email, hide_name, created_at 
          FROM amana_signatures 
          ORDER BY id ASC
        `;
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
      let { name, email, hideName } = body;

      if (!name || !email) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      name = normalizeName(name);

      // 1. Save to Netlify Postgres Database
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

      // 2. Forward to Google Sheets
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
