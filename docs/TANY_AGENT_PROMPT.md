# פרומפט לסוכן - שילוב TANY מול TANY DESKTOP

מסמך זה הוא פרומפט מוכן להדבקה לסוכן AI (Claude Code או דומה) שעובד על ריפו TANY (לא על `menibl/TANY-Desktop`). הוא עצמאי - כולל את כל ההקשר הנדרש בלי תלות בקריאת מסמכים חיצוניים.

---

## הפרומפט (להעתיק מכאן ומטה)

אתה עובד על שילוב TANY מול "TANY DESKTOP" - רכיב נפרד שכבר קיים, בנוי, ונבדק, שרץ אצל כל לקוח על המחשב האישי שלו (ריפו נפרד: `menibl/TANY-Desktop`, לא חלק מהמשימה שלך - אתה לא נוגע בו ולא בונה אותו, רק משתלב איתו). המשימה שלך: לבנות את הצד של TANY (השירות שמדבר עם משתמשים בוואטסאפ) כדי שיוכל לגלות אילו שגרות קיימות אצל כל לקוח, לזהות כוונה מהודעה חופשית, ולהפעיל שגרה אצל TANY DESKTOP של הלקוח דרך MCP.

### מה כבר קיים ורץ אצל הלקוח (לידיעה, לא לבנייה)

TANY DESKTOP חושף שרת MCP סטנדרטי (Node.js, Streamable HTTP) עם שני tools - `run_routine` ו-`submit_otp` - ו-endpoint בריאות `GET /health`. הוא גם כולל כבר (מומש ונבדק, אבל **כבוי כברירת מחדל** עד שהצד שלך קיים): טאנל מוטמע (frpc) שיכול לחשוף אותו לאינטרנט, וקליינט שישלח `POST /v1/devices/register` ו-`POST /v1/devices/{device_id}/routines/sync` **ברגע שיהיו לו endpoints אמיתיים לשלוח אליהם**. זה בדיוק מה שאתה בונה.

### המשימה שלך - 5 חלקים

**1. טבלת Device Registry + endpoint רישום**

הוסף טבלה (או הרחב טבלת לקוחות קיימת) עם השדות: `device_id` (מזהה ייחודי, מגיע מהלקוח), `customer_id`/`whatsapp_user_id` (הבעלים, לפי אימות קיים אצלכם), `device_name` (שם שהמשתמש בחר, למשל "המחשב שלי"), `mcp_address` (כתובת ה-MCP הנוכחית של המכשיר), `api_key` (לאימות כל קריאה למכשיר הזה), `status` (`online`/`offline`), `last_seen`.

הוסף נקודת קצה `POST /v1/devices/register` שמקבלת:
```json
{
  "device_id": "dev_c9a4154609986cb8",
  "device_name": "המחשב שלי",
  "mcp_address": "http://<host>:<port>",
  "api_key": "<hex string ארוך>"
}
```
מזהה הלקוח מגיע מהאימות הקיים אצלכם מול הבקשה (לא שדה בגוף עצמו). לוגיקה: **upsert** לפי `device_id` - אם קיים, מעדכן את `mcp_address` בלבד; אם לא קיים, יוצר רשומה חדשה.

**⚠️ חשוב:** `mcp_address` יגיע כרגע כ-`http://`, **לא** `https://` - זה נכון ומכוון, לא באג. אין עדיין TLS מקצה לקצה בין הצדדים (נקודה פתוחה). אל תניחו TLS בקליינט שתבנו בחלק 3.

**2. קאש שגרות + endpoint סנכרון**

הוסף טבלת cache (`routine_id`, `device_id`, `name`, `triggers[]`) ונקודת קצה `POST /v1/devices/{device_id}/routines/sync` שמקבלת:
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
זה **מחליף** את כל רשימת השגרות של המכשיר הזה (לא append) - כל קריאה מכילה את המצב המלא העדכני.

**שימוש בקאש:** כשמגיעה הודעה חופשית מהמשתמש בוואטסאפ, מבצעים התאמה סמנטית מול ה-`triggers` של המכשירים ששייכים לאותו לקוח - **בלי לקרוא ל-MCP בכלל** בשלב הזה. רק אחרי שנמצאה התאמה סבירה, קוראים בפועל ל-`run_routine` (חלק 3) עם ה-`routine_id` שנמצא. אם לא נמצאה התאמה סבירה - לא קוראים ל-MCP, ומגיבים למשתמש בהתאם (למשל מבקשים הבהרה).

**3. MCP client גנרי**

רכיב אחד שיודע: לפי `device_id`, לשלוף מה-Device Registry את `mcp_address` ו-`api_key`, ולבצע קריאת MCP סטנדרטית (JSON-RPC 2.0, `method: "tools/call"`) ל-`POST {mcp_address}/mcp` עם כותרת `x-api-key: {api_key}`.

דוגמת בקשה (נבדקה בפועל מול השרת האמיתי):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "run_routine",
    "arguments": { "routine_id": "rtn_checking_balance", "requested_by": "whatsapp_user_id" }
  }
}
```

תשובה אפשרית א' - הצלחה (השדות בתוך `result` דינמיים לפי השגרה):
```json
{"result":{"structuredContent":{"status":"success","result":{"balance":"4,320 ₪"}}},"jsonrpc":"2.0","id":1}
```

תשובה אפשרית ב' - נדרש OTP:
```json
{"result":{"structuredContent":{"status":"awaiting_otp","continuation_token":"cont_82c4eef1...","prompt_hint":"קוד אימות מהבנק"}},"jsonrpc":"2.0","id":1}
```
כשמגיעה תשובה כזו: שולחים למשתמש בוואטסאפ הודעה לפי `prompt_hint`, ממתינים לתשובתו, ואז קוראים שוב ל-MCP עם tool בשם `submit_otp`:
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"submit_otp","arguments":{"continuation_token":"cont_82c4eef1...","otp_code":"123456"}}}
```
מחזירה תשובה מאותו סוג (`success`/`awaiting_otp` נוסף/`failed`). **אם המשתמש לא עונה תוך זמן סביר - אל תקראו ל-`submit_otp`** (זה יפוג אוטומטית בצד TANY DESKTOP אחרי כ-3 דקות; קריאה מאוחרת תחזיר `failed` עם `reason: "otp_expired"`).

תשובה אפשרית ג' - כשל:
```json
{"result":{"structuredContent":{"status":"failed","failed_step":4,"reason":"element_not_found","message":"הפעולה נכשלה — נסה שוב או בדוק שגרה"}}}
```

**כללים מעשיים:**
- **timeout 20 שניות** לכל קריאה. אם אין תשובה - להתייחס כאילו התקבל `status: "failed", reason: "timeout"`.
- **כשל תקשורת** (connection refused/timeout בכלל, לא HTTP error) - להודיע למשתמש מיד שהמחשב לא מחובר, ולסמן את המכשיר כ-`offline` ב-registry (יעודכן חזרה ל-`online` ע"י health polling, חלק 4).
- לפני כל קריאה, בדקו אם המכשיר כבר מסומן `offline` ב-registry (מ-health polling) - אם כן, הודיעו למשתמש מיד **בלי לנסות בכלל**, בלי לחכות ל-timeout.
- **אין תור בקשות (queueing)** - אם המכשיר לא מקוון, מודיעים מיד ולא ממתינים/מנסים שוב אוטומטית.

**4. Health polling**

זמנו `GET {mcp_address}/health` (ללא צורך ב-`x-api-key`) כל כמה דקות לכל מכשיר רשום. תשובה: `{"status":"ok","device_id":"...","device_name":"..."}`. עדכנו `status: online` ו-`last_seen` בהצלחה; אם הקריאה נכשלת (timeout/connection refused) - `status: offline`. המטרה: תשובת "המחשב לא מחובר" יכולה להגיע מיידית מה-registry, בלי לחכות ל-timeout על `run_routine` בזמן אמת.

**5. לוגיקת awaiting_otp/submit_otp בזרימת השיחה הקיימת**

שילוב הזרימה שתוארה בחלק 3 (בקשת OTP → הודעה למשתמש → קבלת תשובה → `submit_otp`) בתוך מנוע השיחה הקיים שלכם בוואטסאפ, כך שזה מרגיש כחלק טבעי מהשיחה ולא כתהליך נפרד.

### מה **לא** בהיקף שלך

- אל תיגעו/תבנו את TANY DESKTOP עצמו (ריפו נפרד).
- אל תניחו קיום שרת frps אמיתי - זה עדיין לא קיים בתשתית; ה-`mcp_address` שתקבלו ב-register יכול (בשלב פיתוח/בדיקה) להיות כתובת רשת מקומית/פנימית, לא בהכרח נגישה מהאינטרנט הציבורי עדיין.
- אל תממשו חתימת HMAC נוספת מעבר ל-`x-api-key` - זו נקודה פתוחה עדיין (אם תרצו להוסיף, סמנו את זה כשינוי נפרד לתיאום מול הצד השני).

### קריטריוני קבלה (מה שצריך לעבוד בסוף)

1. אפשר "לרשום" מכשיר בדיקה (`POST /v1/devices/register` עם ערכים מדומים) ולראות רשומה נוצרת/מתעדכנת ב-Device Registry.
2. אפשר לשלוח `routines/sync` ולראות שהקאש מתעדכן (כולל מקרה של רשימה ריקה - מוחקת שגרות קודמות של אותו מכשיר).
3. הודעת טקסט חופשית שמתאימה ל-trigger שמור מובילה לקריאת `run_routine` עם ה-`routine_id` הנכון; הודעה שלא מתאימה לשום trigger **לא** קוראת ל-MCP בכלל.
4. זרימת OTP מלאה עובדת (awaiting_otp → הודעה למשתמש → submit_otp → success/failed) - אפשר לבדוק את זה מול שרת TANY DESKTOP אמיתי שרץ מקומית (ראה בהמשך).
5. מכשיר לא זמין → הודעה מיידית למשתמש, בלי המתנה ל-timeout.

### איך לבדוק בפועל בלי סביבת ייצור

אפשר להריץ עותק אמיתי של TANY DESKTOP מקומית לבדיקות (הריפו `menibl/TANY-Desktop` הוא public/נגיש, `npm install && npm run build && npm run dev:server`) ולכוון את ה-MCP client שתבנו ישירות ל-`http://127.0.0.1:8765` שלו (בלי טאנל בכלל - זה בדיוק תרחיש "מחשב על אותה רשת" בלי frps). זה השרת האמיתי, לא מוק - התשובות שתקבלו הן בדיוק מה שמתואר למעלה.

---

## הערות למי ששולח את הפרומפט (לא חלק ממה שמעתיקים לסוכן)

- הפרומפט מניח שהסוכן עובד על ריפו TANY קיים ומכיר את המוסכמות שלו (מבנה DB, framework, אימות קיים) - הוא לא אומר "צור פרויקט חדש", אלא "שלב בתוך מה שיש".
- אם רוצים, אפשר גם לשלוח לסוכן את `docs/TANY_INTEGRATION.md` מהריפו הזה כקובץ נוסף - הוא מכיל את אותו מידע בפירוט קצת שונה (מוכוון לקורא אנושי במקום לסוכן).
