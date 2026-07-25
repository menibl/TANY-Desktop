# מדריך שילוב לצד TANY (Phase 2) - חיבור אמיתי מול TANY DESKTOP

מסמך זה מיועד למי שמפתח את הצד השני - **TANY בענן** - ומתאר בדיוק מה כבר קיים ורץ אצל הלקוח היום ב-TANY DESKTOP, ומה נדרש לבנות בצד TANY כדי לדבר איתו. הכל כאן מבוסס על קוד שכבר קיים, רץ, ונבדק בפועל (לא הצעה תיאורטית) - ריפו: `menibl/TANY-Desktop`.

## 1. מה כבר קיים ורץ אצל הלקוח היום

TANY DESKTOP חושף שרת MCP סטנדרטי מקומי (Node.js, `@modelcontextprotocol/sdk`, Streamable HTTP) עם:

- שני tools: **`run_routine`** ו-**`submit_otp`**.
- endpoint בריאות: **`GET /health`** (ללא אימות).
- אימות בכותרת **`x-api-key`** על כל קריאת `/mcp` (health לא דורש את זה).
- מזהה מכשיר (`device_id`) ומפתח API (`api_key`) שנוצרים מקומית באתחול ראשון ונשמרים מוצפנים.

**⚠️ המגבלה הקריטית ביותר כרגע:** השרת מאזין רק על `127.0.0.1` (לוקאלי בלבד אצל הלקוח). **אין עדיין טאנל (frp) ואין קריאת רישום (pairing) בפועל מול TANY** - שני אלה מתוארים בסעיף 13 של מסמך האפיון אבל טרם מומשו בקוד. כלומר: TANY בענן עדיין לא יכול "לראות" את המכשיר של הלקוח דרך האינטרנט. כדי לבדוק אינטגרציה אמיתית היום צריך חיבור רשת ישיר (אותה רשת מקומית, VPN, או מנהרה זמנית לבדיקות בלבד) - זה לא פתרון הפצה, רק לצורך פיתוח/בדיקה של הפרוטוקול.

## 2. הפרוטוקול המדויק - נבדק בפועל מול השרת האמיתי

### 2.1 אימות
כל קריאה ל-`POST /mcp` חייבת לכלול כותרת:
```
x-api-key: <המפתח שנוצר מקומית אצל הלקוח>
```
קריאה בלי הכותרת, או עם מפתח שגוי, מקבלת **401**.

### 2.2 `run_routine`
```json
// POST /mcp
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "run_routine",
    "arguments": {
      "routine_id": "rtn_checking_balance",
      "requested_by": "whatsapp_user_id"
    }
  }
}
```

תשובה - הצלחה מיידית:
```json
{"result":{"content":[{"type":"text","text":"{\"status\":\"success\",\"result\":{\"balance\":\"4,320 ₪\"}}"}],"structuredContent":{"status":"success","result":{"balance":"4,320 ₪"}}},"jsonrpc":"2.0","id":1}
```

תשובה - נדרש OTP באמצע ההרצה:
```json
{"structuredContent":{"status":"awaiting_otp","continuation_token":"cont_82c4eef1...","prompt_hint":"קוד אימות מהבנק"}}
```

תשובה - כשל:
```json
{"structuredContent":{"status":"failed","failed_step":4,"reason":"element_not_found","message":"הפעולה נכשלה — נסה שוב או בדוק שגרה"}}
```

השדות בתוך `result` (בהצלחה) **דינמיים לפי השגרה** - הם השמות שהמשתמש נתן לשדות הפלט בזמן ההקלטה ב-GUI (למשל `balance`, `as_of` וכו').

### 2.3 `submit_otp`
```json
// POST /mcp
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "submit_otp",
    "arguments": {
      "continuation_token": "cont_82c4eef1...",
      "otp_code": "123456"
    }
  }
}
```
מחזירה תשובה מאותו סוג כמו `run_routine` (`success` / `awaiting_otp` נוסף אם יש עוד שלב / `failed`).

**חשוב:** אם `submit_otp` לא נשלח תוך כ-3 דקות מרגע קבלת `continuation_token`, הוא פג תוקף אוטומטית בצד TANY DESKTOP; קריאה מאוחרת מחזירה `{"status":"failed","reason":"otp_expired",...}`.

### 2.4 `GET /health`
```json
{"status":"ok","device_id":"dev_fc5e590e91ca0c06","device_name":"בדיקה"}
```
ללא אימות. מומלץ לזמן כל כמה דקות לכל מכשיר רשום כדי לעדכן `status`/`last_seen` בלי לחכות לבקשת הרצה בפועל (סעיף 22 באפיון).

### 2.5 timeout מומלץ
20 שניות לכל קריאת `tools/call` - שגרות אמורות לרוץ מהר; אם אין תשובה, להתייחס כאילו `status: failed, reason: timeout` (סעיף 21 באפיון).

## 3. מה נדרש לבנות בצד TANY (חלק ג' של מסמך האפיון, סעיפים 19-22)

### 3.1 טבלת Device Registry + endpoint רישום
נקודת קצה חדשה, למשל `POST /v1/devices/register`, שתקבל: `device_id`, `device_name`, `mcp_address` (הכתובת שדרכה TANY DESKTOP נגיש - עדיין לא קיימת בפועל, ראו סעיף 1 למעלה), `api_key`, ומזהה הלקוח (לפי אימות קיים מול הוואטסאפ). שומרת/מעדכנת רשומה בטבלת Device (לפי `device_id` - לא יוצרת כפולה אם הכתובת מתעדכנת).

### 3.2 קאש שגרות + endpoint סנכרון
`POST /v1/devices/{device_id}/routines/sync` - מקבלת רשימת שגרות + הניסוחים שמפעילים כל אחת:
```json
{
  "routines": [
    {
      "routine_id": "rtn_checking_balance",
      "name": "בדיקת מצב עו\"ש",
      "triggers": ["מה מצב העו\"ש", "מה מצב הבנק", "כמה כסף יש לי"]
    }
  ]
}
```
נשמר כטבלת cache אצל TANY (`routine_id`, `device_id`, `name`, `triggers[]`), כדי שהתאמת ניסוח חופשי ל-`routine_id` תתבצע **בלי** לקרוא ל-MCP בכל הודעה נכנסת - רק אחרי שנמצאה התאמה סבירה קוראים בפועל ל-`run_routine`.

### 3.3 MCP client גנרי
רכיב אחד ב-TANY שיודע: לפי `device_id`, לשלוף מה-Device Registry את `mcp_address` ו-`api_key`, ולבצע `tools/call` (עם הכותרת `x-api-key`) לפי הפרוטוקול בסעיף 2 למעלה - כולל טיפול ב-`awaiting_otp` (לשלוח למשתמש את `prompt_hint`, לחכות לתשובה, ולקרוא ל-`submit_otp` עם ה-`continuation_token`).

### 3.4 בדיקת זמינות
לזמן `GET /health` (סעיף 2.4) לכל מכשיר רשום כל כמה דקות, לעדכן `status: online/offline` + `last_seen`, כך שאם המכשיר לא זמין - TANY יכול להודיע למשתמש מיד בלי לחכות ל-timeout על `run_routine` (סעיף 16 באפיון: אין תור בקשות, מודיעים מיידית).

## 4. מה עדיין חסר גם בצד TANY DESKTOP (לא רק בצד TANY)

כדי שהזרימה המלאה תעבוד קצה-לקצה, גם הצד הזה (הריפו הזה) צריך עוד:

1. **הטמעת frpc** (tunnel) כדי שהשרת המקומי יהיה נגיש מהאינטרנט (סעיף 13.1 באפיון) - עדיין לא קיים בקוד.
2. **קריאה בפועל ל-`POST /v1/devices/register`** באתחול ראשון + בכל שינוי כתובת (סעיף 13.2) - `device_id`/`api_key` כבר נוצרים מקומית (`packages/shared/src/device.ts`), רק עדיין לא נשלחים לשום מקום.
3. **קריאה בפועל ל-`POST /v1/devices/{device_id}/routines/sync`** בכל יצירה/עדכון/מחיקה של שגרה.

**המלצה:** לפני שבונים את כל התשתית בצד TANY (סעיף 3), הכי יעיל להסכים קודם על כתובת ה-`frps` בתשתית ה-GCP (נקודה פתוחה במפורש בסעיף 13.1 של האפיון - "שרת נפרד מ-MAI FOCUS, לעדכן כאן את הכתובת המדויקת"), כי זה מה שקובע את ה-`mcp_address` שכל שאר הפרוטוקול (2.1-3.4) תלוי בו.
