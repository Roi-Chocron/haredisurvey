/**
 * קוד Google Apps Script משודרג עבור אמנת הנשים החרדיות
 * מתאים לגיליון: https://docs.google.com/spreadsheets/d/1pcD9QWdM6D04acwRcGfkoB_BcBe2nAyeIIE3Mej0vWA/edit
 *
 * שיפורים מרכזיים:
 * 1. כתיבת 5 עמודות מלאות ומסודרות:
 *    עמודה A: תאריך ושעה
 *    עמודה B: שם מלא
 *    עמודה C: אימייל
 *    עמודה D: הסתרת שם (true / false)
 *    עמודה E: סעיפים שנבחרו (פירוט מדויק של הפרקים והסעיפים שסומנו)
 * 2. יצירת כותרות בטוחה בשורה 1 (אם שורה 1 מכילה כבר חתימה, נוצרת שורת כותרת מעליה מבלי לדרוס מידע).
 * 3. מניעת כפילויות ועדכון שורה קיימת לפי אימייל: אם מישהי חותמת שוב עם סעיפים מעודכנים, השורה שלה מתעדכנת.
 * 4. תמיכה ב-Batch Sync מהיר ממסד הנתונים: עדכון וסנכרון של כל 172+ החתימות במכה אחת.
 * 5. ספירת כלל החתימות (כולל חתימות ידניות) והחזרת רשימת השמות הגלויים לחיפוש באתר.
 * 6. תיקון אוטומטי של שגיאות כתיב ידועות (למשל 'אביה רווי' -> 'אביה רווח').
 */

function getTargetSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // אם יש גיליון פעיל עם שורות נתונים נשתמש בו, אחרת נחפש גיליון1 או גיבוי_חתימות
  var active = ss.getActiveSheet();
  if (active && active.getLastRow() > 1) {
    return active;
  }
  return ss.getSheetByName("גיבוי_חתימות") || ss.getSheetByName("גיליון1") || active;
}

function ensureHeaders(sheet) {
  var lastRow = sheet.getLastRow();
  var expectedHeaders = ["תאריך ושעה", "שם מלא", "אימייל", "הסתרת שם", "סעיפים שנבחרו"];
  
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, 5).setValues([expectedHeaders]);
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
    return;
  }
  
  var firstCell = (sheet.getRange(1, 1).getValue() || "").toString().trim();
  var isHeader = (firstCell.indexOf("תאריך") !== -1 || firstCell.indexOf("Date") !== -1 || firstCell.indexOf("זמן") !== -1);
  
  if (!isHeader) {
    // שורה 1 מכילה חתימה אמיתית (נתונים). נוסיף שורת כותרות מעליה כדי לא לדרוס חתימה קיימת
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, 5).setValues([expectedHeaders]);
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
  } else {
    // שורה 1 היא כותרת - נוודא שעמודות D ו-E מוגדרות
    if (!sheet.getRange(1, 4).getValue().toString().trim()) {
      sheet.getRange(1, 4).setValue("הסתרת שם");
    }
    if (!sheet.getRange(1, 5).getValue().toString().trim()) {
      sheet.getRange(1, 5).setValue("סעיפים שנבחרו");
    }
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
  }
}

function doGet(e) {
  try {
    var sheet = getTargetSheet();
    var lastRow = sheet.getLastRow();
    
    if (lastRow < 2) {
      return ContentService.createTextOutput(JSON.stringify({ 
        total: 0, 
        recentNames: [], 
        allNames: [] 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var maxCols = Math.max(sheet.getLastColumn(), 5);
    var range = sheet.getRange(2, 1, lastRow - 1, maxCols);
    var values = range.getValues();
    
    var totalSignatures = 0;
    var publicNames = [];
    var seenEmails = {};
    
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var name = (row[1] || "").toString().trim();
      var email = (row[2] || "").toString().toLowerCase().trim();
      var hideName = row[3];
      
      // התעלמות משורות בדיקה
      if (email.indexOf("test") !== -1 || email.indexOf("example.com") !== -1) {
        continue;
      }
      
      if (name !== "") {
        if (name.indexOf("רווי") !== -1) name = "אביה רווח";
        
        if (!email || !seenEmails[email]) {
          totalSignatures++;
          if (email) seenEmails[email] = true;
          
          var isHidden = (hideName === true || hideName === "true" || hideName === "TRUE");
          if (!isHidden) {
            publicNames.push(name);
          }
        }
      }
    }
    
    var reversedPublic = publicNames.slice().reverse();
    var result = {
      total: totalSignatures,
      recentNames: reversedPublic.slice(0, 12),
      allNames: reversedPublic
    };
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ 
      error: err.toString(),
      total: 0,
      recentNames: [], 
      allNames: [] 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (lockErr) {}

  try {
    var sheet = getTargetSheet();
    ensureHeaders(sheet);

    var rawData = e.postData ? e.postData.contents : "{}";
    var data = {};
    
    try {
      data = JSON.parse(rawData);
    } catch (parseErr) {
      if (e.parameter) {
        data = e.parameter;
      }
    }

    // 1. תמיכה בסנכרון מהיר (Batch Sync) ממסד הנתונים
    if (data.action === "batch_sync" && Array.isArray(data.signatures)) {
      var batchRes = handleBatchSync(sheet, data.signatures);
      return ContentService.createTextOutput(JSON.stringify(batchRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. טיפול בחתימה בודדת
    var name = (data.name || "").toString().trim();
    var email = (data.email || "").toString().trim();
    var hideName = Boolean(data.hideName === true || data.hideName === "true" || data.hide_name === true || data.hide_name === "true");
    var timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    
    if (name === "אביה רוווי" || name.indexOf("רווי") !== -1) {
      name = "אביה רווח";
    }

    var selectedSections = (data.selectedSections || data.selected_sections || data.sections || "כל 100 הסעיפים (פרקים 1-11)").toString().trim();

    // בדיקת כפילות / עדכון שורה קיימת לפי אימייל:
    if (email) {
      var lastRowCheck = sheet.getLastRow();
      if (lastRowCheck > 1) {
        var emailColValues = sheet.getRange("C2:C" + lastRowCheck).getValues();
        var cleanEmail = email.toLowerCase().trim();
        for (var eIdx = 0; eIdx < emailColValues.length; eIdx++) {
          var existingEmail = (emailColValues[eIdx][0] || "").toString().toLowerCase().trim();
          if (existingEmail && existingEmail === cleanEmail) {
            var existingRow = eIdx + 2;
            sheet.getRange(existingRow, 2).setValue(name);
            sheet.getRange(existingRow, 4).setValue(hideName);
            sheet.getRange(existingRow, 5).setValue(selectedSections);
            return ContentService.createTextOutput(JSON.stringify({ 
              status: "updated_existing", 
              message: "חתימה קיימת עודכנה בהצלחה בגיליון",
              row: existingRow 
            })).setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
    }

    // חתימה חדשה - מציאת שורה ריקה ראשונה וכתיבה מלאה של 5 עמודות
    var targetRow = findFirstEmptyRow(sheet);
    sheet.getRange(targetRow, 1, 1, 5).setValues([[
      timestamp,
      name,
      email,
      hideName,
      selectedSections
    ]]);
    
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "success", 
      row: targetRow 
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "error", 
      message: error.toString() 
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    try {
      lock.releaseLock();
    } catch (lErr) {}
  }
}

/**
 * פונקציה לסנכרון מהיר (Batch Sync) של חתימות ממסד הנתונים ישירות לגיליון
 */
function handleBatchSync(sheet, signatures) {
  var lastRow = sheet.getLastRow();
  var emailRowMap = {};
  
  if (lastRow > 1) {
    var emailValues = sheet.getRange("C2:C" + lastRow).getValues();
    for (var i = 0; i < emailValues.length; i++) {
      var em = (emailValues[i][0] || "").toString().toLowerCase().trim();
      if (em) {
        emailRowMap[em] = i + 2;
      }
    }
  }

  var updatedCount = 0;
  var newRows = [];

  for (var j = 0; j < signatures.length; j++) {
    var sig = signatures[j];
    var email = (sig.email || "").toString().toLowerCase().trim();
    var name = (sig.name || "").toString().trim();
    if (name.indexOf("רווי") !== -1) name = "אביה רווח";
    var hideName = Boolean(sig.hide_name || sig.hideName);
    var sections = (sig.selected_sections || sig.selectedSections || sig.sections || "כל 100 הסעיפים (פרקים 1-11)").toString().trim();
    var time = sig.created_at ? new Date(sig.created_at) : (sig.timestamp ? new Date(sig.timestamp) : new Date());

    if (email && emailRowMap[email]) {
      var rowNum = emailRowMap[email];
      sheet.getRange(rowNum, 2).setValue(name);
      sheet.getRange(rowNum, 4).setValue(hideName);
      sheet.getRange(rowNum, 5).setValue(sections);
      updatedCount++;
    } else {
      newRows.push([time, name, sig.email, hideName, sections]);
      if (email) {
        emailRowMap[email] = lastRow + newRows.length;
      }
    }
  }

  if (newRows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, 5).setValues(newRows);
  }

  return {
    status: "success",
    updatedCount: updatedCount,
    addedCount: newRows.length,
    totalProcessed: signatures.length
  };
}

/**
 * מאתר את השורה הריקה הראשונה בעמודה B
 */
function findFirstEmptyRow(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return 1;
  
  var checkLimit = Math.max(lastRow + 20, 100);
  var colBValues = sheet.getRange("B1:B" + checkLimit).getValues();
  
  for (var i = 1; i < colBValues.length; i++) {
    var val = colBValues[i][0];
    if (val === null || val === undefined || val.toString().trim() === "") {
      return i + 1;
    }
  }
  
  return lastRow + 1;
}

/**
 * פונקציית שירות עצמאית ב-Apps Script למחיקת שורות בדיקה וכפילויות
 */
function cleanDuplicatesFromSheet() {
  var sheet = getTargetSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  
  var maxCols = Math.max(sheet.getLastColumn(), 5);
  var range = sheet.getRange(2, 1, lastRow - 1, maxCols);
  var values = range.getValues();
  var seenEmails = {};
  var rowsToDelete = [];
  
  for (var i = 0; i < values.length; i++) {
    var actualRowIndex = i + 2;
    var name = (values[i][1] || "").toString().trim();
    var email = (values[i][2] || "").toString().toLowerCase().trim();
    
    if (!email || email.indexOf("test") !== -1 || email.indexOf("example.com") !== -1 || name === "בדיקה") {
      rowsToDelete.push(actualRowIndex);
      continue;
    }
    
    if (seenEmails[email]) {
      rowsToDelete.push(actualRowIndex);
    } else {
      seenEmails[email] = true;
    }
  }
  
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    sheet.deleteRow(rowsToDelete[j]);
  }
  
  Logger.log("נמחקו " + rowsToDelete.length + " שורות כפולות/בדיקה בהצלחה.");
}
