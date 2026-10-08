/**
 * קוד Google Apps Script עבור אמנת הנשים החרדיות
 * מתאים לגיליון: https://docs.google.com/spreadsheets/d/1pcD9QWdM6D04acwRcGfkoB_BcBe2nAyeIIE3Mej0vWA/edit
 *
 * שיפורים לפי דרישות הלקוחה:
 * 1. ספירת כלל החתימות (כולל חתימות ידניות שהוזנו ישירות בגיליון).
 * 2. מילוי חתימות דיגיטליות מהאתר בשורה הריקה הראשונה (גם אם היא אינה עוקבת לשורה האחרונה).
 * 3. החזרת רשימת כל השמות הגלויים לטובת תצוגת רשימה וחיפוש באתר.
 * 4. תיקון/נרמול אוטומטי של שגיאות כתיב כגון 'אביה רווי' -> 'אביה רווח'.
 */

function doGet(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var lastRow = sheet.getLastRow();
    
    if (lastRow < 2) {
      return ContentService.createTextOutput(JSON.stringify({ 
        total: 0, 
        recentNames: [], 
        allNames: [] 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // שליפת כל הנתונים משורה 2 ועד השורה האחרונה
    var maxCols = Math.max(sheet.getLastColumn(), 4);
    var range = sheet.getRange(2, 1, lastRow - 1, maxCols);
    var values = range.getValues();
    
    var totalSignatures = 0;
    var publicNames = [];
    
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var name = row[1]; // עמודה B היא שם החותמת
      var hideName = row[3]; // עמודה D היא סימון הסתרת שם (אנונימי)
      
      if (name && name.toString().trim() !== "") {
        totalSignatures++;
        var cleanName = name.toString().trim();
        
        // תיקון שגיאות כתיב ידועות (כגון אביה רווח)
        if (cleanName === "אביה רווי" || cleanName.indexOf("רווי") !== -1) {
          cleanName = "אביה רווח";
        }
        
        // אם לא סומן להסתיר שם (או שהתא ריק / false)
        var isHidden = (hideName === true || hideName === "true" || hideName === "TRUE");
        if (!isHidden) {
          publicNames.push(cleanName);
        }
      }
    }
    
    // מחזירים את סך כל החתימות ורשימת כל השמות
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
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var rawData = e.postData ? e.postData.contents : "{}";
    var data = {};
    
    try {
      data = JSON.parse(rawData);
    } catch (parseErr) {
      // אם נשלח כ-urlencoded
      if (e.parameter) {
        data = e.parameter;
      }
    }
    
    var name = (data.name || "").toString().trim();
    var email = (data.email || "").toString().trim();
    var hideName = Boolean(data.hideName);
    var timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    
    if (name === "אביה רווי" || name.indexOf("רווי") !== -1) {
      name = "אביה רווח";
    }
    
    // מציאת השורה הריקה הראשונה בעמודה B (שם מלא)
    var targetRow = findFirstEmptyRow(sheet);
    
    // כתיבת הנתונים ישירות לשורה הריקה הראשונה
    sheet.getRange(targetRow, 1, 1, 4).setValues([[
      timestamp,
      name,
      email,
      hideName
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
  }
}

/**
 * מאתר את השורה הריקה הראשונה בעמודה B.
 * אם יש חתימות ידניות בהמשך הגיליון עם רווחים,
 * הפונקציה תמלא את הרווח הראשון הריק שנוצר.
 */
function findFirstEmptyRow(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return 1;
  
  // בודקים את עמודה B (שם החותמת) עד השורה האחרונה + עוד 20 שורות רזרבה
  var checkLimit = Math.max(lastRow + 20, 100);
  var colBValues = sheet.getRange("B1:B" + checkLimit).getValues();
  
  for (var i = 1; i < colBValues.length; i++) { // שורה 1 היא שורת כותרת (אינדקס 0)
    var val = colBValues[i][0];
    if (val === null || val === undefined || val.toString().trim() === "") {
      return i + 1; // שורות בגיליון הן 1-indexed
    }
  }
  
  return lastRow + 1;
}
