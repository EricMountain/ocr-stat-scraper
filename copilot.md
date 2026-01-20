
## Conversation Summary

- Goal: Build an app that:
  1. Lets you take a photo of a device’s screen showing a few data items.
  2. Runs OCR on the captured image.
  3. Extracts specific data fields from the OCR text.
  4. Sends the structured data to an AWS Lambda over HTTPS.

- Architecture:
  - Client: Preferably a **Progressive Web App (PWA)** (with Android app as a possible future step).
  - Backend: **AWS API Gateway → Lambda** (optionally DynamoDB for storage).

- OCR options discussed:
  - **Client-side OCR**:
    - PWA: **Tesseract.js** (WASM) in the browser.
    - Android native: **ML Kit Text Recognition**, if you later go native.
  - Backend OCR: AWS Textract or Tesseract in Lambda (decided to start with **client-side OCR in PWA**).

- Chosen implementation path (for now):
  - PWA built with:
    - **React + TypeScript** (Vite or similar bundler).
    - **Tesseract.js** for on-device OCR in browser.
    - Standard web camera file input (`<input type="file" accept="image/*" capture="environment">`).
  - Data flow: capture → OCR → parse text → show parsed values → send JSON payload to AWS.

- You asked:
  - How to start implementing the PWA.
  - Whether you can “transfer” this session into Copilot in VS Code.
- Outcome:
  - You’ll recreate the core decisions and plan in your repo.
  - Then use **Copilot Chat in VS Code** to continue from there.

---

## Implementation Plan for PWA in `ocr-stat-scraper`

You can paste this into your repo as a TODO/design document.

### 1. Project Setup

1. If not already done, create the PWA front-end inside `ocr-stat-scraper` (choose one):

   - **Standalone frontend directory** (recommended):
     - Create `pwa/` or `web/` folder inside the repo.
     - Inside that folder, scaffold a React+TS app using Vite:
       ```bash
       cd ocr-stat-scraper
       npm create vite@latest pwa -- --template react-ts
       cd pwa
       npm install
       ```
     - Commit it to the repo.

   - Or: if the repo already has a frontend structure, adapt these steps to that layout.

2. Ensure Git is tracking:
   ```bash
   cd ocr-stat-scraper
   git status
   git add pwa
   git commit -m "chore: add PWA scaffold for OCR screen capture"
   ```

---

### 2. Turn the React App into a PWA

In `pwa/` (or your chosen frontend folder):

1. **Install dependencies**:
   ```bash
   npm install tesseract.js
   npm install --save-dev vite-plugin-pwa
   ```

2. **Configure Vite PWA plugin** (`pwa/vite.config.ts`):

   - Update to something like:

   ```ts
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'
   import { VitePWA } from 'vite-plugin-pwa'

   export default defineConfig({
     plugins: [
       react(),
       VitePWA({
         registerType: 'autoUpdate',
         includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
         manifest: {
           name: 'OCR Stat Scraper',
           short_name: 'OCRScraper',
           description: 'Capture device screens and extract statistics via OCR',
           theme_color: '#0f172a',
           background_color: '#0f172a',
           display: 'standalone',
           orientation: 'portrait',
           start_url: '/',
           icons: [
             {
               src: 'pwa-192x192.png',
               sizes: '192x192',
               type: 'image/png'
             },
             {
               src: 'pwa-512x512.png',
               sizes: '512x512',
               type: 'image/png'
             }
           ]
         }
       })
     ]
   })
   ```

3. **Add a basic manifest + icons**:
   - Place placeholder icons `pwa-192x192.png`, `pwa-512x512.png` in `pwa/public/` (you can add real assets later).
   - VitePWA will generate the service worker; no manual SW needed initially.

---

### 3. Implement Core UI: Capture → OCR → Parse

In `pwa/src/App.tsx`, implement a minimal workflow:

1. **Image capture UI**:
   - Use `<input type="file" accept="image/*" capture="environment">` to:
     - Let the user take a photo with the device camera or pick from gallery.
   - Store selected image as an object URL (`URL.createObjectURL(file)`).

2. **Integrate Tesseract.js**:
   - Import and use `createWorker` from `tesseract.js`.
   - On “Run OCR” button click:
     - Call the worker with the captured image URL.
     - Show a basic loading state while OCR runs.
     - Store raw OCR text in state.

3. **Parsing function**:
   - Implement a pure function `parseDeviceText(text: string)` that:
     - Splits text into lines.
     - Uses heuristics/regex to extract the fields you care about (e.g. voltage, current, serial, any other stats).
     - Returns a structured object, e.g.:

       ```ts
       type ParsedReading = {
         // Adjust fields to match your device
         voltage?: number
         current?: number
         serial?: string
         // Add domain-specific stats here
         rawText: string
       }
       ```

   - Initially, implement basic regexes; refine once you have real OCR samples.

4. **Display parsed data**:
   - Show:
     - Raw OCR text.
     - Parsed JSON object in a `<pre>` block.
   - Later: provide editable fields so user can correct any mis-read values before submission.

5. **Temporary AWS stub**:
   - Implement a `sendToBackend` function that:
     - POSTs to a placeholder URL (later replaced by your real API Gateway endpoint).
     - Sends the parsed JSON as the body.
   - Handle success/failure states via simple toasts/alerts for now.

---

### 4. Hook Up AWS Lambda Endpoint

Once your Lambda/API Gateway is ready:

1. **Define the API contract**:
   - Decide the expected payload. For example:

     ```json
     {
       "deviceId": "device-123",
       "timestamp": "2026-01-19T10:23:00Z",
       "voltage": 230,
       "current": 2.1,
       "serial": "ABC123",
       "rawText": "full OCR text here"
     }
     ```

2. **Configure environment**:
   - In the PWA, keep the API URL in an environment variable:
     - For Vite: `VITE_API_BASE_URL` in `.env` / `.env.local`.
   - Use `import.meta.env.VITE_API_BASE_URL` in your fetch code.

3. **Implement the POST**:
   - In `sendToBackend`, call:
     ```ts
     await fetch(`${import.meta.env.VITE_API_BASE_URL}/readings`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ /* parsed data + metadata */ })
     })
     ```

4. **CORS**:
   - Ensure API Gateway has CORS enabled for:
     - Your PWA origin (during dev: `http://localhost:5173`, plus later your production domain).
     - Methods: `OPTIONS, POST`.
     - Headers: `Content-Type`, any auth headers you add later.

---

### 5. UX and Reliability Improvements

Once the core flow works end-to-end:

1. **Camera UX**:
   - Optionally move from file input to a live camera view using `getUserMedia` and `<video>` + `<canvas>` if needed.
   - However, the simple `<input type="file" capture="environment">` is often enough for mobile.

2. **Parsing robustness**:
   - Capture several real photos from your device.
   - Log OCR output and refine `parseDeviceText` to handle:
     - Slightly different labels (e.g. `Volt`, `V`, `Voltage`).
     - Mis-recognized characters (`0` vs `O`, `1` vs `I`, etc.).
   - Consider normalizing text (uppercase, remove extra spaces) before parsing.

3. **User correction**:
   - Turn the parsed JSON display into form fields:
     - Pre-fill from parsed values.
     - Allow manual corrections before sending.

4. **Offline / PWA polish**:
   - Verify installability in Chrome DevTools Lighthouse.
   - Test on Android:
     - Visit the app.
     - “Add to Home Screen”.
     - Confirm it launches standalone.

---

### 6. How to Continue in VS Code with Copilot

In VS Code, once `ocr-stat-scraper` is open:

1. Create a file, e.g. `docs/pwa-plan.md`, paste this entire plan.
2. Use **Copilot Chat** (in the sidebar) and prompt:

   > Here is my PWA implementation plan in `docs/pwa-plan.md`.  
   > I’ve created `pwa/` with Vite React TS.  
   > Help me implement `src/App.tsx` with image capture, Tesseract.js OCR, and a `parseDeviceText` function following this plan.

3. Use inline Copilot:
   - Open `pwa/src/App.tsx`.
   - Start writing a skeleton component and ask Copilot to fill in details or refine specific parts (e.g. parsing logic).

