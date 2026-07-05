# Marginalia — lecture notes → summary → quiz → Word doc

A small private study tool: paste or upload lecture notes, get a detailed
AI-generated summary, auto-generate a 20–30 question quiz from it, and
download the important points as a Word doc.

It's built as a static site + one small serverless function, so it's free
to run and deploys straight to your own domain.

---

## What you need (100% free, no card required anywhere)

1. **A Vercel account** — hosts the site and connects to your domain. (vercel.com) — free Hobby plan.
2. **A Firebase project** — stores your notes so they persist across devices. (firebase.google.com) — free Spark plan.
3. **A Google Gemini API key** — powers the summaries and quizzes. (aistudio.google.com) — Google's free tier needs no credit card and doesn't expire. It has a daily request limit, which is more than enough for personal study use (roughly dozens of summaries/quizzes a day).

---

## 1. Set up Firebase (storage)

1. Go to console.firebase.google.com → **Add project** → name it anything (e.g. "marginalia") → finish setup.
2. In the left sidebar, click **Build → Firestore Database** → **Create database** → start in **production mode** → pick any region.
3. Click the **Rules** tab and replace the contents with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /notes/{noteId} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
   Click **Publish**.
4. In the left sidebar go to **Build → Authentication** → **Get started** → enable the **Anonymous** sign-in provider (this just lets the app talk to Firestore securely — you still gate the site itself with your own passcode).
5. Click the gear icon (Project settings) → scroll to **Your apps** → click the `</>` (web) icon → register an app (any nickname) → it will show you a config object like:
   ```js
   {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   }
   ```
   Copy this whole object — you'll paste it into the app's Settings panel later.

---

## 2. Get a free Google Gemini API key

1. Go to **aistudio.google.com** and sign in with any Google account.
2. Click **Get API key** → **Create API key** → choose "Create in new project" if asked.
3. Copy the key (starts with `AIza...`). No credit card, no billing setup — this is genuinely free.
4. Keep it somewhere safe. You'll paste it into Vercel in the next step (never into the website itself).

---

## 3. Deploy to Vercel

**Easiest path (no command line):**

1. Push this project folder to a new GitHub repository.
2. Go to vercel.com → **Add New → Project** → import that repository.
3. Before deploying, open **Environment Variables** and add:
   - Key: `GEMINI_API_KEY`
   - Value: *(the key you copied above)*
4. Click **Deploy**. Vercel gives you a `*.vercel.app` URL when it's done.

**Command line alternative**, from inside this project folder:
```
npm install -g vercel
vercel login
vercel --prod
vercel env add GEMINI_API_KEY
```

---

## 4. Connect your domain

1. In your Vercel project → **Settings → Domains** → add your domain (e.g. `notes.yourdomain.com` or your root domain).
2. Vercel shows you a DNS record to add (usually a CNAME, or an A record for a root domain).
3. Go to your domain registrar (wherever you bought the domain) → DNS settings → add that record.
4. Wait a few minutes to an hour for DNS to propagate. Vercel will show "Valid Configuration" once it's live.

---

## 5. Configure the app itself

Open your live site. On first load you're straight in (no passcode set yet).

1. Click **⚙ Settings** in the sidebar.
2. **Site passcode** — set something only you know. From now on, opening the site will ask for this.
3. **Firebase config** — paste the whole config object from step 1.5 above.
4. **API base URL** — enter your live domain, e.g. `https://notes.yourdomain.com` (no trailing slash). This tells the frontend where to find `/api/generate`.
5. Save. The page reloads and you're ready to go.

---

## How to use it

- **+ New note** → paste text and/or drop in a PDF/Word/.txt file → **Save note**.
- **Generate detailed summary** → produces a structured, thorough Markdown summary (key takeaways, section-by-section breakdown, common pitfalls) — not just a few bullet points.
- **Download as Word doc** → exports that summary as a real `.docx` you can print or study offline.
- **Generate quiz (20–30 Qs)** → pick a question count, generates multiple-choice questions from your summary, and gives you an interactive quiz with instant grading and explanations.
- Notes are saved to Firestore, so they follow you across any device/browser where you enter the same passcode + point the app at the same Firebase project.

---

## Notes on cost & limits

- Everything here runs on free tiers — Vercel Hobby, Firebase Spark, and Gemini's free API tier. You should never be asked to enter a credit card anywhere in this setup.
- Gemini's free tier has a daily request cap (it varies, and Google adjusts it over time — check the limits shown in aistudio.google.com under your project). Each summary or quiz is one request, so this comfortably covers personal study use. If you ever hit the limit, just wait until it resets the next day.
- If Google ever changes free-tier availability, you can swap the model in `api/generate.js` (the `MODEL` constant) to another free-tier Gemini model, or point `callGemini` at a different provider's free tier.
- The site passcode is a light deterrent, not real security — don't put anything sensitive in your notes if that matters to you.

## Project structure

```
public/        → the website (HTML/CSS/JS)
api/generate.js → serverless function that calls the Claude API
vercel.json    → deployment config
```
