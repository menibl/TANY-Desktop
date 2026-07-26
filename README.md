# TANY DESKTOP

מימוש ראשוני (Phase 1) של TANY DESKTOP לפי `TANY_DESKTOP_Spec.docx`: רכיב תוכנה שרץ מקומית אצל הלקוח, מקליט "שגרות" (תהליכי עבודה חוזרים באתרים/תוכנות דסקטופ), ומריץ אותן מחדש דטרמיניסטית דרך שרת MCP - כדי ש-TANY בענן יוכל להפעיל אותן לפי בקשה חופשית בוואטסאפ.

## מה מומש עכשיו (Phase 1)

| רכיב | סטטוס | חבילה |
|---|---|---|
| שרת MCP (`run_routine`, `submit_otp`, `/health`) | ✅ עובד, נבדק קצה-לקצה | `packages/mcp-server` |
| מנוע הקלטה/הרצה - אתרים (Playwright) | ✅ עובד | `packages/engine-web` |
| מנוע הקלטה/הרצה - דסקטופ (Windows UI Automation) | 🚧 ממומש (הקלטה + הרצה + OTP), **לא נבדק על מחשב Windows אמיתי** - ראו `packages/engine-desktop/README.md` | `packages/engine-desktop` |
| מאגר שגרות מוצפן מקומי (SQLite + הצפנת שדות) | ✅ עובד | `packages/shared` |
| GUI מקומי (הקלטה, רשימה, דיבאג) | ✅ עובד (Electron) | `packages/gui` |
| Auto-start (Windows Scheduled Task, "run whether logged on or not") | ✅ סקריפט התקנה | `scripts/` |
| טאנל (frpc) + רישום מכשיר + סנכרון שגרות מול TANY | ✅ קוד מומש ונבדק קצה-לקצה מול frps/frpc אמיתיים ו-endpoint מדומה; ⛔ עדיין לא רץ מול frps/TANY אמיתיים - ראו למטה | `packages/mcp-server` |

**התוכנה עדיין לא מחוברת בפועל ל-TANY בענן** - לא כי הקוד חסר, אלא כי **אין עדיין שרת frps אמיתי ואין endpoint רישום/סנכרון אמיתי בצד TANY** (שניהם עדיין נקודות פתוחות בתשתית, ראו סעיף 13 באפיון ו-[`docs/TANY_INTEGRATION.md`](docs/TANY_INTEGRATION.md)). ברגע שיש כתובת frps אמיתית ו-endpoint רישום אמיתי, מפעילים עם כמה משתני סביבה (ראו "חיבור מרחוק" למטה) - שום שינוי קוד נוסף לא נדרש.

## ארכיטקטורה

```
packages/
  shared/           טיפוסים, DB מוצפן (better-sqlite3 + AES-256-GCM לשדות רגישים), זהות מכשיר
  engine-web/        הקלטה (playwright codegen) + פרסור ל-Step[] + מנוע הרצה עם תמיכה ב-OTP
  engine-desktop/     הקלטה/הרצה לתוכנות דסקטופ דרך Windows UI Automation (לא נבדק על Windows אמיתי - ראו README של החבילה)
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

ב-GUI: "שגרה חדשה" → הזינו כתובת התחלה → (אם צריך, ראו "כניסה דרך Google/Microsoft" למטה) → "התחל הקלטה" → מבצעים את התהליך בדפדפן שנפתח (Playwright Inspector) → סוגרים את חלון ההקלטה → מסמנים אילו שדות הם סוד (סיסמה) או שלב הזרקת OTP → נותנים שם וניסוחי הפעלה → שומרים. אחר כך "הרץ עכשיו" מריץ ומציג תוצאה, כולל טופס להזנת קוד OTP אם נדרש.

#### שדות פלט - מה השגרה מחזירה

בלי סימון מפורש, שגרה לא מחזירה שום נתון (`result` ריק) - גם אם היא "הצליחה". כדי שהיא תחזיר ערך (יתרה, סכום, סטטוס וכד'):

1. במסך הסקירה אחרי ההקלטה, מוצא את השלב שבו **לחצתם על האלמנט** שמכיל את הערך שרוצים (למשל לחצתם על הכיתוב של היתרה כדי "להצביע" עליו בזמן ההקלטה).
2. מסמנים ליד אותו שלב **"גם לחלץ נתון מכאן"**, ונותנים שם לשדה (למשל `balance`).
3. אין צורך לכתוב CSS selector בעצמכם - התוכנה משתמשת באותו selector שכבר זוהה אוטומטית בזמן ההקלטה עבור האלמנט שלחצתם עליו.

אם הערך שרוצים להחזיר לא נלחץ בזמן ההקלטה (למשל טקסט שרק מוצג, בלי אינטראקציה איתו) - עדיין אפשר להוסיף שלב חילוץ ידני עם כפתור **"+ הוסף שלב חילוץ נתונים"**, שם כן צריך להזין CSS selector בעצמכם (למשל דרך "בדוק" (Inspect) בדפדפן רגיל).

#### כניסה לאתר דרך Google/Microsoft וכד' ("Sign in with...")

גוגל (וספקי זהות דומים) חוסמים ביודעין כל ניסיון כניסה מדפדפן שמזוהה כאוטומטי (Playwright/WebDriver) - זו מדיניות אבטחה מכוונת מצידם, לא באג בתוכנה. **חשוב להבין:** זו לא רק "לא להקליט" - כל דפדפן שמופעל ע"י `Playwright.launch()` מסומן ככזה (`--enable-automation` וכד'), גם כשמישהו פשוט לוחץ בו ידנית, וגם אם זה דפדפן Chrome אמיתי (`--channel chrome` בלבד **לא מספיק** - זה רק בוחר איזה קובץ הרצה להשתמש בו, לא מסיר את סימוני האוטומציה).

**הפתרון בפועל:** לפני "התחל הקלטה", לוחצים על **"🔐 התחברות חד-פעמית"**. התוכנה פותחת Chrome אמיתי כתהליך **רגיל לגמרי** (לא דרך Playwright בכלל - `child_process.spawn` פשוט, רק עם `--remote-debugging-port` כדי שנוכל "להצטרף" אליו אחר כך) - כך שאין שום דבר לגוגל לזהות כאוטומציה בזמן ההתחברות עצמה. מתחברים בו ידנית, ואז לוחצים בתוכנה על **"✅ סיימתי להתחבר - שמור"** (Playwright מצטרף לחלון הפתוח דרך `connectOverCDP` באותו רגע כדי לקרוא את ה-session, בלי לגעת בתהליך הכניסה עצמו). **דורש Chrome אמיתי מותקן** (`google.com/chrome`) - אם אין, תופיע הודעת שגיאה מתאימה, וניתן גם להצביע על נתיב מותאם עם משתנה סביבה `TANY_DESKTOP_REAL_CHROME_PATH`.

ה-session (עוגיות) נשמר מוצפן על המחשב (כמו Credential), וההקלטה/ההרצות הבאות (על ה-Chromium המובנה הרגיל של Playwright, ללא צורך ב-Chrome אמיתי) מתחילות כבר מחוברות - הן לעולם לא מגיעות למסך ה-Sign in של גוגל, כי גוגל בודקת אוטומציה רק בזמן ה-handshake האינטראקטיבי עצמו, לא כשיש כבר עוגיית session תקפה. אם ההרצה מתחילה להיכשל כי ה-session פג, יש אותו כפתור "רענון התחברות" גם במסך הדיבאג של השגרה הקיימת (עם אותם שני שלבים: התחברות, ואז "סיימתי").

**נבדק** קצה-לקצה במנגנון (spawn ← המתנה ל-CDP ← `connectOverCDP` ← `storageState()` ← ניקוי) מול Chromium מקומי; לא ניתן היה לבדוק מהסביבה הזו אם גוגל בפועל תמיד תקבל את זה - זו עדיין הימור מושכל (best-effort) ולא הבטחה, בהתאם למדיניות משתנה מצד גוגל.

### התקנה כשירות רקע קבוע (Auto-start)
מטרמינל PowerShell **מורם כ-Administrator**:

```powershell
cd scripts
.\install-scheduled-task.ps1
```

(עם טאנל frpc מוגדר באותה הרצה - ראו "חיבור מרחוק" למטה):
```powershell
.\install-scheduled-task.ps1 -FrpsAddr <IP-ה-frps> -FrpsToken <טוקן> -FrpRemotePort <פורט>
```

הסקריפט ירשום Scheduled Task בשם `TANYDesktopService` שמריץ את שרת ה-MCP (`packages/mcp-server/dist/index.js`) עם עליית המחשב, כולל "Run whether user is logged on or not", בהתאם לסעיף 9 באפיון. הסרה: `.\uninstall-scheduled-task.ps1`.

מעבר לרישום עצמו, הסקריפט גם מבצע כל מה שהתברר בפועל (על מכונת Windows אמיתית) כהכרחי כדי שהמשימה באמת תישאר רצה - אף אחד מהם לא קורה אוטומטית מ-`Register-ScheduledTask`/`npm` לבד:
- **בונה מחדש את `better-sqlite3`** ל-ABI של Node רגיל - ה-GUI מריץ אותו דרך Electron (ABI אחר), וללא rebuild התהליך קורס עם `ERR_DLOPEN_FAILED`/`NODE_MODULE_VERSION mismatch` ברגע שה-Task (שמריץ `node.exe` רגיל) מנסה לעלות.
- **מעניק את ההרשאה "Log on as a batch job"** (`SeBatchLogonRight`) לחשבון שבחרתם - בלעדיה הרישום מצליח אבל כל הפעלה נכשלת בשקט ב-logon (Win32 1385), וה-Task אף פעם לא באמת עולה.
- **מעניק הרשאת Full Control** על תיקיית הנתונים (`%ProgramData%\TanyDesktop`) לאותו חשבון - נדרש אם ה-Task רץ תחת חשבון שונה ממי שהריץ את ה-GUI לראשונה.

**הערה חשובה על אוטומציית UI במסך נעול:** גם Playwright (במצב headed) וגם מנוע הדסקטופ (Windows UI Automation, `packages/engine-desktop`) דורשים session גרפי אינטראקטיבי אמיתי כדי להריץ אוטומציה שדורשת חלון גלוי. תהליך שרץ ללא משתמש מחובר כלל לא רואה שולחן עבודה. לכן, בדיוק כפי שהאפיון מציין ("תרחיש נתמך: מחשב ייעודי שנשאר דלוק/פתוח"), התרחיש הנתמך בפועל הוא מחשב ייעודי שנשאר דלוק ומחובר. שגרות Playwright שרצות ב-headless (ברירת המחדל שלנו) לא מושפעות ממגבלה זו.

### חיבור מרחוק - טאנל (frpc) + רישום + סנכרון מול TANY (סעיף 13 באפיון)

**מומש ונבדק קצה-לקצה** (`packages/mcp-server/src/tunnel.ts`, `pairing.ts`) מול `frps`/`frpc` אמיתיים (קומפלנו מהמקור הרשמי, `fatedier/frp`) ומול endpoint רישום/סנכרון מדומה - כולל אימות שקריאת MCP אמיתית עוברת דרך הטאנל מקצה לקצה, ושסנכרון שגרות קורה רק כשבאמת יש שינוי (לא בכל טיק). **עדיין לא רץ מול frps/TANY אמיתיים בייצור** - כי הם עדיין לא קיימים (ראו `docs/TANY_INTEGRATION.md`).

**להפעלה בפועל, ברגע שיש שרת frps אמיתי:**

**הדרך הפשוטה (מומלץ):** `install-scheduled-task.ps1 -FrpsAddr ... -FrpsToken ... -FrpRemotePort ...` (ראו "התקנה כשירות רקע קבוע" למעלה) - מוריד את `frpc.exe` אוטומטית אם חסר, ומגדיר את משתני הסביבה, הכל בהרצה אחת.

**ידנית (אם צריך לעדכן משתנים אחרי שהמשימה כבר מותקנת, בלי להריץ את הסקריפט מחדש):**

1. מורידים את `frpc.exe` הרשמי (לא מגיע בריפו - כמו ש-Playwright מוריד את ה-browser שלו בהתקנה, לא רוצים בינארי לא-שקוף שמורץ בהרשאות Admin מגיע מ-git):
   ```powershell
   .\scripts\get-frpc.ps1
   ```
2. מגדירים משתני סביבה **ברמת המערכת** (כדי שה-Scheduled Task יראה אותם - קובץ `.env` לא נטען אוטומטית, הקוד קורא ישירות מ-`process.env`):
   ```powershell
   [Environment]::SetEnvironmentVariable("TANY_DESKTOP_FRPS_ADDR", "<כתובת ה-frps ב-GCP>", "Machine")
   [Environment]::SetEnvironmentVariable("TANY_DESKTOP_FRPS_PORT", "7000", "Machine")
   [Environment]::SetEnvironmentVariable("TANY_DESKTOP_FRPS_TOKEN", "<טוקן משותף מול frps>", "Machine")
   [Environment]::SetEnvironmentVariable("TANY_DESKTOP_FRP_REMOTE_PORT", "<פורט ייעודי למכשיר הזה על frps>", "Machine")
   ```
   **חשוב:** תהליכים שכבר רצים (כולל ה-Scheduled Task) לא רואים משתנים חדשים אוטומטית - צריך `Stop-ScheduledTask`/`Start-ScheduledTask` אחרי ההגדרה כדי שהתהליך הבא ייקרא אותם.
3. `TANY_CLOUD_REGISTER_URL=<כתובת בסיס ה-API של TANY, פעם שקיים>` (אותה שיטה) - אם `TANY_DESKTOP_FRPS_ADDR` מוגדר, השרת יקים את הטאנל, ירשום את המכשיר, ויסנכרן שגרות אוטומטית (בדיקת שינוי כל דקה, מוגדר עם `TANY_DESKTOP_SYNC_INTERVAL_MS`). בלי המשתנים - מתנהג בדיוק כמו היום (מקומי בלבד, בלי שגיאות).

**עדיין לא ממומש:** בחירת remotePort דינמית (כרגע פורט קבוע לכל מכשיר, מוגדר ידנית - ראו את ההערה בקוד ב-`config.ts`), וחתימת HMAC נוספת מעבר ל-API key (נקודה פתוחה באפיון עצמו, סעיף 13.2).

**⚠️ TLS מקצה לקצה (סעיף 12.1 באפיון) עדיין לא ממומש בפועל:** ה-tunnel כרגע מסוג `tcp` ב-frp, שמעביר בייטים גולמיים בלי להצפין - ושרת ה-MCP עצמו מדבר HTTP רגיל, לא HTTPS. כלומר התעבורה **לא** מוצפנת מקצה לקצה כרגע (`mcp_address` שנרשם הוא `http://`, לא `https://`, בכוונה - לא רצינו "לשקר" בפרוטוקול הרישום). לפני ייצור אמיתי צריך אחד משניים: (א) שרת ה-MCP עצמו ידבר HTTPS (עם תעודה - self-signed מספיק כי התעבורה עוברת רק דרך ה-tunnel, לא ישירות לאינטרנט) כך שהבייטים המוצפנים פשוט "יעברו דרך" ה-tunnel כמו שהם, או (ב) שימוש בסוג proxy אחר של frp שמסיים TLS בעצמו.

## בדיקות

מנוע ההקלטה עצמו (Playwright codegen) דורש מסך אינטראקטיבי אמיתי ולכן אי אפשר להריץ אותו אוטומטית ב-CI/sandbox. לעומת זאת **מנוע ההרצה (replay) ופרסור הסקריפטים נבדקו קצה-לקצה**:

```powershell
npm run build
node packages/engine-web/test/parser.smoketest.js   # פרסור פלט codegen -> Step[]
node packages/engine-web/test/replay.smoketest.js   # הרצה, הזרקת credential, השהיית/המשך OTP, מעקב אחר שלב כשל
node packages/shared/test/matching.smoketest.js     # התאמת query -> routine_id, וזיהוי ניסוחים כפולים
```

### בדיקה אינטראקטיבית עם Claude כלקוח MCP

הדרך הכי נוחה לבדוק את שרת ה-MCP ידנית - במקום `curl` - היא לחבר אותו ל-Claude Code (או Claude Desktop) כשרת MCP חיצוני, ולבקש מקלוד להריץ שגרות ישירות מתוך שיחה.

1. ודאו שהשרת רץ (`npm run dev:server`, או "הפעל שירות" ב-GUI).
2. קחו את ה-API Key מה-GUI (כפתור "הצג API Key" בפאנל המכשיר בצד שמאל).
3. ב-Claude Code, מטרמינל (לא בתוך הריפו הזה - מכל מקום על המחשב):
   ```powershell
   claude mcp add --transport http tany-desktop http://127.0.0.1:8765/mcp --header "x-api-key: <ה-API Key>"
   ```
   (אם התחביר לא תואם לגרסה שמותקנת אצלכם - `claude mcp add --help` יראה את התחביר המדויק.)
4. פתחו שיחת Claude Code חדשה ובקשו בשפה חופשית, בדיוק כמו שמשתמש היה כותב בוואטסאפ - למשל "מה מצב העו\"ש שלי?" (כל עוד זה תואם/מכיל ניסוח שהגדרתם לשגרה). קלוד יקרא ל-`run_routine` עם `query` (לא `routine_id`), ו-TANY DESKTOP עצמו יתאים את זה לשגרה הנכונה - בדיוק ההתנהגות שתוארה למעלה ב"נקודות החלטה" (סעיף 5). אפשר גם לבקש "אילו כלים יש לך מ-tany-desktop?" כדי לראות את שני ה-tools.

כמו כן שרת ה-MCP עצמו נבדק קצה-לקצה מול קריאות `tools/call` אמיתיות (`initialize` → `run_routine` → `awaiting_otp` → `submit_otp` → `success`), כולל דחיית קריאה ללא `x-api-key` תקין - התוצאות תואמות בדיוק לדוגמאות בסעיף 14 של מסמך האפיון.

## אבטחה (סעיף 8 באפיון)

- **הצפנת שדות ברמת אפליקציה** ולא הצפנת קובץ DB שלמה (SQLCipher): `better-sqlite3` רגיל + AES-256-GCM על `Device.api_key`, `Credential.encrypted_payload`, וקובץ ה-session השמור לכל שגרה שדורשת כניסה דרך Google/Microsoft (`routines/<id>.auth.enc` - מכיל עוגיות session, רגיש באותה מידה כמו סיסמה), עם מפתח מאסטר מקומי (`master.key`, הרשאות 0600) ליד קובץ ה-DB. הוחלט כך כדי להימנע ממודול native שדורש קומפילציה מחדש לכל פלטפורמה/גרסת Node - ראו "נקודות החלטה" למטה.
- קוד OTP **לעולם לא נשמר** - רק מוזרם בזמן ריצה (`otp_injection` step) וזורם ישירות לתוך העמוד.
- כל קריאת MCP (`run_routine`/`submit_otp`) דורשת כותרת `x-api-key` תואמת למפתח המכשיר המקומי; `/health` נשאר פתוח לבדיקת זמינות בלבד.
- `Device.deviceId`/`apiKey` נוצרים מקומית באתחול ראשון (`getOrCreateDevice`) ומוכנים לשלב הרישום מול TANY (Phase 2) - אבל עדיין לא נשלחים לשום מקום.

## נקודות החלטה שהתקבלו לפני המימוש

1. **היקף**: תוכנה אמיתית שנועדה לרוץ על Windows (לא שלד/מוק) - הקלטה והרצה בפועל, ורק לאחר בדיקה מקומית מחוברים ל-TANY בענן.
2. **אוטומציית דסקטופ**: Power Automate Desktop (ההצעה המקורית באפיון) הוא קנייני-סגור בלי שום API הפעלה שקטה/הקלטה תכנותית - הוחלף ב-Windows UI Automation (דרך סקריפטי PowerShell, `packages/engine-desktop/native/`), ששומר על אותו עיקרון "לזהות אלמנטים, לא פיקסלים" מסעיף 2 באפיון. ממומש (הקלטה + הרצה + OTP) אבל **לא ניתן להריץ/לבדוק מתוך sandbox של Linux** - דורש בדיקה על Windows אמיתי, ראו `packages/engine-desktop/README.md`.
3. **ללא שרת TANY-cloud מדומה**: לא נבנה mock; הבדיקה קצה-לקצה בוצעה ישירות מול שרת ה-MCP האמיתי דרך קריאות `tools/call`.
4. **הצפנה**: הצפנת שדות ברמת אפליקציה (AES-256-GCM) במקום SQLCipher, כדי להימנע ממודול native שביר בין פלטפורמות.
5. **⚠️ סטייה ממסמך האפיון המקורי - התאמת ניסוחים עברה ל-TANY DESKTOP**: סעיף 20 באפיון תיאר ש-TANY שומר קאש מקומי של שגרות+triggers ומבצע את ההתאמה הסמנטית בעצמו, כדי לא לקרוא ל-MCP על כל הודעה נכנסת. **הוחלט לשנות**: `run_routine` מקבל עכשיו גם `query` (טקסט חופשי) בנוסף ל-`routine_id`, ו-TANY DESKTOP עצמו עושה את ההתאמה מול ה-triggers השמורים שלו (ראו `findRoutineByQuery` ב-`packages/shared/src/db.ts`) ומחזיר `status: "no_match"` אם שום דבר לא מתאים. `routines/sync` עדיין קיים ורץ, אבל כבר לא הכרחי להתאמה - רק אם TANY רוצה את רשימת השגרות לצרכים אחרים (הצגה למשתמש וכד'). כדי שההתאמה תישאר חד-משמעית, נוסף גם ולידציה שחוסמת שמירת שגרה עם ניסוח שכבר קיים בשגרה אחרת. פירוט מלא ב-`docs/TANY_INTEGRATION.md`.

## מפת דרכים ל-Phase 2 (חיבור בפועל ל-TANY)

מדריך שילוב מפורט לצוות שמפתח את צד TANY (endpoints מדויקים, דוגמאות בקשה/תשובה אמיתיות מהשרת, ומה עדיין חסר) נמצא ב-[`docs/TANY_INTEGRATION.md`](docs/TANY_INTEGRATION.md).

לפי חלק ב'+ג' של מסמך האפיון:

1. ~~**Tunnel**: הטמעת frpc~~ - **✅ מומש ונבדק** (`packages/mcp-server/src/tunnel.ts`, `scripts/get-frpc.ps1`) - ראו "חיבור מרחוק" למעלה. עדיין מאזין על `127.0.0.1` **כברירת מחדל** (הטאנל מופעל רק כש-`TANY_DESKTOP_FRPS_ADDR` מוגדר).
2. ~~**Pairing**~~ - **✅ מומש ונבדק** (`packages/mcp-server/src/pairing.ts`) - שולח `device_id`/`device_name`/`mcp_address`/`api_key` ל-`POST /v1/devices/register` באתחול, כש-`TANY_CLOUD_REGISTER_URL` מוגדר.
3. ~~**סנכרון שגרות**~~ - **✅ מומש ונבדק** - שולח `POST /v1/devices/{device_id}/routines/sync` באתחול ובכל שינוי שזוהה (בדיקה מחזורית, לא event-driven בין תהליכים - ראו הערה ב-`pairing.ts`).
4. **Health polling** מצד TANY מול `GET /health` (כבר קיים וזמין - סעיף 22).
5. **צד TANY עצמו** (חלק ג', לא בריפו הזה, לא מומש): טבלת Device Registry, קאש שגרות, MCP client גנרי - ראו סעיפים 19-23 במסמך האפיון ו-`docs/TANY_INTEGRATION.md`.
6. ~~**Power Automate Desktop**~~ - **הוחלף ב-UI Automation, ממומש** (ראו `packages/engine-desktop/README.md`) - **עדיין לא נבדק על Windows אמיתי**.
7. **חתימת HMAC** נוספת מעבר ל-API key לכל בקשה - הוחלט "טרם הוגדר" באפיון (סעיף 13.2) - לא מומש.
8. **remotePort דינמי**: כרגע כל מכשיר צריך פורט קבוע שמוגדר ידנית מראש (`TANY_DESKTOP_FRP_REMOTE_PORT`) - אין עדיין מנגנון שמקצה פורט/subdomain אוטומטית מצד TANY בזמן הרישום.

**מה עדיין באמת חוסם חיבור בפועל:** לא קוד - התשתית עצמה. אין עדיין שרת `frps` אמיתי בתשתית ה-GCP של TANY, ואין עדיין endpoint רישום/סנכרון בצד TANY. ברגע ששניהם קיימים, ההפעלה היא עניין של משתני סביבה (ראו "חיבור מרחוק" למעלה), לא פיתוח נוסף.

## נתונים מקומיים

כברירת מחדל: `%ProgramData%\TanyDesktop` על Windows (`~/.tany-desktop` בפלטפורמות אחרות), הניתן לשינוי ב-`TANY_DESKTOP_DATA_DIR`. כולל `tany-desktop.sqlite`, `master.key`, ותיקיית `routines/` עם קובץ JSON לכל שגרה (מודל הנתונים תואם סעיף 15 באפיון: Device / Routine / RoutineTrigger / Credential / RunLog).
