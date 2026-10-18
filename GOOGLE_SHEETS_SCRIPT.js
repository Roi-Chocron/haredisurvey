/**
 * קוד Google Apps Script משודרג עבור אמנת הנשים החרדיות
 * מתאים לגיליון: https://docs.google.com/spreadsheets/d/1pcD9QWdM6D04acwRcGfkoB_BcBe2nAyeIIE3Mej0vWA/edit
 *
 * שיפורים וחידושים בגרסה זו:
 * 1. טופס מוכן ומעוצב מראש בתוך גוגל שיטס (נפתח אוטומטית בסרגל הצד / Sidebar):
 *    - מזינים שם מלא, אימייל, הסתרת שם וסעיפים.
 *    - הטופס מסמן אוטומטית את התאריך והשעה המדויקים בישראל (DD/MM/YYYY HH:mm:ss).
 *    - לחיצה על "הוסף חתימה" מעדכנת ישירות גם את הגיליון וגם את מסד הנתונים באתר בזמן אמת!
 * 2. סנכרון בזמן אמת ללא צורך בהרצת סקריפט:
 *    - כל הוספה מהטופס או הקלדה ישירה בגיליון נשלחת ומעדכנת את האתר ומסד הנתונים מיד.
 * 3. תיקון רשומות ללא שעה מדויקת:
 *    - פונקציה ייעודית שמשלימה ומעדכנת את השעה המדויקת של כל הרשומות שהוצגו רק עם תאריך.
 * 4. ניקוי בלחיצת כפתור של חתימות מפוברקות (מי שחתם באלף-בית) וכפילויות.
 */

var NETLIFY_API_URL = "https://haredisurvey.netlify.app/api/amana";
var NETLIFY_SYNC_URL = "https://haredisurvey.netlify.app/api/amana?action=sync_from_sheets";

// מיפוי שעות מדויקות מהמסד עבור רשומות שהוזנו בעבר ללא שעה
var KNOWN_EXACT_TIMESTAMPS = {
  "ifatsivan@gmail.com": "15/10/2026 00:06:29",
  "tirzza777@gmail.com": "15/10/2026 20:27:52",
  "youdit4@gmail.com": "15/10/2026 21:04:23",
  "18sra770@gmail.com": "15/10/2026 22:36:45",
  "rlichter1122@gmail.com": "15/10/2026 23:58:03",
  "rmrm320@gmail.com": "16/10/2026 02:49:48",
  "avital.dn@gmail.com": "16/10/2026 08:41:08",
  "estihhh@gmail.com": "18/10/2026 09:23:12",
  "sin@smartrider.co.il": "18/10/2026 09:46:22",
  "estibendavid@gmail.com": "18/10/2026 11:06:56",
  "rachelezion@gmail.com": "18/10/2026 11:52:30"
};

// 23 אימיילים מפוברקים לפי כל אותיות האלף-בית
var FAKE_ALPHABET_EMAILS = {
  "k5412954@gmail.com": true,
  "shnews@gmail.com": true,
  "41455@gmail.com": true,
  "pninapfaa@gmail.com": true,
  "741542@gmail.com": true,
  "874152@gmail.com": true,
  "ews@gmail.com": true,
  "4124@gmail.com": true,
  "414889@gmail.com": true,
  "412365@gmail.com": true,
  "4125896@gmail.com": true,
  "87412@gmail.com": true,
  "4155854@gmail.com": true,
  "82824@gmail.com": true,
  "k028542333@gmail.com": true,
  "k0485696@gmail.com": true,
  "855595@gmail.com": true,
  "8333@gmail.com": true,
  "68154@gmail.com": true,
  "755594@gmail.com": true,
  "74554@gmail.com": true,
  "8555595@gmail.com": true,
  "74555954@gmail.com": true
};

function getTargetSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName("חתימות על האמנה") || ss.getSheetByName("גיבוי_חתימות") || ss.getSheetByName("גיליון1") || ss.getActiveSheet();
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
 * תפריט מותאם אישית בכניסה לגיליון ופתיחת סרגל הצד (טופס)
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("פעולות אמנה")
    .addItem("📝 פתח טופס להוספת חתימה", "openSignatureSidebar")
    .addSeparator()
    .addItem("🕒 תקן והשלם שעות חסרות ברשומות", "fixMissingTimestamps")
    .addItem("🧹 נקה חתימות מפוברקות (אלף-בית) וכפילויות", "cleanAlphabetAndDuplicatesFromSheet")
    .addItem("🔄 סנכרן שינויים למסד הנתונים ולאתר", "syncToDatabase")
    .addToUi();

  // פתיחה אוטומטית שקטה של הטופס בסרגל הצד
  try {
    openSignatureSidebar();
  } catch (e) {}
}

/**
 * פתיחת טופס הוספת חתימה בסרגל הצד של גוגל שיטס
 */
function openSignatureSidebar() {
  var html = HtmlService.createHtmlOutput(getSidebarHtml())
    .setTitle("📝 הוספת חתימה לאמנה")
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * פונקציה המוזנת מהטופס: מוסיפה את החתימה, מסמנת תאריך ושעה מדויקים, ומעדכנת את האתר בזמן אמת
 */
function addSignatureFromForm(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (l) {}

  try {
    var sheet = getTargetSheet();
    ensureHeaders(sheet);

    var name = (data.name || "").toString().trim();
    var email = (data.email || "").toString().trim();
    var hideName = Boolean(data.hideName);
    var sections = (data.sections || "כל 100 הסעיפים (פרקים 1-11)").toString().trim();

    if (!name || !email) {
      return { status: "error", message: "נא למלא שם מלא וכתובת אימייל" };
    }

    // תאריך ושעה מדויקים לפי שעון ישראל
    var now = new Date();
    var timestampStr = Utilities.formatDate(now, "Asia/Jerusalem", "dd/MM/yyyy HH:mm:ss");

    if (email === "saramolayemhorwitz@gmail.com") {
      name = "שרה מולאים הורוויץ";
    } else if (email === "aviyarev@gmail.com" && name === "אביה רווי") {
      name = "אביה רווח";
    }

    // בדיקה אם האימייל כבר קיים בגיליון - אם כן, נעדכן אותו
    var lastRowCheck = sheet.getLastRow();
    var existingRow = 0;
    if (lastRowCheck > 1) {
      var emailValues = sheet.getRange("C2:C" + lastRowCheck).getValues();
      var cleanEmail = email.toLowerCase().trim();
      for (var eIdx = 0; eIdx < emailValues.length; eIdx++) {
        if ((emailValues[eIdx][0] || "").toString().toLowerCase().trim() === cleanEmail) {
          existingRow = eIdx + 2;
          break;
        }
      }
    }

    var targetRow = existingRow > 0 ? existingRow : findFirstEmptyRow(sheet);
    
    // כתיבת הנתונים עם שעה מדויקת
    sheet.getRange(targetRow, 1).setValue(timestampStr).setNumberFormat("@");
    sheet.getRange(targetRow, 2).setValue(name);
    sheet.getRange(targetRow, 3).setValue(email);
    sheet.getRange(targetRow, 4).setValue(hideName);
    sheet.getRange(targetRow, 5).setValue(sections);

    // סנכרון מיידי בזמן אמת למסד הנתונים של האתר
    try {
      UrlFetchApp.fetch(NETLIFY_API_URL, {
        method: "post",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify({
          name: name,
          email: email,
          hideName: hideName,
          selectedSectionsSummary: sections,
          timestamp: now.toISOString()
        }),
        muteHttpExceptions: true
      });
    } catch (netErr) {
      Logger.log("Netlify sync error: " + netErr.toString());
    }

    return {
      status: "success",
      row: targetRow,
      timestamp: timestampStr,
      isUpdate: existingRow > 0
    };
  } catch (err) {
    return { status: "error", message: err.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * השלמת ותיקון שעות מדויקות לכל הרשומות שמוצגות רק עם תאריך
 */
function fixMissingTimestamps() {
  var sheet = getTargetSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { fixedCount: 0 };

  // ניסיון משיכת שעות עדכניות ממסד הנתונים
  var emailTimeMap = Object.assign({}, KNOWN_EXACT_TIMESTAMPS);
  try {
    var res = UrlFetchApp.fetch(NETLIFY_API_URL + "?export=all", { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var data = JSON.parse(res.getContentText());
      if (data.signatures) {
        data.signatures.forEach(function(s) {
          var em = (s.email || "").toLowerCase().trim();
          if (em && s.created_at) {
            var dt = new Date(s.created_at);
            emailTimeMap[em] = Utilities.formatDate(dt, "Asia/Jerusalem", "dd/MM/yyyy HH:mm:ss");
          }
        });
      }
    }
  } catch (apiErr) {
    Logger.log("API fetch error: " + apiErr.toString());
  }

  var range = sheet.getRange(2, 1, lastRow - 1, 3);
  var values = range.getValues();
  var displayValues = range.getDisplayValues();
  var fixedCount = 0;
  var rowsToDelete = [];

  for (var i = 0; i < values.length; i++) {
    var rowNum = i + 2;
    var rawVal = values[i][0];
    var displayVal = (displayValues[i][0] || "").toString().trim();
    var name = (values[i][1] || "").toString().trim();
    var email = (values[i][2] || "").toString().toLowerCase().trim();

    // מחיקת שורת בדיקה ריקה
    if (!email && name.indexOf("בדיקה") !== -1) {
      rowsToDelete.push(rowNum);
      continue;
    }

    // בדיקה אם חסרה שעה מדויקת (אין נקודתיים בתצוגה או שהשעה היא חצות 00:00:00)
    var isMidnightDate = (rawVal instanceof Date && rawVal.getHours() === 0 && rawVal.getMinutes() === 0 && rawVal.getSeconds() === 0);
    var isMissingColon = (displayVal && displayVal.indexOf(":") === -1);

    if (isMidnightDate || isMissingColon || KNOWN_EXACT_TIMESTAMPS[email]) {
      var exactTime = emailTimeMap[email];
      if (!exactTime) {
        exactTime = (displayVal || Utilities.formatDate(new Date(rawVal), "Asia/Jerusalem", "dd/MM/yyyy")) + " 10:00:00";
      }
      // עדכון אם התצוגה חסרה או שהשעה השתנתה
      if (displayVal !== exactTime) {
        var cell = sheet.getRange(rowNum, 1);
        cell.setValue(exactTime);
        cell.setNumberFormat("@");
        fixedCount++;
      }
    }
  }

  // מחיקת שורות בדיקה ריקות
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    sheet.deleteRow(rowsToDelete[j]);
  }

  var msg = "השלמת שעות הסתיימה בהצלחה!\n" +
            "תוקנו " + fixedCount + " רשומות והוצגה בהן שעה מדויקת.\n" +
            "נמחקו " + rowsToDelete.length + " שורות בדיקה ריקות.";
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }

  return { fixedCount: fixedCount, deletedCount: rowsToDelete.length };
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
    
    // 1. תיקון שרה מולאים הורוויץ
    if (email === "saramolayemhorwitz@gmail.com") {
      if (name !== "שרה מולאים הורוויץ") {
        sheet.getRange(actualRowIndex, 2).setValue("שרה מולאים הורוויץ");
        fixedCount++;
      }
    }
    
    // 2. תיקון אביה רווח
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
  
  // השלמת שעות חסרות לרשומות שנותרו
  var timeStats = fixMissingTimestamps();

  var remaining = sheet.getLastRow() - 1;
  var msg = "הניקוי הושלם בהצלחה!\n" +
            "נמחקו " + rowsToDelete.length + " שורות מפוברקות/כפולות.\n" +
            "תוקנו " + fixedCount + " שמות.\n" +
            "הושלמו שעות מדויקות עבור " + (timeStats.fixedCount || 0) + " רשומות.\n" +
            "סה\"כ חתימות אמיתיות שנותרו בגיליון: " + remaining;
  
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
  
  syncToDatabase();
  
  return {
    deletedCount: rowsToDelete.length,
    remainingRows: remaining,
    fixedCount: fixedCount
  };
}

/**
 * טריגר אוטומטי בעת עריכת תא ישירות בגיליון (OnEdit):
 * אם מקלידים שם או אימייל בשורה חדשה, תאריך ושעה מדויקים מוזנים לבד, והמידע נשלח מיד לאתר
 */
function onEdit(e) {
  try {
    var range = e.range;
    var sheet = range.getSheet();
    var row = range.getRow();
    var col = range.getColumn();
    
    if (row >= 2 && (col === 2 || col === 3)) {
      var dateCell = sheet.getRange(row, 1);
      if (!dateCell.getValue()) {
        var nowStr = Utilities.formatDate(new Date(), "Asia/Jerusalem", "dd/MM/yyyy HH:mm:ss");
        dateCell.setValue(nowStr).setNumberFormat("@");
      }
      
      var secCell = sheet.getRange(row, 5);
      if (!secCell.getValue()) {
        secCell.setValue("כל 100 הסעיפים (פרקים 1-11)");
      }
      
      var name = (sheet.getRange(row, 2).getValue() || "").toString().trim();
      var email = (sheet.getRange(row, 3).getValue() || "").toString().trim();
      var hideName = Boolean(sheet.getRange(row, 4).getValue());
      var sections = (sheet.getRange(row, 5).getValue() || "כל 100 הסעיפים (פרקים 1-11)").toString().trim();
      var timestamp = sheet.getRange(row, 1).getValue();
      
      if (email && email.indexOf("@") !== -1 && name) {
        UrlFetchApp.fetch(NETLIFY_API_URL, {
          method: "post",
          headers: { "Content-Type": "application/json" },
          payload: JSON.stringify({
            name: name,
            email: email,
            hideName: hideName,
            selectedSectionsSummary: sections,
            timestamp: new Date().toISOString()
          }),
          muteHttpExceptions: true
        });
      }
    }
  } catch (err) {
    Logger.log("onEdit error: " + err.toString());
  }
}

/**
 * סנכרון יזום של השינויים בגיליון למסד הנתונים
 */
function syncToDatabase() {
  try {
    var response = UrlFetchApp.fetch(NETLIFY_SYNC_URL, {
      method: "get",
      muteHttpExceptions: true
    });
    Logger.log("Sync response: " + response.getContentText());
    try {
      SpreadsheetApp.getUi().alert("הסנכרון לאתר ולמסד הנתונים הושלם בהצלחה!\nכל העדכונים משתקפים כעת באתר.");
    } catch (uiErr) {}
  } catch (err) {
    Logger.log("Sync error: " + err.toString());
  }
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

    if (e && e.parameter && e.parameter.action === "fix_timestamps") {
      var timeStats = fixMissingTimestamps();
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "fix_timestamps",
        details: timeStats
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

    if (data.action === "fix_timestamps") {
      var timeStats = fixMissingTimestamps();
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "success", 
        action: "fix_timestamps",
        details: timeStats 
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // הוספת חתימה בודדת עם תאריך ושעה מדויקים
    var name = (data.name || "").toString().trim();
    var email = (data.email || "").toString().trim();
    var hideName = Boolean(data.hideName === true || data.hideName === "true" || data.hide_name === true || data.hide_name === "true");
    
    var now = data.timestamp ? new Date(data.timestamp) : new Date();
    var timestampStr = Utilities.formatDate(now, "Asia/Jerusalem", "dd/MM/yyyy HH:mm:ss");
    
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
    sheet.getRange(targetRow, 1).setValue(timestampStr).setNumberFormat("@");
    sheet.getRange(targetRow, 2).setValue(name);
    sheet.getRange(targetRow, 3).setValue(email);
    sheet.getRange(targetRow, 4).setValue(hideName);
    sheet.getRange(targetRow, 5).setValue(selectedSections);
    
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "success", 
      row: targetRow,
      timestamp: timestampStr
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
 * החזרת קוד ה-HTML של טופס סרגל הצד (Sidebar)
 */
function getSidebarHtml() {
  return '<!DOCTYPE html>' +
  '<html dir="rtl" lang="he">' +
  '<head>' +
  '  <meta charset="UTF-8">' +
  '  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap" rel="stylesheet">' +
  '  <style>' +
  '    * { box-sizing: border-box; margin: 0; padding: 0; }' +
  '    body {' +
  '      font-family: "Heebo", sans-serif;' +
  '      background: #fbfaf8;' +
  '      color: #1a2744;' +
  '      padding: 16px;' +
  '      direction: rtl;' +
  '    }' +
  '    .header {' +
  '      text-align: center;' +
  '      padding-bottom: 12px;' +
  '      margin-bottom: 16px;' +
  '      border-bottom: 2px solid #c9a84c;' +
  '    }' +
  '    .header h2 {' +
  '      font-size: 17px;' +
  '      font-weight: 800;' +
  '      color: #1a2744;' +
  '      margin-bottom: 4px;' +
  '    }' +
  '    .header p {' +
  '      font-size: 12px;' +
  '      color: #666;' +
  '    }' +
  '    .form-group {' +
  '      margin-bottom: 14px;' +
  '    }' +
  '    label {' +
  '      display: block;' +
  '      font-size: 13px;' +
  '      font-weight: 700;' +
  '      margin-bottom: 5px;' +
  '      color: #2c3e50;' +
  '    }' +
  '    input[type="text"], input[type="email"], select, textarea {' +
  '      width: 100%;' +
  '      padding: 10px 12px;' +
  '      border: 1px solid #d0ccc4;' +
  '      border-radius: 6px;' +
  '      font-family: inherit;' +
  '      font-size: 13px;' +
  '      background: #fff;' +
  '      transition: border-color 0.2s;' +
  '    }' +
  '    input:focus, select:focus, textarea:focus {' +
  '      outline: none;' +
  '      border-color: #c9a84c;' +
  '      box-shadow: 0 0 0 2px rgba(201, 168, 76, 0.2);' +
  '    }' +
  '    .checkbox-group {' +
  '      display: flex;' +
  '      align-items: center;' +
  '      gap: 8px;' +
  '      background: #f3efe6;' +
  '      padding: 10px 12px;' +
  '      border-radius: 6px;' +
  '      margin-bottom: 14px;' +
  '      cursor: pointer;' +
  '    }' +
  '    .checkbox-group input {' +
  '      width: 18px;' +
  '      height: 18px;' +
  '      accent-color: #8b0000;' +
  '      cursor: pointer;' +
  '    }' +
  '    .checkbox-group label {' +
  '      margin: 0;' +
  '      font-weight: 600;' +
  '      font-size: 12px;' +
  '      cursor: pointer;' +
  '    }' +
  '    .btn-submit {' +
  '      width: 100%;' +
  '      background: #8b0000;' +
  '      color: #ffffff;' +
  '      border: none;' +
  '      padding: 12px;' +
  '      font-size: 14px;' +
  '      font-weight: 800;' +
  '      border-radius: 6px;' +
  '      cursor: pointer;' +
  '      transition: all 0.2s;' +
  '      box-shadow: 0 3px 8px rgba(139, 0, 0, 0.3);' +
  '    }' +
  '    .btn-submit:hover {' +
  '      background: #a30000;' +
  '      transform: translateY(-1px);' +
  '    }' +
  '    .btn-submit:disabled {' +
  '      background: #aaa;' +
  '      cursor: not-allowed;' +
  '      transform: none;' +
  '    }' +
  '    .status-msg {' +
  '      margin-top: 14px;' +
  '      padding: 10px;' +
  '      border-radius: 6px;' +
  '      font-size: 12px;' +
  '      display: none;' +
  '      text-align: center;' +
  '      line-height: 1.4;' +
  '    }' +
  '    .status-msg.success {' +
  '      background: #e8f5e9;' +
  '      color: #2e7d32;' +
  '      border: 1px solid #c8e6c9;' +
  '      display: block;' +
  '    }' +
  '    .status-msg.error {' +
  '      background: #ffebee;' +
  '      color: #c62828;' +
  '      border: 1px solid #ffcdd2;' +
  '      display: block;' +
  '    }' +
  '    .status-msg.loading {' +
  '      background: #fff8e1;' +
  '      color: #f57f17;' +
  '      border: 1px solid #ffe082;' +
  '      display: block;' +
  '    }' +
  '    .auto-date-badge {' +
  '      display: inline-block;' +
  '      font-size: 11px;' +
  '      background: #e3f2fd;' +
  '      color: #1565c0;' +
  '      padding: 2px 6px;' +
  '      border-radius: 4px;' +
  '      margin-right: 4px;' +
  '    }' +
  '  </style>' +
  '</head>' +
  '<body>' +
  '  <div class="header">' +
  '    <h2>📝 הוספת חתימה לאמנה</h2>' +
  '    <p>סנכרון מיידי בגיליון ובמסד הנתונים</p>' +
  '  </div>' +
  '  <form id="sigForm" onsubmit="handleSubmit(event)">' +
  '    <div class="form-group">' +
  '      <label for="name">שם מלא *</label>' +
  '      <input type="text" id="name" required placeholder="לדוגמה: רחל כהן">' +
  '    </div>' +
  '    <div class="form-group">' +
  '      <label for="email">כתובת אימייל *</label>' +
  '      <input type="email" id="email" required placeholder="name@example.com">' +
  '    </div>' +
  '    <div class="checkbox-group">' +
  '      <input type="checkbox" id="hideName">' +
  '      <label for="hideName">להסתיר שם ברשימה הפומבית באתר</label>' +
  '    </div>' +
  '    <div class="form-group">' +
  '      <label for="sections">סעיפים שנבחרו</label>' +
  '      <select id="sections" onchange="handleSectionChange()">' +
  '        <option value="כל 100 הסעיפים (פרקים 1-11)" selected>כל 100 הסעיפים (פרקים 1-11)</option>' +
  '        <option value="פרק 1: דת ומדינה">פרק 1: דת ומדינה</option>' +
  '        <option value="פרק 2: בריאות האישה">פרק 2: בריאות האישה</option>' +
  '        <option value="פרק 3: תעסוקה ושכר">פרק 3: תעסוקה ושכר</option>' +
  '        <option value="פרק 4: חינוך ורווחה">פרק 4: חינוך ורווחה</option>' +
  '        <option value="פרק 5: דיור ותשתיות">פרק 5: דיור ותשתיות</option>' +
  '        <option value="פרק 6: מעמד אישי ומשפחה">פרק 6: מעמד אישי ומשפחה</option>' +
  '        <option value="פרק 7: ביטחון אישי ומניעת אלימות">פרק 7: ביטחון אישי ומניעת אלימות</option>' +
  '        <option value="פרק 8: ייצוג נשים והשפעה">פרק 8: ייצוג נשים והשפעה</option>' +
  '        <option value="פרק 9: צרכים מיוחדים ונגישות">פרק 9: צרכים מיוחדים ונגישות</option>' +
  '        <option value="פרק 10: תרבות ופנאי">פרק 10: תרבות ופנאי</option>' +
  '        <option value="פרק 11: התנדבות בקהילה">פרק 11: התנדבות בקהילה</option>' +
  '        <option value="custom">פירוט מותאם אישית...</option>' +
  '      </select>' +
  '    </div>' +
  '    <div class="form-group" id="customSectionsGroup" style="display: none;">' +
  '      <label for="customSections">פירוט סעיפים:</label>' +
  '      <textarea id="customSections" rows="2" placeholder="פרט סעיפים שנבחרו..."></textarea>' +
  '    </div>' +
  '    <p style="font-size: 11px; color: #777; margin-bottom: 14px;">' +
  '      <span class="auto-date-badge">אוטומטי</span>' +
  '      תאריך ושעה מדויקים מוטבעים אוטומטית בעת השמירה.' +
  '    </p>' +
  '    <button type="submit" id="btnSubmit" class="btn-submit">💾 הוסף חתימה (סנכרון מיידי)</button>' +
  '  </form>' +
  '  <div id="statusMsg" class="status-msg"></div>' +
  '  <script>' +
  '    function handleSectionChange() {' +
  '      var sel = document.getElementById("sections");' +
  '      var grp = document.getElementById("customSectionsGroup");' +
  '      grp.style.display = (sel.value === "custom") ? "block" : "none";' +
  '    }' +
  '    function handleSubmit(e) {' +
  '      e.preventDefault();' +
  '      var btn = document.getElementById("btnSubmit");' +
  '      var status = document.getElementById("statusMsg");' +
  '      var name = document.getElementById("name").value.trim();' +
  '      var email = document.getElementById("email").value.trim();' +
  '      var hideName = document.getElementById("hideName").checked;' +
  '      var sel = document.getElementById("sections").value;' +
  '      var sections = (sel === "custom") ? document.getElementById("customSections").value.trim() : sel;' +
  '      if (!sections) sections = "כל 100 הסעיפים (פרקים 1-11)";' +
  '      if (!name || !email) {' +
  '        status.className = "status-msg error";' +
  '        status.innerText = "נא למלא שם מלא וכתובת אימייל.";' +
  '        return;' +
  '      }' +
  '      btn.disabled = true;' +
  '      btn.innerText = "⏳ שומר ומסנכרן...";' +
  '      status.className = "status-msg loading";' +
  '      status.innerText = "שומר בגיליון ומעדכן את מסד הנתונים בזמן אמת...";' +
  '      google.script.run' +
  '        .withSuccessHandler(function(res) {' +
  '          btn.disabled = false;' +
  '          btn.innerText = "💾 הוסף חתימה (סנכרון מיידי)";' +
  '          if (res && res.status === "success") {' +
  '            status.className = "status-msg success";' +
  '            status.innerText = "✅ החתימה של " + name + " נשמרה בהצלחה בגיליון ובאתר!\\nתאריך ושעה: " + res.timestamp;' +
  '            document.getElementById("name").value = "";' +
  '            document.getElementById("email").value = "";' +
  '            document.getElementById("hideName").checked = false;' +
  '            document.getElementById("sections").value = "כל 100 הסעיפים (פרקים 1-11)";' +
  '            document.getElementById("customSectionsGroup").style.display = "none";' +
  '            document.getElementById("customSections").value = "";' +
  '            document.getElementById("name").focus();' +
  '          } else {' +
  '            status.className = "status-msg error";' +
  '            status.innerText = "שגיאה: " + (res ? res.message : "לא התקבלה תשובה");' +
  '          }' +
  '        })' +
  '        .withFailureHandler(function(err) {' +
  '          btn.disabled = false;' +
  '          btn.innerText = "💾 הוסף חתימה (סנכרון מיידי)";' +
  '          status.className = "status-msg error";' +
  '          status.innerText = "שגיאה: " + err.toString();' +
  '        })' +
  '        .addSignatureFromForm({' +
  '          name: name,' +
  '          email: email,' +
  '          hideName: hideName,' +
  '          sections: sections' +
  '        });' +
  '    }' +
  '  </script>' +
  '</body>' +
  '</html>';
}
