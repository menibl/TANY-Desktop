# TANY DESKTOP

מימוש ראשוני (Phase 1) של TANY DESKTOP לפי `TANY_DESKTOP_Spec.docx`: רכיב תוכנה שרץ מקומית אצל הלקוח, מקליט "שגרות" (תהליכי עבודה חוזרים באתרים/תוכנות דסקטופ), ומריץ אותן מחדש דטרמיניסטית דרך שרת MCP - כדי ש-TANY בענן יוכל להפעיל אותן לפי בקשה חופשית בוואטסאפ.

## מה מומש עכשיו (Phase 1)

| רכיב | סטטוס | חבילה |
|---|---|---|
| שרת MCP (`run_routine`, `submit_otp`, `/health`) | ✅ עובד, נבדק קצה-לקצה | `packages/mcp-server` |
| מנוע הקלטה/הרצה - אתרים (Playwright) | ✅ עובד | `packages/engine-web` |
| מנוע הקלטה/הרצה - דסקטופ (Power Automate Desktop) | 🚧 stub בלבד - ראו הסבר למטה | `packages/engine-desktop` |
| מאגר שגרות מוצפן מקומי (SQLite + הצפנת שדות) | ✅ עובד | `packages/shared` |
| GUI מקומי (הקלטה, רשימה, דיבאג) | ✅ עובד (Electron) | `packages/gui` |
| Auto-start (Windows Scheduled Task, "run whether logged on or not") | ✅ סקריפט התקנה | `scripts/` |
| חיבור בפועל ל-TANY בענן (pairing, tunnel, sync) | ⛔ לא מומש - Phase 2 | - |

התוכנה **לא מחוברת עדיין ל-TANY בענן**. לפי סיכום הדרישות: קודם בודקים שהקלטה/הרצה עובדות אצלכם על Windows אמיתי, ורק אחר כך מחברים ל-TANY (ראו "מפת דרכים ל-Phase 2" למטה).

## ארכיטקטורה

```
packages/
  shared/           טיפוסים, DB מוצפן (better-sqlite3 + AES-256-GCM לשדות רגישים), זהות מכשיר
  engine-web/        הקלטה (playwright codegen) + פרסור ל-Step[] + מנוע הרצה עם תמיכה ב-OTP
  engine-desktop/     ממשק RoutineEngine + מימוש stub (ל-Power Automate Desktop, Phase 2)
  mcp-server/         שרת MCP (@modelcontextprotocol/sdk) על HTTP, run_routine + submit_otp + health
  gui/                אפליקציית Electron: רשימת שגרות, אשף הקלטה, מסך דיבאג, הגדרות מכשיר
scripts/
  install-scheduled-task.ps1    התקנת auto-start על Windows (Scheduled Task, Run whether logged on or not)
  uninstall-scheduled-task.ps1
```

זרימת ההרצה תואמת פרוטוקול MCP שמוגדר בסעיף 14 של מסמך האפיון: `run_routine` מחזיר `success` / `awaiting_otp` (עם `continuation_token`) / `failed`; `submit_otp` ממשיך הרצה שהמתינה ל-OTP.

## התקנה והרצה (על Windows אמיתי)

### דרישות מוקדמות
- Node.js 20 ומעלה
- Git

### התקנה
```powershell
git clone <repo-url> TANY-Desktop
cd TANY-Desktop
npm install
npx playwright install chromium   # מוריד דפדפן להקלטה/הרצה
npm run build
```

### הרצה בזמן פיתוח/בדיקה

**האופן הפשוט (מומלץ):** מריצים רק את ה-GUI -

```powershell
npm run dev:gui
```

ובתוך ה-GUI עצמו לוחצים על **"הפעל שירות"** כדי להריץ את שרת ה-MCP ברקע. ה-GUI וה-MCP server חולקים אותו מאגר SQLite ואותו מודול native (`better-sqlite3`) - `npm install` בונה אותו אוטומטית מול Electron's ABI (`electron-rebuild`, ראו הערה למטה), וכשה-GUI מפעיל את השירות הוא עושה זאת דרך ה-Node הפנימי של Electron (`ELECTRON_RUN_AS_NODE`) כדי שה-ABI יתאים.

**להרצת שרת ה-MCP כתהליך עצמאי** (למשל כדי לדמות בדיוק את פריסת הייצור האמיתית - Scheduled Task עם `node` רגיל, לא Electron):

```powershell
npm rebuild better-sqlite3     # מחזיר את המודול native ל-ABI של Node רגיל
npm run dev:server
```

**חשוב:** אי אפשר להריץ את `npm run dev:server` (Node רגיל) ואת `npm run dev:gui` (Electron) בו-זמנית מאותה התקנה - הם צריכים build שונה (ABI שונה) של `better-sqlite3`, כי Electron מטמיע גרסת Node פנימית משלו. תעברו בין המצבים עם `npm rebuild better-sqlite3` (ל-Node רגיל) / `npx @electron/rebuild -f -w better-sqlite3` (ל-Electron) לפי הצורך, או פשוט תמיד תשתמשו בכפתור "הפעל שירות" בתוך ה-GUI.

ב-GUI: "שגרה חדשה" → הזינו כתובת התחלה → "התחל הקלטה" → מבצעים את התהליך בדפדפן שנפתח (Playwright Inspector) → סוגרים את חלון ההקלטה → מסמנים אילו שדות הם סוד (סיסמה) או שלב הזרקת OTP → נותנים שם וניסוחי הפעלה → שומרים. אחר כך "הרץ עכשיו" מריץ ומציג תוצאה, כולל טופס להזנת קוד OTP אם נדרש.

### התקנה כשירות רקע קבוע (Auto-start)
מטרמינל PowerShell **מורם כ-Administrator**:

```powershell
cd scripts
.\install-scheduled-task.ps1
```

הסקריפט ירשום Scheduled Task בשם `TANYDesktopService` שמריץ את שרת ה-MCP (`packages/mcp-server/dist/index.js`) עם עליית המחשב, כולל "Run whether user is logged on or not", בהתאם לסעיף 9 באפיון. הסרה: `.\uninstall-scheduled-task.ps1`.

**הערה חשובה על אוטומציית UI במסך נעול:** גם Playwright (במצב headed) וגם - כשיתווסף - Power Automate Desktop דורשים session גרפי אינטראקטיבי אמיתי כדי להריץ אוטומציה שדורשת חלון גלוי. תהליך שרץ ללא משתמש מחובר כלל לא רואה שולחן עבודה. לכן, בדיוק כפי שהאפיון מציין ("תרחיש נתמך: מחשב ייעודי שנשאר דלוק/פתוח"), התרחיש הנתמך בפועל הוא מחשב ייעודי שנשאר דלוק ומחובר. שגרות Playwright שרצות ב-headless (ברירת המחדל שלנו) לא מושפעות ממגבלה זו.

## בדיקות

מנוע ההקלטה עצמו (Playwright codegen) דורש מסך אינטראקטיבי אמיתי ולכן אי אפשר להריץ אותו אוטומטית ב-CI/sandbox. לעומת זאת **מנוע ההרצה (replay) ופרסור הסקריפטים נבדקו קצה-לקצה**:

```powershell
npm run build
node packages/engine-web/test/parser.smoketest.js   # פרסור פלט codegen -> Step[]
node packages/engine-web/test/replay.smoketest.js   # הרצה, הזרקת credential, השהיית/המשך OTP, מעקב אחר שלב כשל
```

כמו כן שרת ה-MCP עצמו נבדק קצה-לקצה מול קריאות `tools/call` אמיתיות (`initialize` → `run_routine` → `awaiting_otp` → `submit_otp` → `success`), כולל דחיית קריאה ללא `x-api-key` תקין - התוצאות תואמות בדיוק לדוגמאות בסעיף 14 של מסמך האפיון.

## אבטחה (סעיף 8 באפיון)

- **הצפנת שדות ברמת אפליקציה** ולא הצפנת קובץ DB שלמה (SQLCipher): `better-sqlite3` רגיל + AES-256-GCM על `Device.api_key` ו-`Credential.encrypted_payload` בלבד, עם מפתח מאסטר מקומי (`master.key`, הרשאות 0600) ליד קובץ ה-DB. הוחלט כך כדי להימנע ממודול native שדורש קומפילציה מחדש לכל פלטפורמה/גרסת Node - ראו "נקודות החלטה" למטה.
- קוד OTP **לעולם לא נשמר** - רק מוזרם בזמן ריצה (`otp_injection` step) וזורם ישירות לתוך העמוד.
- כל קריאת MCP (`run_routine`/`submit_otp`) דורשת כותרת `x-api-key` תואמת למפתח המכשיר המקומי; `/health` נשאר פתוח לבדיקת זמינות בלבד.
- `Device.deviceId`/`apiKey` נוצרים מקומית באתחול ראשון (`getOrCreateDevice`) ומוכנים לשלב הרישום מול TANY (Phase 2) - אבל עדיין לא נשלחים לשום מקום.

## נקודות החלטה שהתקבלו לפני המימוש

1. **היקף**: תוכנה אמיתית שנועדה לרוץ על Windows (לא שלד/מוק) - הקלטה והרצה בפועל, ורק לאחר בדיקה מקומית מחוברים ל-TANY בענן.
2. **אוטומציית דסקטופ**: Power Automate Desktop קנייני ל-Windows בלבד ולא ניתן להריץ/לפתח מתוך sandbox של Linux - מומש כ-adapter (`RoutineEngine`) + מימוש stub שמחזיר כשל ברור, כדי שכל שאר המערכת (DB, MCP, GUI) כבר תומכת בסוג `desktop` ורק ה-body יוחלף כשיהיה Windows זמין.
3. **ללא שרת TANY-cloud מדומה**: לא נבנה mock; הבדיקה קצה-לקצה בוצעה ישירות מול שרת ה-MCP האמיתי דרך קריאות `tools/call`.
4. **הצפנה**: הצפנת שדות ברמת אפליקציה (AES-256-GCM) במקום SQLCipher, כדי להימנע ממודול native שביר בין פלטפורמות.

## מפת דרכים ל-Phase 2 (חיבור בפועל ל-TANY)

לפי חלק ב'+ג' של מסמך האפיון, נדרש (לא מומש עדיין):

1. **Tunnel**: הטמעת frpc בתוך תהליך TANY DESKTOP כדי לחשוף את שרת ה-MCP המקומי לאינטרנט דרך frps שיוקם על תשתית TANY (סעיף 13.1) - כרגע השרת מאזין על `127.0.0.1` בלבד.
2. **Pairing**: שליחת `device_id`/`device_name`/`mcp_address`/`api_key` לנקודת קצה `POST /v1/devices/register` ב-TANY (סעיף 13.2, 19.1). התשתית ליצירת הזהות המקומית (`getOrCreateDevice`) כבר קיימת ב-`packages/shared/src/device.ts`.
3. **סנכרון שגרות**: שליחת `POST /v1/devices/{device_id}/routines/sync` בכל יצירה/עדכון/מחיקה של שגרה (סעיף 20.1), כדי ש-TANY ידע להתאים ניסוח חופשי ל-`routine_id` בלי לפנות ל-MCP בכל הודעה.
4. **Health polling** מצד TANY מול `GET /health` (כבר קיים וזמין - סעיף 22).
5. **צד TANY עצמו** (חלק ג', לא בריפו הזה): טבלת Device Registry, קאש שגרות, MCP client גנרי - ראו סעיפים 19-23 במסמך האפיון.
6. **Power Automate Desktop**: מימוש אמיתי במקום ה-stub (ראו `packages/engine-desktop/README.md`).
7. **חתימת HMAC** נוספת מעבר ל-API key לכל בקשה - הוחלט "טרם הוגדר" באפיון (סעיף 13.2), לא מומש.

## נתונים מקומיים

כברירת מחדל: `%ProgramData%\TanyDesktop` על Windows (`~/.tany-desktop` בפלטפורמות אחרות), הניתן לשינוי ב-`TANY_DESKTOP_DATA_DIR`. כולל `tany-desktop.sqlite`, `master.key`, ותיקיית `routines/` עם קובץ JSON לכל שגרה (מודל הנתונים תואם סעיף 15 באפיון: Device / Routine / RoutineTrigger / Credential / RunLog).
