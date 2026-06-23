# SmartComprovante prototype

Working prototype for company/month document classification, human review, Base Join, and employee Final Comprovantes.

## Run in the browser

```powershell
npm.cmd run dev
```

Open <http://localhost:3000>. The prototype prefers Groq when `GROQ_API_KEY` is configured, otherwise it uses Gemini.

For the current Groq test setup:

```text
GROQ_API_KEY=your_key_here
GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
```

With Groq, PDF embedded text is extracted locally before classification; JPG/PNG files use the vision model. Scanned PDFs without usable embedded text enter review until local OCR/page rendering is enabled.

For browser-only Gemini testing, create a local `.env.local` file that is excluded from Git:

```text
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

The **Demonstração** action sends only synthetic example text. **Selecionar ficheiros SharePoint** sends the chosen document contents to Gemini for the requested classification test.

Restart `npm.cmd run dev` after creating or changing `.env.local`.

The primary intake action is **Selecionar pasta 0. A Classificar**. Supported files are submitted one at a time, completed results are preserved, and unchanged hashes are skipped when the folder is selected again.

## Test real files from SharePoint

1. Sync the relevant SharePoint document library with OneDrive so it appears as a normal folder in Windows.
2. Open the company/month workspace.
3. Select **Selecionar ficheiros SharePoint** and choose 1–20 PDF/JPG/PNG files from the synced folder.
4. Gemini classifies each file and opens **Revisão**. Categories not present in the selected batch remain visibly **Em falta**.
5. Confirm or change **Pasta de destino**, then select **Validar e aprender**.
6. The approved signal is appended to that company’s versioned JSON and is included as context in later Gemini classifications for the same company.

The prototype accepts up to 15 MB per file and 100 MB per batch. Uploaded working copies are cached by SHA-256 under the protected application-data directory. Do not use real personal or banking documents until your organization approves Gemini processing for that data.

## Run the protected desktop build

```powershell
npm.cmd run electron
```

In Electron, set the Gemini key through **Definições**. The main process encrypts it with Electron `safeStorage`, stores only ciphertext under the operating-system user-data directory, and restarts the trusted local server with the decrypted key in its process environment. The renderer never receives the saved plaintext value.

## Prototype data

Browser development data is created under `.smartcomprovante-data/` and excluded from Git. Creating a company automatically creates its versioned rules JSON under `rules/companies/{company_id}.json`.

The **Repor demonstração** action restores the AGIX January 2026 review scenario.

## Verification

```powershell
npm.cmd run build
node --check electron/main.js
node --check electron/preload.js
```
