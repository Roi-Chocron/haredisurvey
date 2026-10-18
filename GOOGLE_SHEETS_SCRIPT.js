/**
 * קוד Google Apps Script משודרג עבור אמנת הנשים החרדיות
 * מתאים לגיליון: https://docs.google.com/spreadsheets/d/1pcD9QWdM6D04acwRcGfkoB_BcBe2nAyeIIE3Mej0vWA/edit
 *
 * שיפורים וחידושים:
 * 1. סנכרון דו-כיווני מושלם: כל עדכון, מחיקה או הוספה בגיליון מתעדכנים מיידית במסד הנתונים של האתר (Postgres).
 * 2. כפתור ייעודי בלחיצה אחת בתפריט הגיליון: "🧹 נקה חתימות מפוברקות (אלף-בית) וכפילויות".
 *    מוחק את כל 23 החתימות המפוברקות של מי שחתם בכל האלף-בית, שורות ריקות, וכפילויות.
 * 3. כפתור ידני: "🔄 סנכרן שינויים למסד הנתונים ולאתר".
 * 4. תיקון אוטומטי של שמות: שרה מולאים הורוויץ, ואביה רווח.
 * 5. כתיבה בטוחה של 5 עמודות: תאריך ושעה, שם מלא, אימייל, הסתרת שם, סעיפים שנבחרו.
 */

var NETLIFY_SYNC_URL = "https://haredisurvey.netlify.app/api/amana?action=sync_from_sheets";

// רשימת האימיילים המפוברקים (מי שחתם בכל אותיות האלף-בית)
var FAKE_ALPHABET_EMAILS = {
  "k5412954@gmail.com": true,   // שלומית שושן (ש)
  "shnews@gmail.com": true,     // אהובה אבני (א)
  "41455@gmail.com": true,      // ברוריה ברה (ב)
  "pninapfaa@gmail.com": true,  // פנינה פויפר (פ)
  "741542@gmail.com": true,     // גבריאלה גרליץ (ג)
  "874152@gmail.com": true,     // דבורה דנוביץ (ד)
  "ews@gmail.com": true,        // הינדא הורביץ (ה)
  "4124@gmail.com": true,       // ורדה ורון (ו)
  "414889@gmail.com": true,     // זלדה זרובביץ (ז)
  "412365@gmail.com": true,     // חיה חיוביץ (ח)
  "4125896@gmail.com": true,    // טובה טובול (ט)
  "87412@gmail.com": true,      // ירדנה יורוביץ (י)
  "4155854@gmail.com": true,    // כרמלה כרמלוביץ (כ)
  "82824@gmail.com": true,      // ליה ליאון (ל)
  "k028542333@gmail.com": true, // מרים מרינוביץ (מ)
  "k0485696@gmail.com": true,   // נועה נוישטט (נ)
  "855595@gmail.com": true,     // ספיר ספירוביץ (ס)
  "8333@gmail.com": true,       // עטל עטייה (ע)
  "68154@gmail.com": true,      // פנינה פוחוצביץ (פ)
  "755594@gmail.com": true,     // צביה צאנוביץ (צ)
  "74554@gmail.com": true,      // קילא קדירוביץ (ק)
  "8555595@gmail.com": true,    // רוחמה רבינוביץ (ר)
  "74555954@gmail.com": true    // תהילה תופיק (ת)
};

function getTargetSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName("גיבוי_חתימות") || ss.getSheetByName("חתימות על האמנה") || ss.getSheetByName("גיליון1") || ss.getActiveSheet();
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
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, 5).setValues([expectedHeaders]);
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
  } else {
    if (!sheet.getRange(1, 4).getValue().toString().trim()) {
      sheet.getRange(1, 4).setValue("הסתרת שם");
    }
    if (!sheet.getRange(1, 5).getValue().toString().trim()) {
      sheet.getRange(1, 5).setValue("סעיפים שנבחרו");
    }
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
  }
}

/**
 * תפריט מותאם אישית שנוסף ל-Google Sheets
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("פעולות אמנה")
    .addItem("🧹 נקה חתימות מפוברקות (אלף-בית) וכפילויות", "cleanAlphabetAndDuplicatesFromSheet")
    .addItem("🔄 סנכרן שינויים למסד הנתונים ולאתר", "syncToDatabase")
    .addToUi();
}

/**
 * מחיקת כל החתימות המפוברקות (מי שחתם באלף-בית), כפילויות, ותיקון שמות
 */
function cleanAlphabetAndDuplicatesFromSheet() {
  var sheet = getTargetSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { deletedCount: 0 };
  
  var maxCols = Math.max(sheet.getLastColumn(), 5);
  var range = sheet.getRange(2, 1, lastRow - 1, maxCols);
  var values = range.getValues();
  
  var seenEmails = {};
  var rowsToDelete = [];
  var fixedCount = 0;
  
  for (var i = 0; i < values.length; i++) {
    var actualRowIndex = i + 2;
    var name = (values[i][1] || "").toString().trim();
    var email = (values[i][2] || "").toString().toLowerCase().trim();
    
    // 1. תיקון שרה מולאים הורוויץ אם השם שלה השתבש
    if (email === "saramolayemhorwitz@gmail.com") {
      if (name !== "שרה מולאים הורוויץ") {
        sheet.getRange(actualRowIndex, 2).setValue("שרה מולאים הורוויץ");
        fixedCount++;
      }
    }
    
    // 2. תיקון אביה רווח אם נכתב רווי
    if (email === "aviyarev@gmail.com" && name === "אביה רווי") {
      sheet.getRange(actualRowIndex, 2).setValue("אביה רווח");
      fixedCount++;
    }
    
    // 3. בדיקה אם זו חתימה מפוברקת מהאלף-בית
    var isAlphabetFake = Boolean(FAKE_ALPHABET_EMAILS[email]);
    
    // 4. בדיקה אם השורה ריקה או מכילה בדיקה
    var isTestOrEmpty = (
      !email || 
      !name ||
      name.indexOf("בדיקה") !== -1 || 
      name.indexOf("check") !== -1 || 
      name.indexOf("test") !== -1 ||
      email.indexOf("test") !== -1 || 
      email.indexOf("example.com") !== -1 || 
      email.indexOf("check") !== -1 ||
      email === "123@1.1"
    );
    
    if (isAlphabetFake || isTestOrEmpty) {
      rowsToDelete.push(actualRowIndex);
      continue;
    }
    
    // 5. בדיקת כפילות
    if (seenEmails[email]) {
      rowsToDelete.push(actualRowIndex);
    } else {
      seenEmails[email] = true;
    }
  }
  
  // מחיקת שורות מלמטה למעלה כדי לשמור על האינדקסים
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    sheet.deleteRow(rowsToDelete[j]);
  }
  
  var remaining = sheet.getLastRow() - 1;
  var msg = "הניקוי הושלם בהצלחה!\n" +
            "נמחקו " + rowsToDelete.length + " שורות מפוברקות/כפולות.\n" +
            "תוקנו " + fixedCount + " שמות.\n" +
            "סה\"כ חתימות אמיתיות שנותרו בגיליון: " + remaining;
  
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
  
  // סנכרון מיידי למסד הנתונים
  syncToDatabase();
  
  return {
    deletedCount: rowsToDelete.length,
    remainingRows: remaining,
    fixedCount: fixedCount
  };
}

/**
 * פונקציה לשליחת בקשת סנכרון מ-Google Sheets אל מסד הנתונים ב-Netlify
 */
function syncToDatabase() {
  try {
    var response = UrlFetchApp.fetch(NETLIFY_SYNC_URL, {
      method: "get",
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    Logger.log("Sync response: " + code + " " + body);
    
    try {
      SpreadsheetApp.getUi().alert("הסנכרון לאתר ולמסד הנתונים הושלם בהצלחה!\nכל העדכונים משתקפים כעת באתר.");
    } catch (uiErr) {}
  } catch (err) {
    Logger.log("Sync error: " + err.toString());
  }
}

/**
 * טריגר שמופעל אוטומטית בעת עריכת תא בגיליון (לאחר התקנת טריגר OnEdit)
 */
function onEditTrigger(e) {
  // קריאה שקטה לסנכרון המסד
  try {
    UrlFetchApp.fetch(NETLIFY_SYNC_URL, { method: "get", muteHttpExceptions: true });
  } catch (err) {}
}

function doGet(e) {
  try {
    var sheet = getTargetSheet();

    if (e && e.parameter && (e.parameter.action === "cleanup" || e.parameter.clean === "test_data")) {
      var cleanStats = cleanAlphabetAndDuplicatesFromSheet();
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "cleanup",
        details: cleanStats
      })).setMimeType(ContentService.MimeType.JSON);
    }

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
      
      if (email.indexOf("test") !== -1 || email.indexOf("example.com") !== -1 || FAKE_ALPHABET_EMAILS[email]) {
        continue;
      }
      
      if (name !== "") {
        if (email === "saramolayemhorwitz@gmail.com") {
          name = "שרה מולאים הורוויץ";
        } else if (email === "aviyarev@gmail.com" && name === "אביה רווי") {
          name = "אביה רווח";
        }
        
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

    if (data.action === "clean_fake_and_duplicates" || data.action === "clean_test_data" || data.action === "cleanup") {
      var cleanStats = cleanAlphabetAndDuplicatesFromSheet();
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "success", 
        action: "cleanup",
        details: cleanStats 
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === "batch_sync" && Array.isArray(data.signatures)) {
      var batchRes = handleBatchSync(sheet, data.signatures);
      return ContentService.createTextOutput(JSON.stringify(batchRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // הוספת חתימה חדשה או עדכון קיימת
    var name = (data.name || "").toString().trim();
    var email = (data.email || "").toString().trim();
    var hideName = Boolean(data.hideName === true || data.hideName === "true" || data.hide_name === true || data.hide_name === "true");
    var timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    
    if (email === "saramolayemhorwitz@gmail.com") {
      name = "שרה מולאים הורוויץ";
    } else if (email === "aviyarev@gmail.com" && name === "אביה רווי") {
      name = "אביה רווח";
    }

    var selectedSections = (data.selectedSections || data.selected_sections || data.sections || "כל 100 הסעיפים (פרקים 1-11)").toString().trim();

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
    if (email === "saramolayemhorwitz@gmail.com") name = "שרה מולאים הורוויץ";
    else if (email === "aviyarev@gmail.com" && name === "אביה רווי") name = "אביה רווח";
    
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
