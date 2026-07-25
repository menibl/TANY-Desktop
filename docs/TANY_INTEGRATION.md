# מדריך שילוב לצד TANY (Phase 2) - חיבור אמיתי מול TANY DESKTOP

מסמך זה מיועד למי שמפתח את הצד השני - **TANY בענן** - ומתאר בדיוק מה כבר קיים ורץ אצל הלקוח היום ב-TANY DESKTOP, ומה נדרש לבנות בצד TANY כדי לדבר איתו. הכל כאן מבוסס על קוד שכבר קיים, רץ, ונבדק בפועל (לא הצעה תיאורטית) - ריפו: `menibl/TANY-Desktop`.

## 1. מה כבר קיים ורץ אצל הלקוח היום

TANY DESKTOP חושף שרת MCP סטנדרטי מקומי (Node.js, `@modelcontextprotocol/sdk`, Streamable HTTP) עם:

- שני tools: **`run_routine`** ו-**`submit_otp`**.
- endpoint בריאות: **`GET /health`** (ללא אימות).
- אימות בכותרת **`x-api-key`** על כל קריאת `/mcp` (health לא דורש את זה).
- מזהה מכשיר (`device_id`) ומפתח API (`api_key`) שנוצרים מקומית באתחול ראשון ונשמרים מוצפנים.

**עדכון:** הטאנל (`packages/mcp-server/src/tunnel.ts`) ולקוח ה-pairing/sync (`pairing.ts`) **כן מומשו וכן נבדקו קצה-לקצה** - כולל הרצה אמיתית מול `frps`/`frpc` (קומפלנו מהמקור הרשמי, `fatedier/frp`) ומול endpoint רישום/סנכרון מדומה, עם וידוא שקריאת `tools/call` אמיתית עוברת דרך הטאנל בהצלחה.

**⚠️ מה עדיין חוסם חיבור בפועל - לא קוד, תשתית:**
1. **אין עדיין שרת `frps` אמיתי** בתשתית ה-GCP של TANY (הכתובת עדיין לא נקבעה - נקודה פתוחה מפורשת בסעיף 13.1 של האפיון).
2. **אין עדיין ה-endpoints עצמם** (`/v1/devices/register`, `/v1/devices/{id}/routines/sync`) בצד TANY - זה בדיוק מה שהמסמך הזה מתאר איך לבנות (סעיף 3 למטה).

ברגע שיש כתובת `frps` אמיתית ו-endpoint רישום אמיתי, TANY DESKTOP מתחיל להירשם ולסנכרן **בלי צורך בשינוי קוד נוסף** - רק הגדרת משתני סביבה (`TANY_DESKTOP_FRPS_ADDR`, `TANY_DESKTOP_FRPS_TOKEN`, `TANY_DESKTOP_FRP_REMOTE_PORT`, `TANY_CLOUD_REGISTER_URL` - ראו README).

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

### 2.6 ⚠️ TLS - עדיין לא מוצפן מקצה לקצה

`mcp_address` שיישלח ל-`register` יהיה כרגע **`http://`, לא `https://`** - בכוונה, כי זה מה שרץ בפועל היום (ה-tunnel מסוג `tcp` ב-frp מעביר בייטים גולמיים בלי הצפנה, ושרת ה-MCP מדבר HTTP רגיל). **אל תניחו TLS** ב-MCP client שתבנו עד שזה יתעדכן - סעיף 12.1 באפיון דורש הצפנה מקצה לקצה וזו נקודה שעדיין פתוחה משני הצדדים.

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

## 4. מה כבר מוכן בצד TANY DESKTOP (לא רק תיאורטי - נבדק)

בניגוד לגרסה קודמת של המסמך הזה - שלושת אלה **כבר מומשו ונבדקו קצה-לקצה** (מול `frps`/`frpc` אמיתיים ו-endpoint מדומה):

1. **frpc (tunnel)** - `packages/mcp-server/src/tunnel.ts` - מפעיל ומנהל תהליך frpc, בונה עבורו קונפיגורציית TOML, וזיהוי חיבור מוצלח לפי פלט הלוג.
2. **קריאה ל-`POST /v1/devices/register`** - `packages/mcp-server/src/pairing.ts` - רץ באתחול, ברגע שיש כתובת (מהטאנל או ישירה).
3. **קריאה ל-`POST /v1/devices/{device_id}/routines/sync`** - אותו קובץ - רץ באתחול ואז בכל שינוי שמזוהה (בדיקה מחזורית).

כל השלושה **כבויים כברירת מחדל** (לא עושים כלום, לא זורקים שגיאה) עד שמגדירים משתני סביבה - ראו README, סעיף "חיבור מרחוק".

**המלצה:** לפני שבונים את כל התשתית בצד TANY (סעיף 3 למעלה), הכי יעיל להסכים קודם על כתובת ה-`frps` בתשתית ה-GCP (נקודה פתוחה במפורש בסעיף 13.1 של האפיון - "שרת נפרד מ-MAI FOCUS, לעדכן כאן את הכתובת המדויקת"), כי זה מה שקובע את ה-`mcp_address` שכל שאר הפרוטוקול (2.1-3.4) תלוי בו. ברגע שיש כתובת - אפשר לבדוק אינטגרציה אמיתית מול קוד ה-TANY DESKTOP הקיים כבר היום.
