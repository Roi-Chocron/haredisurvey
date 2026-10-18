import { getDatabase } from "@netlify/database";

const GOOGLE_SHEETS_AMANA_WEBHOOK = "https://script.google.com/macros/s/AKfycbzk9m6bvyFX-Fi_flymmE9YEGlaSfhKwImBEjHceVgOEPE-gC4vK6ycNhkYmnc9zZTDfg/exec";
const GOOGLE_SHEETS_CSV_URL = "https://docs.google.com/spreadsheets/d/1pcD9QWdM6D04acwRcGfkoB_BcBe2nAyeIIE3Mej0vWA/export?format=csv";

// 23 Fabricated alphabet signatures to exclude and clean
const FAKE_ALPHABET_EMAILS = new Set([
  "k5412954@gmail.com",
  "shnews@gmail.com",
  "41455@gmail.com",
  "pninapfaa@gmail.com",
  "741542@gmail.com",
  "874152@gmail.com",
  "ews@gmail.com",
  "4124@gmail.com",
  "414889@gmail.com",
  "412365@gmail.com",
  "4125896@gmail.com",
  "87412@gmail.com",
  "4155854@gmail.com",
  "82824@gmail.com",
  "k028542333@gmail.com",
  "k0485696@gmail.com",
  "855595@gmail.com",
  "8333@gmail.com",
  "68154@gmail.com",
  "755594@gmail.com",
  "74554@gmail.com",
  "8555595@gmail.com",
  "74555954@gmail.com"
]);

// In-memory cache for API response times (<50ms)
let sheetCache = {
  timestamp: 0,
  total: 0,
  names: []
};
const CACHE_TTL_MS = 25000; // 25 seconds cache
let lastSyncTimestamp = 0;
const SYNC_INTERVAL_MS = 25000; // 25 seconds sync interval

function normalizeName(name) {
  if (!name) return "";
  const trimmed = name.trim();
  // Only normalize the specific typo 'אביה רווי' to 'אביה רווח'
  // Do NOT match substrings like 'הורוויץ'
  if (trimmed === "אביה רווי" || trimmed === "רווי") {
    return "אביה רווח";
  }
  return trimmed;
}

function parseIsraeliDateTime(str) {
  if (!str) return new Date();
  const trimmed = str.toString().trim();
  if (trimmed.includes("T") || trimmed.includes("Z")) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }
  const match = trimmed.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    const hours = match[4] ? parseInt(match[4], 10) : 12;
    const minutes = match[5] ? parseInt(match[5], 10) : 0;
    const seconds = match[6] ? parseInt(match[6], 10) : 0;
    return new Date(Date.UTC(year, month, day, hours - 3, minutes, seconds));
  }
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

function parseCSVRow(line) {
  const parts = [];
  let current = "";
  let inQuotes = false;
  for (let c = 0; c < line.length; c++) {
    const ch = line[c];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

function parseGoogleSheetsCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = parseCSVRow(line);
    const dateStr = parts[0] || "";
    let name = (parts[1] || "").trim();
    const email = (parts[2] || "").toLowerCase().trim();
    const hideNameRaw = (parts[3] || "").toString().toLowerCase().trim();
    const hideName = (hideNameRaw === "true" || hideNameRaw === "1");
    const sections = (parts[4] || "כל 100 הסעיפים (פרקים 1-11)").trim();

    // Skip empty, test, or known fake emails
    if (!email || !email.includes("@") || !name) continue;
    if (FAKE_ALPHABET_EMAILS.has(email)) continue;
    if (email.includes("test") || email.includes("example.com") || email.includes("check") || email === "123@1.1") continue;
    if (name.includes("בדיקה") || name.includes("test") || name.includes("check")) continue;

    if (email === "saramolayemhorwitz@gmail.com") {
      name = "שרה מולאים הורוויץ";
    } else {
      name = normalizeName(name);
    }

    rows.push({
      dateStr,
      name,
      email,
      hideName,
      sections
    });
  }
  return rows;
}

async function syncFromGoogleSheets(db, force = false) {
  const now = Date.now();
  if (!force && (now - lastSyncTimestamp < SYNC_INTERVAL_MS)) {
    return { status: "cached", reason: "throttled" };
  }
  lastSyncTimestamp = now;

  try {
    const res = await fetch(GOOGLE_SHEETS_CSV_URL, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) {
      return { status: "error", message: "Failed to fetch Google Sheets CSV: " + res.status };
    }
    const csv = await res.text();
    const sheetRows = parseGoogleSheetsCSV(csv);

    if (sheetRows.length < 30) {
      // Safety guard against empty/partial sheet
      return { status: "skipped", reason: "too_few_rows", count: sheetRows.length };
    }

    let dbRows;
    try {
      dbRows = await db.sql`SELECT id, name, email, hide_name, selected_sections, created_at FROM amana_signatures`;
    } catch (e) {
      dbRows = await db.sql`SELECT id, name, email, hide_name FROM amana_signatures`;
    }

    const dbMap = new Map();
    for (const r of dbRows) {
      const em = (r.email || "").toLowerCase().trim();
      if (em && !dbMap.has(em)) {
        dbMap.set(em, r);
      }
    }

    const validSheetEmails = new Set();
    let updatedCount = 0;
    let insertedCount = 0;

    for (const sRow of sheetRows) {
      const em = sRow.email;
      validSheetEmails.add(em);
      const existing = dbMap.get(em);

      if (existing) {
        const nameChanged = existing.name !== sRow.name;
        const hideChanged = Boolean(existing.hide_name) !== Boolean(sRow.hideName);
        const sectionsChanged = (existing.selected_sections || "") !== (sRow.sections || "");

        if (nameChanged || hideChanged || sectionsChanged) {
          try {
            await db.sql`
              UPDATE amana_signatures 
              SET name = ${sRow.name}, hide_name = ${sRow.hideName}, selected_sections = ${sRow.sections}
              WHERE LOWER(TRIM(email)) = ${em}
            `;
          } catch (updErr) {
            await db.sql`
              UPDATE amana_signatures 
              SET name = ${sRow.name}, hide_name = ${sRow.hideName}
              WHERE LOWER(TRIM(email)) = ${em}
            `;
          }
          updatedCount++;
        }
      } else {
        // New row added in Google Sheets
        const createdAt = parseIsraeliDateTime(sRow.dateStr);
        try {
          await db.sql`
            INSERT INTO amana_signatures (name, email, hide_name, selected_sections, created_at)
            VALUES (${sRow.name}, ${em}, ${sRow.hideName}, ${sRow.sections}, ${createdAt})
          `;
        } catch (insErr) {
          try {
            await db.sql`
              INSERT INTO amana_signatures (name, email, hide_name, selected_sections)
              VALUES (${sRow.name}, ${em}, ${sRow.hideName}, ${sRow.sections})
            `;
          } catch (fErr) {
            await db.sql`
              INSERT INTO amana_signatures (name, email, hide_name)
              VALUES (${sRow.name}, ${em}, ${sRow.hideName})
            `;
          }
        }
        insertedCount++;
      }
    }

    // Delete rows removed from Google Sheets or in fake alphabet set
    let deletedCount = 0;
    if (validSheetEmails.size >= 50) {
      for (const dRow of dbRows) {
        const em = (dRow.email || "").toLowerCase().trim();
        if (!validSheetEmails.has(em) || FAKE_ALPHABET_EMAILS.has(em)) {
          await db.sql`DELETE FROM amana_signatures WHERE id = ${dRow.id}`;
          deletedCount++;
        }
      }
    }

    sheetCache.timestamp = 0; // invalidate cache

    return {
      status: "success",
      totalInSheet: sheetRows.length,
      updatedCount,
      insertedCount,
      deletedCount
    };
  } catch (err) {
    console.error("syncFromGoogleSheets error:", err);
    return { status: "error", error: err.message };
  }
}

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
  } catch (e) {}
  return sheetCache;
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

    // Force Sync from Google Sheets to Database
    if (url.searchParams.get("action") === "sync_from_sheets" || url.searchParams.get("sync") === "from_sheets") {
      try {
        const db = getDatabase();
        const syncRes = await syncFromGoogleSheets(db, true);
        return new Response(JSON.stringify(syncRes), {
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

    // Clean fake alphabet signatures, duplicates, and test data
    if (
      url.searchParams.get("action") === "clean_fake_and_duplicates" ||
      url.searchParams.get("action") === "clean_test_data" || 
      url.searchParams.get("action") === "cleanup" ||
      url.searchParams.get("clean") === "test_data"
    ) {
      try {
        const db = getDatabase();
        
        // 1. Delete duplicate for sari.vlado@gmail.com (id 5, keep id 6)
        await db.sql`DELETE FROM amana_signatures WHERE id = 5 OR (email = 'sari.vlado@gmail.com' AND name = 'שרי ליבוביץ' AND id != 6)`;

        // 2. Delete fake alphabet signatures
        const deletedFakes = await db.sql`
          DELETE FROM amana_signatures 
          WHERE email IN (
            'k5412954@gmail.com', 'shnews@gmail.com', '41455@gmail.com',
            'pninapfaa@gmail.com', '741542@gmail.com', '874152@gmail.com',
            'ews@gmail.com', '4124@gmail.com', '414889@gmail.com',
            '412365@gmail.com', '4125896@gmail.com', '87412@gmail.com',
            '4155854@gmail.com', '82824@gmail.com', 'k028542333@gmail.com',
            'k0485696@gmail.com', '855595@gmail.com', '8333@gmail.com',
            '68154@gmail.com', '755594@gmail.com', '74554@gmail.com',
            '8555595@gmail.com', '74555954@gmail.com'
          )
          RETURNING id, name, email
        `;

        // 3. Restore Sara Molayem Horwitz
        await db.sql`
          UPDATE amana_signatures 
          SET name = 'שרה מולאים הורוויץ' 
          WHERE email = 'saramolayemhorwitz@gmail.com'
        `;

        // 4. Delete test / empty rows
        const deletedTests = await db.sql`
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

        sheetCache.timestamp = 0;

        return new Response(JSON.stringify({ 
          status: "success", 
          deletedFakesCount: deletedFakes.length,
          deletedTestsCount: deletedTests.length,
          deletedFakes,
          deletedTests
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

    try {
      const db = getDatabase();

      // Automatically sync from Google Sheets if cache interval expired (keeps DB updated with any Google Sheets edits!)
      try {
        await syncFromGoogleSheets(db);
      } catch (syncErr) {
        console.error("Auto sync from sheets error:", syncErr);
      }

      // Proactively fix Aviya Rev typo and restore Sara Molayem Horwitz
      try {
        await db.sql`UPDATE amana_signatures SET name = 'אביה רווח' WHERE (name = 'אביה רווי' OR email = 'aviyarev@gmail.com') AND email != 'saramolayemhorwitz@gmail.com'`;
        await db.sql`UPDATE amana_signatures SET name = 'שרה מולאים הורוויץ' WHERE email = 'saramolayemhorwitz@gmail.com'`;
      } catch (fixErr) {}

      const countRes = await db.sql`SELECT COUNT(*)::int AS total FROM amana_signatures`;
      const allRes = await db.sql`
        SELECT name FROM amana_signatures 
        WHERE hide_name = false 
        ORDER BY id DESC
      `;

      const dbTotal = countRes[0]?.total || 0;
      const dbNames = allRes.map((r) => normalizeName(r.name)).filter(Boolean);

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

  // POST: Save signature to Database and forward to Google Sheets (OR sync webhook)
  if (method === "POST") {
    try {
      const body = await req.json();

      // Support sync_from_sheets via POST
      if (body.action === "sync_from_sheets") {
        const db = getDatabase();
        const syncRes = await syncFromGoogleSheets(db, true);
        return new Response(JSON.stringify(syncRes), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      let { name, email, hideName, selectedSectionsSummary, selectedTopics, timestamp } = body;

      if (!name || !email) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      name = normalizeName(name);
      const sectionsText = selectedSectionsSummary || (Array.isArray(selectedTopics) ? selectedTopics.join(", ") : "כל 100 הסעיפים (פרקים 1-11)");
      const createdAt = parseIsraeliDateTime(timestamp);

      // Check if email already signed - if so, update their selected_sections and forward update to Sheets
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
                timestamp: createdAt.toISOString()
              }),
              signal: AbortSignal.timeout(8000)
            });
          } catch (sheetErr) {
            console.error("Error updating Google Sheets:", sheetErr);
          }

          sheetCache.timestamp = 0;

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
              INSERT INTO amana_signatures (name, email, hide_name, selected_sections, created_at)
              VALUES (${name}, ${email}, ${Boolean(hideName)}, ${sectionsText}, ${createdAt})
            `;
          } catch (colErr) {
            try {
              await db.sql`ALTER TABLE amana_signatures ADD COLUMN IF NOT EXISTS selected_sections TEXT`;
              await db.sql`
                INSERT INTO amana_signatures (name, email, hide_name, selected_sections, created_at)
                VALUES (${name}, ${email}, ${Boolean(hideName)}, ${sectionsText}, ${createdAt})
              `;
            } catch (fallbackErr) {
              await db.sql`
                INSERT INTO amana_signatures (name, email, hide_name, created_at)
                VALUES (${name}, ${email}, ${Boolean(hideName)}, ${createdAt})
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
              timestamp: createdAt.toISOString()
            }),
            signal: AbortSignal.timeout(8000)
          });
          return res.ok;
        } catch (sheetErr) {
          console.error("Error forwarding to Google Sheets:", sheetErr);
          return false;
        }
      })();

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
