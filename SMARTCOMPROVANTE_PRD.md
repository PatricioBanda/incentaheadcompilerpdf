# SmartComprovante Engine

## Product Requirements Document — MVP Revision 2

**Date:** 23 June 2026  
**Status:** Ready for implementation planning  
**Target platform:** Local-first Next.js application with optional Electron desktop packaging  
**Existing project:** PDFCompiler

## 1. Purpose

SmartComprovante is a local-first document-processing application that accepts mixed corporate financial documents, separates them into logical records, classifies each record, groups it by entity and accounting period, orders it according to compliance rules, and exports a client-ready PDF bundle.

The MVP must prove classification accuracy while minimizing paid/cloud token use. The intended intelligence order is: reusable local rules and cached examples first, lightweight local pattern matching second, local Ollama when available, and cloud LLMs only as an explicit fallback for unclear or benchmark cases. Google Gemini and Groq may be used only as explicitly enabled cloud test/prototype providers. Documents and generated files remain local unless the operator knowingly enables a cloud provider for the current batch.

## 2. Current Product Baseline

The existing PDFCompiler project provides reusable foundations:

- Next.js and React user interface;
- optional Electron wrapper;
- local folder selection through the browser File System Access API;
- PDF, PNG, and JPEG ingestion;
- PDF merging, splitting, extraction, rotation, and page manipulation through `pdf-lib`;
- image-to-PDF conversion;
- month, folder, and employee-oriented RH workflows;
- Zod dependency for validation.

These features are foundations only. The existing folder-number and filename workflows do not constitute SmartComprovante classification. The MVP must add the processing pipeline defined in this document.

### 2.1 Operational reference documents

This revision incorporates the operating structure supplied in:

- `Esquema_Pasta_Partilhada_.pdf` — year, Recursos Humanos, Investimentos, quarter, month, and numbered folder organization;
- `Reorganizacao_Pedidos_Reembolso_.pdf` — mandatory ordering and supporting-evidence requirements for the 13 Recursos Humanos and 8 Investimentos categories.

If a later approved company-specific rule conflicts with these generic references, the system must show the conflict for operator approval rather than silently changing the canonical shared-folder structure.

## 3. Product Goals

### 3.1 Primary goals

1. Accept unstructured PDF and image batches.
2. Convert every input into independently processable page assets.
3. extract vector text locally and apply OCR when useful text is unavailable.
4. Classify every page through deterministic heuristics, learned company rules, local pattern matching, and a selectable AI provider only when needed.
5. Reconstruct multi-page logical documents.
6. Group documents by corporate entity, year, and month.
7. Sort each bundle using the prescribed compliance sequence.
8. Route uncertain or invalid results to a manual review inbox.
9. Export the approved result as a merged PDF plus a machine-readable audit manifest.
10. Record rule hits, cache hits, avoided model calls, tokens, latency, provider usage, retries, and estimated paid-tier cost.

### 3.2 MVP success criteria

- At least 95% of uploaded pages are preserved in either an exported bundle or the review inbox.
- No page is silently discarded or duplicated.
- At least 85% page-level document-type accuracy on the approved test corpus.
- At least 90% correct entity/year/month grouping on the approved test corpus.
- 100% of approved documents are mapped to one of the canonical Recursos Humanos or Investimentos evidence folders and the correct month/quarter hierarchy.
- 100% schema-valid stored classifications after automated repair or manual review.
- Exported bundles follow the configured category sequence exactly.
- The audit report reconciles input pages, classified pages, reviewed pages, and exported pages.

## 4. Users and Primary Workflow

### 4.1 Primary user

An accounting, payroll, or administrative operator compiling monthly evidence for a corporate client.

### 4.2 Organizational hierarchy

The application organizes work using the following navigable hierarchy:

```text
Program
  -> Project
      -> Company
          -> Year
              -> Month
```

- A **Program** is the highest-level operational or funding context.
- A **Project** belongs to a Program and represents a concrete execution or reimbursement scope.
- A **Company** is managed within a Project and is identified by a stable internal ID and, when available, its corporate NIF.
- A company may participate in more than one project without duplicating its master company record. Project membership stores project-specific settings and folder locations.
- Documents, batches, rules, reviews, and joins must always retain their Program, Project, and Company scope.
- The primary setup unit is one Company + Year. The UI refers to this as the **Company Year Workspace**.
- Inside each Company Year Workspace, the operator can select any of the 12 months as a **Monthly Company Workspace** for classification, review, Base Join generation, and Comprovante Final generation.
- The system must support processing/generating one month, several selected months, or all 12 months for the selected company/year without recreating the company setup.

### 4.3 Target workflow

For a new company or unfamiliar document family, reference onboarding precedes monthly classification. The first visible action is to upload one or more approved `Base Join` examples and one or more approved `Final Join` examples; when examples do not exist, the operator may explicitly continue in guided mode with increased human review. The application extracts privacy-safe structural profiles into the versioned company rules, compares multiple examples to infer common headers/order/layout logic, then discards the temporary reference binaries. Reference inputs and folder-0 sources are previewed only inside the application when needed and are not presented as downloadable deliverables.

1. The operator selects a Program, Project, Company, and Year, creating or opening the Company Year Workspace.
2. The application shows the 12 months for that year with status indicators for pending folder 0 files, review, Base Join, and Comprovantes Finais.
3. The operator selects one month, multiple months, or all months to classify/review/generate. The active month opens as a Monthly Company Workspace.
4. The operator places all unsorted Recursos Humanos documents in that company's/year folder `0. A Classificar` and creates a batch.
5. The operator uses local Ollama by default, or selects an explicitly enabled cloud provider, and imports mixed PDFs, PNGs, and JPEGs from folder 0.
6. The application validates the files and slices PDFs into page-level assets.
7. The application extracts embedded PDF text locally.
8. Pages without sufficient text are rendered and processed using local OCR. Cloud vision may be used only as an explicitly selected fallback.
9. Deterministic Portuguese keyword heuristics, learned company rules, reference-example profiles, cache hits, and local similarity matching generate classification hints.
10. If the local rules produce a safe high-confidence result, the application avoids the LLM call and records the avoided token use.
11. Only unclear, conflicting, low-confidence, or benchmarked records are sent to the selected AI provider, which returns one strict classification object per page.
12. The application validates and, when safe, repairs the response.
13. Logical document boundaries are calculated.
14. Documents are grouped by Program, Project, Company, year, and month and sorted by category.
15. Low-confidence, conflicting, or invalid records enter the manual review inbox.
16. The operator corrects or approves review items in-page using protected previews. The operator may also explicitly pass unclear items for later review; passed items are never treated as approved.
17. The application creates one approved logical-document PDF where required, files it under the classified company/month/category structure, and applies the standard filename convention.
18. During the first learning cycles for a new company or unfamiliar document family, the application first clusters files by shared characteristics before trusting full automatic classification.
19. The operator can confirm the cluster, month, destination folder, and whether an approved upload should be stored as a reference `Base Join`, reference `Final Join`, or category-level example.
20. For Recursos Humanos, the application generates folder 14 Base Join virtual manifests from approved folders 2–13 for each selected month.
21. The application generates one folder 15 Comprovante Final virtual manifest per employee/month by placing the folder 1 payslip before the corresponding folder 14 Base Join. The user-facing deliverable is named **Comprovante Final**.
22. The application exports the resulting PDFs and audit manifests for the selected month(s).

## 5. Supported Inputs and Outputs

### 5.1 Inputs

- PDF, including vector-text and scanned PDFs;
- PNG;
- JPEG/JPG;
- multiple files per batch;
- multi-page PDFs containing more than one logical document;
- files whose pages are in an arbitrary order.

The normal Recursos Humanos operating model uses folder `0. A Classificar` as the single intake queue. Operators place all new RH documents in this folder without sorting or renaming them first. The application scans only supported files that have not already been registered in a batch. Folder 0 is the only source folder from which RH classification into folders 1–13 begins.

The primary intake control selects the folder `0. A Classificar`, not every file individually. After permission is granted, the application enumerates eligible PDF/PNG/JPEG files, registers their hashes, and processes them one at a time. The UI shows the current filename, processed/total count, failures, and remaining work. Manual multi-file selection remains a secondary fallback.

In the browser prototype, folder access lasts only as long as the browser permission/session allows, so the operator may need to select the folder again. In the packaged Electron application, the operator may explicitly authorize and persist the local OneDrive/SharePoint-synced folder path; the application can then rescan or watch that folder without copying the whole folder into an upload request. Remembered access must remain scoped to the configured company/project membership and support revoke/change controls.

When approved history is still weak or absent, the intake experience must behave like a guided funnel. The system should first suggest groups of files that appear to belong together based on visible and extracted characteristics such as issuer, employee name, recurring keywords, filename hints, page structure, and layout similarity. These groups are suggestions only until a human validates them.

Password-protected, corrupt, unsupported, or zero-page files must be rejected with a visible reason and retained in the batch error list.

### 5.2 Outputs

For each approved composite key, the application creates:

- `{DOC}_{YYYYMM}[_{ENTITY}][_{SEQ}].pdf` (e.g. `BJ_202601.pdf` or `CF_202601_E0042.pdf` as detailed in section 7.15);
- `{DOC}_{YYYYMM}[_{ENTITY}][_{SEQ}].manifest.json`;
- an entry in the batch-level usage and cost report.

The manifest must contain source file/page provenance, final page order, classification metadata, confidence, manual changes, timestamps, provider/model, and content hashes.

Approved logical documents are also stored as individually identifiable files using the folder organization and naming convention in section 7.15. Unclear or passed documents remain separate from approved documents.

## 6. Processing Architecture

```text
Input validation
      |
Page slicing and stable page IDs
      |
Local vector-text extraction
      |
OCR fallback for text-poor pages
      |
Keyword heuristic hints
      |
Routing policy and confidence decision
      |
Rate-limited AI provider gateway
      |
JSON extraction, repair, and schema validation
      |
Boundary reconstruction
      |
Entity/period grouping and compliance sorting
      |
Manual review inbox for exceptions
      |
Local PDF compilation, manifest, and cost report
```

Every stage must store explicit status and errors so an interrupted batch can resume without reprocessing successful pages.

### 6.1 Core data model

The MVP must implement a typed data model before workflow implementation. Product prose is not the schema authority; the runtime database, JSON rules, API contracts, and manifests must map to the same entities and identifiers.

#### Entity relationship overview

```text
Program 1---N Project 1---N ProjectMembership N---1 Company
Company 1---N CompanyRuleVersion
ProjectMembership 1---N MonthlyWorkspace
MonthlyWorkspace 1---N Batch
Batch 1---N SourceFile 1---N PageAsset
PageAsset 0---N ExtractionResult
PageAsset 0---N ClassificationAttempt
PageAsset N---0..1 LogicalDocument
LogicalDocument 0---N ReviewItem
LogicalDocument 0---1 FiledDocument
MonthlyWorkspace 1---0..N JoinOutput
JoinOutput 1---1 Manifest
CompanyRuleVersion 1---N RuleProposal
CompanyRuleVersion 1---N ReferenceExampleProfile
CompanyRuleVersion 1---N CategoryExampleProfile
```

#### Required entities

| Entity | Primary identifier | Purpose |
|---|---|---|
| `Program` | `program_id` | Highest-level operating/funding context. |
| `Project` | `project_id` | Execution/reimbursement scope inside a Program. |
| `Company` | `company_id` | Stable legal company record shared across projects. |
| `ProjectMembership` | `membership_id` | Company participation in one Program/Project with folder mappings and overrides. |
| `YearWorkspace` | `year_workspace_id` | One Company + Project + Year container holding 12 monthly workspaces and year-level status. |
| `MonthlyWorkspace` | `workspace_id` | One Company + Project + Year + Month operational workspace. |
| `Batch` | `batch_id` | One folder-0 scan or import run. |
| `SourceFile` | `source_file_id`, `source_hash` | Original PDF/image registered from folder 0 or approved example intake. |
| `PageAsset` | `page_id` | One processable page from a source file. |
| `ExtractionResult` | `extraction_id` | Embedded text, OCR text, layout signature, extraction versions, and quality metrics. |
| `ClassificationAttempt` | `classification_attempt_id` | One rule/example/provider classification decision and its audit evidence. |
| `LogicalDocument` | `logical_document_id` | One reconstructed document made from one or more pages. |
| `ReviewItem` | `review_item_id` | Human validation/correction/pass record for uncertain work. |
| `FiledDocument` | `filed_document_id` | Approved document filed into folders 1-13. |
| `JoinOutput` | `join_output_id` | Generated folder 14 Base Join or folder 15 Comprovante Final. |
| `Manifest` | `manifest_id` | Immutable provenance and reconciliation record for an output. |
| `CompanyRuleVersion` | `company_id`, `rules_version` | Versioned company rules and approved learning signals. |
| `RuleProposal` | `proposal_id` | Inactive rule candidate created by review/example validation. |
| `ReferenceExampleProfile` | `example_profile_id` | Privacy-safe Base Join or Final Join structural profile. |
| `CategoryExampleProfile` | `category_example_id` | Privacy-safe approved example for a canonical folder/type. |

#### Data-model invariants

- Every `MonthlyWorkspace` must resolve to exactly one `YearWorkspace`.
- Every `YearWorkspace` must resolve to exactly one `ProjectMembership`, and therefore exactly one Program, Project, and Company.
- Every `Batch`, `SourceFile`, `PageAsset`, `LogicalDocument`, `ReviewItem`, `FiledDocument`, `JoinOutput`, and `Manifest` must resolve to exactly one `MonthlyWorkspace`.
- `Company.company_id` is stable across rename, aliases, project membership changes, and rule-version upgrades.
- `SourceFile.source_hash` is content-derived and cannot be changed after registration.
- `PageAsset` order is derived from `source_file_id` + original page index and preserved in manifests.
- A `LogicalDocument` may contain pages from one source file or several adjacent reconstructed page groups, but every page in an approved output must have explicit provenance.
- Only approved `FiledDocument` records can feed folder 14 Base Join generation.
- Only current folder 1 payslips and current folder 14 Base Join outputs can feed folder 15 Comprovante Final generation.
- Rule proposals are inactive until explicitly approved into a new `CompanyRuleVersion`.
- Reference/category example profiles store redacted structural signals only; they never store downloadable source binaries or full extracted document text.

### 6.2 Processing architecture and concurrency

The implementation must not treat the pipeline as one blocking page-by-page loop. The logical pipeline remains ordered, but independent work should overlap safely.

```text
Folder scan / ingestion
      |
Extraction queue  ->  OCR/render queue  ->  local feature/index queue
      |                     |                       |
      +---------------------+-----------------------+
                            |
                 classification routing queue
                            |
                review / filing / join assembly
```

Concurrency requirements:

- Folder scanning remains incremental and reads one source file at a time, but extraction for file N+1 may run while classification/review preparation for file N continues.
- CPU-heavy work such as PDF rendering, OCR, table detection, perceptual hashing, and local similarity indexing should run in worker threads, child processes, or a separate local processing service rather than blocking the UI/server event loop.
- The default local inference concurrency remains conservative, but the runtime must support a hardware profile with configurable local model concurrency, initially `1` for low-memory machines and `2-4` for capable machines.
- Cloud provider calls remain rate-limited by provider policy and consent; increasing local worker concurrency must not increase cloud calls beyond the configured `RoutingPolicy.cloud_limits`.
- Each queue item stores its stage, status, started/finished timestamps, attempt count, error category, and resumable dependency keys.
- A failed stage resumes from the next incomplete work item for that stage. Completed ingestion, extraction, OCR, local feature extraction, rule matching, provider calls, and assembly steps must not be repeated unless an invalidating version changes.

Performance targets for the prototype reference hardware (defined as: CPU Intel Core i7 12th Gen or AMD Ryzen 7, 16 GB DDR4 RAM, PCIe NVMe SSD, optional NVIDIA RTX 3060 6GB GPU for local model acceleration; CPU-only execution is supported but targets may degrade by up to 2x for local inference/OCR operations):

| Operation | Target |
|---|---:|
| Folder scan and hash registration | < 250 ms per file after file access is granted |
| Embedded text extraction | < 1 second per page |
| OCR for text-poor pages | < 5 seconds per page at normal quality |
| Local rule/example/similarity routing | < 100 ms per page after indexes are loaded |
| Review inbox initial load | < 2 seconds for 500 review items |
| Base Join generation | < 30 seconds for 50 approved documents |
| 100-page monthly batch with mature company rules | < 10 minutes on reference hardware |

## 7. Functional Requirements

### 7.1 Ingestion and page slicing

- Assign a UUID to each batch and a stable ID to each input and page.
- Enumerate the authorized folder-0 files first, then open and process only one source file at a time; do not load the complete folder contents into request memory.
- Append each completed file result atomically to the active batch so a later-file failure, pause, browser interruption, or provider outage does not erase earlier results.
- Skip unsupported files, temporary/synchronization placeholders, folders 1–15, and already registered unchanged hashes, while reporting the reason in the scan summary.
- Preserve the original bytes and original page index.
- Generate one internal page asset for every PDF page and one page asset per image.
- Record SHA-256 hashes to detect accidental duplication.
- Enforce configurable file-size, page-count, MIME-type, and batch-size limits.
- Never rely on filenames as the sole source of classification metadata.

### 7.2 Text extraction and OCR

- Extract embedded PDF text locally before calling OCR or an AI provider.
- Record extracted character count and extraction method.
- Treat a page as text-poor using a quality gate, not only a character count. The initial gate combines minimum normalized text length, text-to-page-area ratio, mojibake/garbled-character detection, PDF metadata signals such as image-only pages, and presence of fonts/text objects.
- Render text-poor PDF pages using adaptive quality: start with a lower-cost render/OCR pass, then re-render at higher DPI only when OCR confidence or extracted signal quality is below threshold.
- Prototype Windows default: Tesseract OCR with Portuguese and English language packs because it is simpler to install and package on the expected operator environment. Enhanced OCR engines such as PaddleOCR or EasyOCR may be enabled later or per installation when packaging/GPU support is available.
- The OCR adapter must expose a common result shape regardless of engine: normalized text, per-line confidence when available, bounding boxes when available, language, engine name/version, render DPI, and quality warnings. Features that require bounding boxes must degrade gracefully when the selected engine cannot provide them.
- Extract and store lightweight layout features: page dimensions, text block positions, header/footer n-grams, line count, table-like alignment, image count, and OCR confidence.
- Add table-aware extraction where feasible. Payslip, bank-statement, IRS, DMR, and accounting-posting documents should expose detected columns/rows as structured hints for heuristics and prompts instead of flattening all text into one string.
- Decouple OCR from classification. For scanned documents, run local OCR first and classify from OCR text/layout features using rules, heuristics, text-only local models, or cloud text models before considering any vision model.
- Prefer text-to-text classification whenever embedded/OCR text is usable. Local vision models are reserved for pages where text extraction/OCR is insufficient, layout evidence is essential, or the operator explicitly reprocesses with visual inspection.
- Permit explicitly selected local or cloud vision fallback only when local OCR/text classification fails or the document is visually ambiguous and the operator has enabled remote vision processing when cloud is involved.
- Keep original text and OCR text separately in the audit record.

### 7.3 Classification taxonomy

Every logical document has a `document_domain` of `RECURSOS_HUMANOS`, `INVESTIMENTOS`, or `UNKNOWN`. Its `document_type` must be one of the following ordered types.

#### Recursos Humanos

| Order | `document_type` | Folder name and classification guidance |
|---:|---|---|
| 1 | `RH_RECIBO_VENCIMENTO` | Recibos de Vencimento; indicators include Vencimento Base, Abonos, Descontos, Líquido a Receber and Mês de. |
| 2 | `RH_LANCAMENTO_CONTABILISTICO` | Lançamentos contabilísticos de pessoal, especially accounts 631 through 635. |
| 3 | `RH_COMPROVATIVO_TRANSFERENCIA_VENCIMENTO` | Comprovativos de transferência dos vencimentos. For a batch payment, the detailed batch listing is required. |
| 4 | `RH_EXTRATO_BANCARIO_VENCIMENTO` | Bank statement pages showing payment of salaries. |
| 5 | `RH_COMPROVATIVO_TRANSFERENCIA_SUBSIDIO_ALIMENTACAO` | Proof of meal-allowance transfer or card loading. For a batch, the detailed batch listing is required. |
| 6 | `RH_EXTRATO_BANCARIO_SUBSIDIO_ALIMENTACAO` | Bank statement pages showing payment of meal allowance. |
| 7 | `RH_DMR_SS_RESUMO` | Social Security DMR summary or guide. |
| 8 | `RH_DMR_SS_DETALHE` | Detailed Social Security DMR. |
| 9 | `RH_GUIA_IRS` | IRS payment guide. |
| 10 | `RH_LISTAGEM_IRS` | Monthly IRS listing covering all employees of the company. |
| 11 | `RH_COMPROVATIVO_PAGAMENTO_SS` | Proof of Social Security payment. |
| 12 | `RH_COMPROVATIVO_PAGAMENTO_IRS` | Proof of IRS payment. |
| 13 | `RH_EXTRATO_BANCARIO_IMPOSTOS` | Bank statement pages showing Social Security and/or IRS settlement. |

#### Investimentos

| Order | `document_type` | Folder name and classification guidance |
|---:|---|---|
| 1 | `INV_FATURA_ORIGINAL` | Original supplier invoice or equivalent invoice document. |
| 2 | `INV_LANCAMENTO_CONTABILISTICO_FATURA` | Accounting posting for the invoice. |
| 3 | `INV_EXTRATO_FORNECEDOR` | Supplier account statement. |
| 4 | `INV_COMPROVATIVO_TRANSFERENCIA_PAGAMENTO` | Transfer/payment proof for the invoice. |
| 5 | `INV_EXTRATO_BANCARIO_PAGAMENTO_FATURA` | Bank statement page showing payment of the invoice. |
| 6 | `INV_AMORTIZACAO_FICHA_IMOBILIZADO` | Depreciation schedule or fixed-asset record. |
| 7 | `INV_ORCAMENTO` | Supplier quotation or budget supporting the investment. |
| 8 | `INV_FATURA_NAO_PAGA` | Invoice that has not yet been paid. |

`UNKNOWN` is the fallback type for either domain. The earlier generic categories may be accepted in source metadata during migration but cannot be filed as approved without resolving to a canonical type first.

Heuristics provide hints and deterministic fallbacks; they do not bypass schema validation or confidence rules.

### 7.4 Strict classification contract

Each page must produce an object equivalent to:

```json
{
  "schema_version": "1.0",
  "page_id": "uuid",
  "page_index": 1,
  "confidence_score": 0.95,
  "metadata": {
    "document_domain": "RECURSOS_HUMANOS",
    "document_type": "RH_RECIBO_VENCIMENTO",
    "target_month": "01",
    "target_year": "2026",
    "target_quarter": "1T_2026",
    "entity_name": "AGIX, LDA",
    "employee_name": "Alberto Gil e Sá Rolo",
    "corporate_tax_id_nif": "513256180",
    "employee_tax_id_nif": "238481182",
    "document_date": "2026-01-31"
  },
  "is_continuation_of_previous_page": false,
  "evidence": ["Recibo de Vencimento", "Mês de Janeiro 2026"],
  "warnings": []
}
```

Validation rules:

- `confidence_score` is between 0 and 1.
- Year is four digits and month is `01` through `12` or `null`.
- `target_quarter` is derived deterministically from the approved month and year using `1T` through `4T`; the model suggestion is not authoritative.
- The document type must belong to the selected document domain.
- Portuguese NIF fields contain exactly nine digits or `null`.
- `document_date` is ISO `YYYY-MM-DD` or `null`.
- Evidence contains short source indicators and must not invent text.
- Missing information is represented by `null`, never fabricated.
- Unknown or conflicting types resolve to `UNKNOWN` and enter review.

Corporate and employee NIFs are separate fields. They must never overwrite one another.

When document-level classification is executed (e.g. sending a multi-page document prompt to an LLM), the returned document-level metadata (domain, type, target period, entity, NIFs) is mapped back to individual page-level schema objects for all pages belonging to that document. The first page is marked with `is_continuation_of_previous_page: false`, and all subsequent pages in the document are marked with `is_continuation_of_previous_page: true`. Every page retains its unique `page_id` and `page_index` within the source file.

#### 7.4.1 Confidence model

Provider confidence alone is not authoritative. The application must calculate a normalized final confidence score using the same formula for every provider and every deterministic path.

The MVP confidence formula is:

```text
final_confidence =
  clamp01(
    0.30 * type_confidence +
    0.20 * entity_confidence +
    0.15 * period_confidence +
    0.15 * evidence_confidence +
    0.10 * boundary_confidence +
    0.10 * source_quality_confidence +
    rule_adjustment +
    example_adjustment -
    conflict_penalty -
    missing_required_field_penalty
  )
```

Where:

| Component | Initial scoring rule |
|---|---|
| `type_confidence` | Highest of approved rule match, category-example similarity, deterministic taxonomy match, or provider type confidence. |
| `entity_confidence` | `1.0` for exact approved company/NIF match; `0.8` for approved alias; `0.5` for name-only match; `0` for missing/conflicting entity. |
| `period_confidence` | `1.0` for explicit month/year text matching workspace; `0.8` for validated document date-derived period; `0.5` for filename-only hint; `0` for missing/conflict. |
| `evidence_confidence` | Ratio of required short evidence signals found for the proposed document type, capped at `1.0`. |
| `boundary_confidence` | `1.0` when boundary signals agree; `0.6` when continuation is inferred; `0` when page/document boundary conflicts require review. |
| `source_quality_confidence` | `1.0` for good embedded text; `0.8` for good OCR; `0.5` for poor OCR/visual-only; `0` for unreadable/corrupt source. |
| `rule_adjustment` | Approved company-rule boost or reduction, initially between `-0.15` and `+0.15`. |
| `example_adjustment` | Approved reference/category-example boost, initially between `0` and `+0.10`; it may not override conflicts. |
| `conflict_penalty` | `0.20` per major conflict, capped at `0.60`. |
| `missing_required_field_penalty` | `0.15` per missing required field for the proposed filing action, capped at `0.45`. |

Decision thresholds:

- `final_confidence >= 0.90` and no blocking validation errors: eligible for automatic approval (no review needed, unless in guided learning mode).
- `0.75 <= final_confidence < 0.90`: classified but visible for spot-check or guided approval (optionally in review inbox, but pre-approved unless rejected).
- `final_confidence < 0.75`, `UNKNOWN`, schema failure, missing required period/entity/type, or major conflict: review required (enters review inbox and is not eligible for automatic filing).

Every classification attempt must store each component score, adjustments, penalties, final confidence, and the decision threshold that was applied.

### 7.5 Guided funnel for initial learning

The system shall support a bottom-up learning model for new companies, new layouts, and low-history situations.

#### Stage 1 - Characteristic-based clustering

- Before final classification is trusted, the system should cluster files that appear related using filename hints, OCR/vector text, layout similarity, issuer names, employee names, repeated keywords, and recurring visual markers.
- Clustering must be attempted locally before an LLM call. Acceptable MVP techniques include deterministic fingerprints, normalized text n-grams, header/footer similarity, filename-code similarity, page-count similarity, document-code hints, and layout signatures. A neural network is not required for the MVP unless a later implementation chooses a local embedding model.
- If local embeddings are introduced, they must run locally by default, store only privacy-safe vectors/metadata, be versioned, and be invalidated when extraction/OCR/rule versions change.
- Initial clusters are candidate groups only and must not be treated as approved filing results by themselves.
- The UI must clearly distinguish `cluster suggestion`, `classified`, `review required`, and `approved`.
- For the prototype MVP, unsupervised clustering is optional and should not block the core workflow. The default MVP learning path is simpler: keyword heuristics -> reference/category template fingerprinting -> LLM fallback -> human review.
- The MVP operator-facing states should be `Auto-classified`, `Needs review`, `Approved`, and `Passed`. `Cluster suggestion` may appear later as an advanced diagnostic or fast-mode aid, not as a required first-version UI state.

#### Stage 2 - Human-guided funnel

- During the first learning cycle, the operator is the primary source of truth.
- The operator must be able to confirm or adjust:
  - which files belong to the same group;
  - which month and year the group belongs to;
  - which canonical folder or document type is correct;
  - whether the approved upload represents a reference `Base Join` or reference `Final Join`.
- For difficult examples, the operator must be able to add simple human guidance such as `this is folder 7`, `this page starts the IRS guide`, `this block is the transfer proof`, or `ignore this bank footer`. The system stores these as audited, privacy-safe rule proposals rather than raw document content.
- The review UI must make this decision in-page using the protected preview and extracted/OCR text, so the operator can decide without downloading the input file.
- Manual validation in this stage feeds later rule suggestions, but must never silently rewrite canonical PRD rules.

#### Stage 3 - Reference example intake

- This is the first recommended action shown for a new company, before the monthly classification upload.

- The product must provide two explicit reference actions:
  - `Upload Base Join as reference`
  - `Upload Final Join as reference`
- Each action must accept multiple reference PDFs for the same company. Multiple examples are preferred because they let the system compare common structure against month-specific or employee-specific differences.
- A validated reference Base Join may be used as a structural example for expected monthly evidence composition and ordering.
- A validated reference Final Join may be used as a structural example for employee-level final assembly, dependency checks, and naming behavior.
- When two or more Base Join or Final Join examples exist, the system must compare them to identify stable signals such as repeated headers, canonical section order, recurring document-code transitions, separator pages, page-count ranges, and which content varies by employee/month.
- The UI must show the stored example count by kind, the last analyzed date, and whether the rule profile was derived from one example or from multiple compared examples.
- Reference uploads are examples for learning and comparison; they do not replace the requirement to validate current-month evidence and dependencies.
- Extract only a privacy-safe structural profile: canonical document codes, ordering signals, generic layout/text hints, employee-specific versus company-wide behavior, page count, and confidence. Full names, NIFs, IBANs, values, and copied document text must not be written into learned rules.
- After the structural profile and SHA-256 provenance are validated, delete the temporary reference PDF. The UI stores no downloadable reference copy and offers no download action for the uploaded example.
- Later classification receives the approved structural profiles, not only the reference filename or hash.
- If one or both examples do not exist, the operator may explicitly continue in guided mode; the UI explains that more human validation will be required.

#### Stage 3B - Category-level examples

- The operator may optionally upload or mark one or more approved examples for each canonical folder/document type, especially folders 1-13 for Recursos Humanos.
- Category-level examples are used for local similarity comparison before model calls. They should help identify recurring document families such as payslips, accounting postings, transfer proofs, bank extracts, DMR summaries, IRS guides, and payment proofs.
- For MVP implementation, category-level examples should be represented as structural template fingerprints rather than unsupervised clusters. A template fingerprint includes page count range, required/optional keyword profile, header/footer n-grams, layout signature, table hints, and known exclusions.
- Category examples follow the same privacy rules as join references: store structural fingerprints, short redacted hints, hashes, page-count ranges, and approved labels; do not store full extracted text, personal data, banking data, or downloadable source copies.
- If an example was created from a reviewed folder-0 document, the operator must explicitly approve storing it as a category example. Approval creates a rule proposal first; activation requires the normal rule approval flow.

#### Stage 4 - Bottom-up rule construction

- The application should evolve from approved examples first, then repeated validated patterns, then stronger company-specific rules.
- Early automation should be conservative. When approved history is limited, the product should prefer guided review over forced automatic filing.
- Over time, repeated approved examples may strengthen company JSON rules, confidence adjustments, cluster matching, month inference, and reference comparison for future months.
- The routing decision should follow this order: exact content-hash cache, approved company rules, approved category/reference-example similarity, local OCR/text heuristics, local Ollama when available, cloud LLM fallback only for unresolved cases, then human review.
- The audit trail must record why an LLM was or was not called, including rule ID, example match ID, similarity score, confidence, and whether the call was avoided.
- This learning flow must improve speed and consistency without bypassing review, evidence completeness, or canonical filing controls.

#### 7.5.1 RoutingPolicy runtime contract

The narrative routing rules above must be implemented as a typed configuration object. The MVP starts with one global default policy and may later allow company/project overrides through approved rule versions.

```ts
type RoutingPolicy = {
  schema_version: '1.0'
  mode: 'guided_learning' | 'standard' | 'benchmark'
  thresholds: {
    auto_approve: number
    classify_without_llm: number
    send_to_local_llm: number
    send_to_cloud_llm: number
    force_review_below: number
    example_similarity: number
    cluster_similarity: number
    min_text_chars: number
  }
  enabled_layers: {
    content_hash_cache: boolean
    approved_company_rules: boolean
    reference_examples: boolean
    category_examples: boolean
    deterministic_heuristics: boolean
    local_ocr: boolean
    local_ollama: boolean
    cloud_groq: boolean
    cloud_gemini: boolean
    human_review: true
  }
  cloud_limits: {
    require_batch_consent: true
    max_cloud_calls_per_batch: number
    max_cloud_calls_per_file: number
    stop_on_rate_limit: boolean
  }
  fast_mode: {
    enabled_for_mature_companies: boolean
    required_recent_accuracy: number
    required_min_approved_documents: number
    high_confidence_prompt_top_k: number
  }
  batching: {
    allow_document_level_prompts: boolean
    max_pages_per_document_prompt: number
    cluster_spot_check_ratio: number
    bulk_approve_similarity: number
  }
  learning: {
    propose_rules_from_manual_review: boolean
    require_rule_approval_before_reuse: true
    allow_category_example_creation: boolean
    allow_reference_example_creation: boolean
  }
}
```

Initial MVP defaults:

```json
{
  "schema_version": "1.0",
  "mode": "guided_learning",
  "thresholds": {
    "auto_approve": 0.9,
    "classify_without_llm": 0.85,
    "send_to_local_llm": 0.5,
    "send_to_cloud_llm": 0.5,
    "force_review_below": 0.75,
    "example_similarity": 0.82,
    "cluster_similarity": 0.72,
    "min_text_chars": 80
  },
  "enabled_layers": {
    "content_hash_cache": true,
    "approved_company_rules": true,
    "reference_examples": true,
    "category_examples": true,
    "deterministic_heuristics": true,
    "local_ocr": true,
    "local_ollama": true,
    "cloud_groq": false,
    "cloud_gemini": false,
    "human_review": true
  },
  "cloud_limits": {
    "require_batch_consent": true,
    "max_cloud_calls_per_batch": 25,
    "max_cloud_calls_per_file": 2,
    "stop_on_rate_limit": true
  },
  "fast_mode": {
    "enabled_for_mature_companies": true,
    "required_recent_accuracy": 0.95,
    "required_min_approved_documents": 100,
    "high_confidence_prompt_top_k": 3
  },
  "batching": {
    "allow_document_level_prompts": true,
    "max_pages_per_document_prompt": 8,
    "cluster_spot_check_ratio": 0.15,
    "bulk_approve_similarity": 0.92
  },
  "learning": {
    "propose_rules_from_manual_review": true,
    "require_rule_approval_before_reuse": true,
    "allow_category_example_creation": true,
    "allow_reference_example_creation": true
  }
}
```

Routing has two phases: batch preprocessing and per-item routing.

Batch preprocessing runs after ingestion/extraction/features and before provider calls:

1. Reuse valid content-hash cache entries for unchanged files/pages where dependency versions match.
2. Compute structural fingerprints for all remaining pages/documents in the batch.
3. Run pre-boundary detection to form candidate logical documents before model calls.
4. Compare the batch against approved reference/category templates and known company rules.
5. Group similar unresolved pages/documents into candidate clusters for spot-check or bulk decisions.
6. Run batch-level anomaly checks for outlier type, entity, period, duplicate, and missing-evidence signals.

Per-item routing then runs for each unresolved page, candidate logical document, or representative cluster sample:

1. If preprocessing found a valid cache result, reuse it and record `decision_source: "cache"`.
2. Evaluate approved company rules. If final confidence is at least `classify_without_llm` and no blocking validation error exists, classify without LLM and record `decision_source: "company_rule"`.
3. Compare against approved reference and category templates. If similarity is at least `example_similarity` and final confidence is at least `classify_without_llm`, classify without LLM and record `decision_source: "template_similarity"`.
4. Apply deterministic OCR/text heuristics. If final confidence is at least `classify_without_llm`, classify without LLM and record `decision_source: "heuristic"`.
5. If the item belongs to a strong unresolved cluster, classify representative samples first and apply the result to the cluster only when spot-check confidence and similarity meet policy thresholds.
6. If a likely logical document has multiple pages and policy allows it, use one document-level prompt rather than one prompt per page.
7. If local Ollama is enabled and final confidence is below `classify_without_llm` but at least `send_to_local_llm`, call Ollama with the smallest prompt strategy that fits the uncertainty.
8. If cloud provider is enabled, consent is present, limits are not exceeded, and the item is still unresolved, call the selected cloud provider.
9. If confidence remains below `force_review_below`, any blocking validation error exists, or provider/rate-limit failure occurs, create a review item.

Every routing decision must persist: evaluated layers, thresholds used, scores, selected action, skipped layers with reason, provider called or avoided, token estimate, and whether a rule proposal was created.

#### 7.5.2 Mature-company fast mode

A company is eligible for fast mode when recent approved history demonstrates stable accuracy. Initial eligibility requires at least 100 approved documents and at least 95% observed accuracy over the last three closed months or equivalent approved batches.

Fast mode changes routing, not compliance:

- Exact cache, approved rules, category examples, reference examples, and local similarity are used aggressively before any LLM call.
- High-confidence documents use a reduced candidate set, initially the top three likely document types, instead of the full taxonomy prompt.
- Similar clusters can be bulk-approved only after representative samples are approved and no anomaly is detected.
- Fast mode is disabled automatically when anomaly rate, review corrections, missing evidence, or rule conflicts exceed configured thresholds.
- Fast mode never bypasses required evidence, review of blocking conflicts, Base Join dependencies, Final Join dependencies, or manifest reconciliation.

#### 7.5.3 Batch-level anomaly detection

After initial classification/routing, the system must evaluate the batch as a whole before filing:

- flag outlier document types in a batch dominated by another family;
- flag period drift when documents unexpectedly point to different months/years;
- flag company/entity mismatch inside one Monthly Workspace;
- flag duplicate or near-duplicate documents using exact hash, normalized-text similarity, and optionally perceptual hash;
- flag missing expected evidence when a learned company pattern normally includes it.

Anomalies create review warnings with clear explanations and the affected documents.

### 7.6 AI provider gateway

- Use local Ollama as the default local provider through `http://127.0.0.1:11434`. Prefer a fast text-instruction model for OCR/extracted text classification, initially a hardware-appropriate Llama/Qwen text model. Use Qwen3-VL or another local vision model only when OCR/text is insufficient or visual layout is essential. For local Ollama vision calls, send the page image as a Base64-encoded string in the `images` field to the `/api/chat` or `/api/generate` endpoint.
- Use Google Gemini as the approved cloud test/benchmark provider behind the same internal provider interface, initially with the configured `gemini-2.5-flash` model. Model names remain configuration because provider availability and free-tier terms can change.
- Support Groq as a second cloud prototype provider through its OpenAI-compatible API, initially with the configurable `meta-llama/llama-4-scout-17b-16e-instruct` model when available. When both development keys exist, the prototype may prefer Groq only when the UI clearly displays the active provider.
- The prototype UI and review screen must not display stale provider names. If Groq is the active provider, all badges, review messages, errors, audit rows, and activity text must say Groq; Gemini wording appears only when Gemini is actually configured and selected.
- For Groq, extract embedded PDF text locally before transmission. Send JPG/PNG files through the configured vision model. A scanned PDF with insufficient embedded text must enter OCR/review rather than being misrepresented as successfully inspected.
- Gemini test mode may process only synthetic, anonymized, or properly redacted documents unless a documented privacy review explicitly authorizes real personal data.
- The application must never fall back from local rules/Ollama to Gemini or Groq automatically. Cloud processing requires an explicit provider choice and consent for the current batch.
- The provider gateway is the last automated reasoning layer, not the first. It receives only unresolved pages/documents after cache, approved rules, reference/category-example comparison, and deterministic heuristics have been attempted.
- Provider and model are configured through environment variables and batch settings. The application checks that Ollama is reachable and that the configured model is installed before starting a batch.
- Gemini and Groq calls are made only by the trusted Electron main/server process. API keys must never be sent to renderer/browser code or included in prompts, URLs, JSON rules, logs, audit manifests, or telemetry.
- Prefer locally extracted/OCR text. Render and send a page image to a vision model only after text-first routing fails or when the selected prompt strategy requires visual evidence.
- Force structured JSON/schema output through Ollama's `format` field or equivalent grammar/JSON-schema mode when available, Gemini structured output, or Groq JSON mode, then validate every result again with Zod. Regex JSON extraction/repair is a fallback for providers that cannot enforce structured output, not the normal path.
- Use versioned prompt strategies selected by RoutingPolicy:
  - `minimal_candidate_prompt` for high-confidence unresolved items, including only top candidate types, top rule/example signals, and the required schema;
  - `full_taxonomy_prompt` for genuinely uncertain items, including the relevant canonical taxonomy, company rules, reference/category hints, and explicit Portuguese evidence guidance;
  - `document_level_prompt` for likely multi-page logical documents, returning one document classification plus page-continuation flags;
  - `repair_prompt` only for schema-invalid provider output when safe repair cannot be done deterministically.
- Include the schema version and prompt version in every audit record.
- Track prompt strategy, prompt version, estimated tokens, actual usage when available, latency, and correction outcome so the system can compare accuracy/cost by document type.
- Record the provider, model, latency, JSON-validity result, and classification outcome per page so Ollama, Gemini, and Groq can be compared on the same anonymized corpus.
- Do not hard-code a specific model as permanently available; validate configured model availability at batch start.

### 7.7 Rate limiting, retry, and resilience

- Default to one active Ollama inference request at a time to prevent local memory exhaustion; make concurrency configurable by hardware profile.
- For optional cloud providers, serialize requests and use a provider-specific configurable request interval; start at 3 seconds for Groq and 8 seconds for Gemini free-tier testing.
- Retry 429 and transient 5xx responses using exponential backoff with jitter.
- Respect provider retry headers when supplied.
- Default to three retries, after which the page enters review with an API failure reason.
- Use request timeouts and cancellation through `AbortController`.
- Store checkpoint state after every page.
- Resuming a batch must not repeat completed provider requests unless explicitly requested.

### 7.8 JSON extraction and repair

- Remove Markdown fences and conversational prefixes/suffixes.
- Extract the first balanced JSON object without relying on a greedy regular expression.
- Parse and validate with Zod.
- Permit safe normalization of known variants, including numeric confidence strings and enum casing.
- For cloud reference-analysis responses, permit audited normalization of section arrays into one bounded structural-summary string, structured hint objects into bounded hint strings, and booleans wrapped in arrays/objects into canonical boolean/null fields. Apply privacy redaction before storing normalized content in company rules.
- Never silently invent required metadata during repair.
- Store the raw response, repaired response, validation result, and repair actions.
- Route irreparable responses to manual review.

### 7.9 Logical document boundaries

The system must run a fast pre-boundary pass before expensive classification when possible. The pre-boundary pass uses layout similarity, source page order, header/footer changes, document-code patterns, repeated employee/entity/period signals, and page-number/continuation hints to form candidate logical documents. Candidate boundaries are not final until validated by classification and/or review.

The LLM must not be the sole authority for document boundaries. Provider output may supply a continuation hint, but final boundary reconstruction is deterministic post-processing over source order, type, entity/NIF, period, page-number hints, text density, and layout continuity.

A new logical document begins when any of the following applies:

- `is_continuation_of_previous_page` is `false`;
- document type changes relative to the previous page;
- corporate NIF changes;
- employee NIF changes for an employee-specific record;
- entity or target accounting period changes;
- the page is the first page in the batch.

Conflicting signals must create a review warning. Operators must be able to split a logical document before a selected page or merge adjacent units.

For likely multi-page documents, classification should operate at logical-document level rather than isolated page level when the selected provider and prompt strategy support it. The result still stores page-level provenance and continuation flags.

### 7.10 Entity and accounting-period grouping

- Operational composite key: Program ID + Project ID + Company ID + target year + target month.
- Classification may initially identify a company using normalized entity name and corporate NIF, but filing must resolve that company to the selected Program/Project membership before approval.
- Prefer corporate NIF as the stable entity identifier when available.
- Normalize whitespace, punctuation, casing, and common legal suffix variants for matching while preserving the extracted display name.
- Do not automatically merge entities with conflicting non-null corporate NIFs.
- Missing entity or period information places the logical document in the review inbox.
- Document date and accounting period must remain distinct. Category-specific rules determine which becomes the target period.

### 7.11 Compliance sorting

Within each composite group, logical documents are first separated by `document_domain`, then ordered by the canonical order defined in section 7.3: positions 1 through 13 for Recursos Humanos and positions 1 through 8 for Investimentos. `UNKNOWN` always appears last and cannot be filed as approved without an operator selecting a canonical type.

Within the same category, sort by document date, employee name, source filename, and original page index. The operator may change the final order before export; overrides must be audited.

The system must also calculate an evidence-completeness checklist for each company and period. Missing categories are warnings rather than fabricated documents. The following relationships require specific checks:

- A batched salary transfer must include its batch detail.
- A batched/card meal-allowance payment must include its detailed transfer/card-loading list.
- For MVP evidence completeness, the expected employee roster for a company/month is inferred from approved folder 1 payslips. Each unique approved employee/NIF in folder 1 becomes an expected employee for employee-level checks and Comprovante Final generation.
- The monthly IRS listing must cover all employees known for that company and month, where the MVP source of truth is the approved folder 1 payslip roster unless an operator imports or approves a separate employee roster for the month.
- Later versions may support an external roster import/paste workflow. When present, the external roster becomes a cross-check against folder 1, and differences create review warnings to align the expected employee list rather than silently changing it.
- If an approved external roster contains an employee with no approved folder 1 payslip, the system creates a `missing_payslip_for_roster_employee` warning. It blocks that employee's Comprovante Final but does not block other employees' Comprovantes Finais unless the operator marks the roster as mandatory for month closure.
- If folder 1 contains an approved payslip for an employee absent from the external roster, the system creates an `unexpected_payslip_employee` review warning. The operator may add the employee to the month roster, approve an exception, or remove/reclassify the payslip.
- If a folder 1 payslip exists but the employee is on leave, terminated, or otherwise should not receive a Comprovante Final, the operator must mark a roster exception with reason. The payslip remains auditable but is excluded from Final Join generation only by explicit approval.
- Investment payment evidence should link the original invoice, accounting posting, supplier statement where applicable, transfer proof, and matching bank-statement movement.
- An unpaid invoice belongs in `INV_FATURA_NAO_PAGA` and must not be represented as having payment evidence.

### 7.12 Manual review inbox

A page or logical document enters review when:

- confidence is below 0.75 (or below 0.90 when in guided learning or spot-check mode);
- type is `UNKNOWN`;
- schema validation or JSON repair fails;
- entity, target year, or target month is missing;
- NIF, entity, date, period, or boundary signals conflict;
- OCR or provider processing fails;
- duplicate detection requires confirmation.

The inbox must provide:

- protected inline preview and source filename/page;
- a fast default excerpt containing no more than the first three pages of the current PDF; images display as one page;
- a clear `Preview available` state meaning the document can be opened directly inside the page for decision-making, not that it must be downloaded;
- extracted and OCR text;
- predicted values, confidence, evidence, and warnings;
- editable document type, entity, period, names, NIFs, date, and continuation state;
- split, merge, approve, skip, and reprocess actions;
- an optional `save as example/rule proposal` action for approved items, allowing the operator to add the item as a category example, Base Join example, or Final Join example when appropriate;
- a reason for every manual change;
- filters by batch, status, error type, confidence, entity, and period.

The preview is a review aid, not a source-download feature. It uses an authenticated, no-store endpoint, never exposes a direct filesystem path, and is removed with eligible review cache. Loading the complete source requires a separate explicit action only when the first three pages are insufficient.

No batch may be marked complete while unresolved items remain, unless the operator explicitly excludes them and records a reason.

### 7.13 Compilation and export

- Reuse `pdf-lib` for final local PDF generation.
- Preserve page dimensions, orientation, and visual quality.
- Include every approved page exactly once.
- Sanitize output filenames and avoid overwriting existing files without confirmation.
- Generate atomically using a temporary file and rename after successful validation.
- Verify the final page count against the manifest before reporting success.
- Keep rejected or unresolved pages outside the compiled PDF but listed in the batch report.

### 7.14 Usage and cost auditing

For every provider request, record:

- provider and model;
- input and output tokens;
- estimated tokens when the provider does not return usage;
- request start/end time and latency;
- retry count and final status;
- whether text or image content was sent;
- page and batch IDs.

Batch totals must include:

```text
estimated_cost =
  (input_tokens / 1,000,000 × configured_input_price_per_million)
  +
  (output_tokens / 1,000,000 × configured_output_price_per_million)
```

Pricing is configurable and timestamped because provider prices change. The report must distinguish actual free-tier spend from estimated paid production cost.

### 7.15 Folder 0 intake, classified folders, and file renaming

The application must use folder `0. A Classificar` as the common RH intake folder into which operators place all unsorted source documents:

```text
SmartComprovante/
  Classified/
    {program}/
      {project}/
        {company_name}_{corporate_nif}/
          {year}/
            Recursos Humanos/
              0. A Classificar/
              1. Recibos de Vencimento/
              ...
              13. Extrato Bancário Pagamento SS + IRS/
              14. Base Join/
              15. Final Join/
  ApplicationData/
    batches/
    manifests/
    review-state/
```

Processing rules:

- `0. A Classificar` is the unsorted RH intake inbox for the company/year and may contain documents from multiple months.
- All files the operator wants classified into RH folders 1–13 must first be placed in folder 0.
- Folders 1–13 are classification destinations and must not be scanned as new intake.
- Folders 14 and 15 are generated-output destinations and must never be scanned as classification input.
- When a batch is created, the application registers each source file and its SHA-256 hash before processing it.
- The normal UI action is `Select folder 0. A Classificar`. The browser implementation sends at most one file per classification request; the desktop implementation may pass a protected local file reference to the trusted main process instead of uploading file bytes through the renderer.
- Folder scanning is incremental and resumable. Processing file N must not require keeping files 1 through N-1 or N+1 through the end in memory, and a failure in file N must leave previous results available for review.
- Source files must not be renamed, moved, or deleted during classification.
- The default workflow is non-destructive: the original remains in folder 0 until the operator confirms that classified outputs are correct and chooses to archive or remove processed originals.
- Approved logical documents are written from folder 0 into the appropriate numbered folder 1–13 only after schema validation and operator approval requirements have been satisfied.
- Items requiring a decision remain physically in folder 0 and are represented in the application's Review inbox; they must not appear in folders 1–13.
- If the operator chooses **Pass for now**, the source remains in folder 0 and receives a persisted `PASSED` batch state plus a reason in the application manifest.
- Passing an item does not classify, approve, or silently discard it. A passed item can be returned to review later.
- When one source PDF contains multiple logical documents, the application creates one new PDF per approved logical document. It does not merely rename the original mixed PDF.
- When one logical document spans multiple source files or pages, the application creates one assembled PDF containing those pages in approved order.

Approved documents follow the shared-folder organization defined by `Esquema_Pasta_Partilhada_.pdf`. Each company has a year, domain, and domain-specific period/category hierarchy.

#### Recursos Humanos folder structure

Recursos Humanos uses the 13 numbered evidence folders from section 7.3. Each category contains month folders named `MM_YYYY`. Folders 14 and 15 are reserved generated-output folders and are not classification categories.

```text
Classified/
  {program}/
    {project}/
      {normalized_company_name}_{corporate_nif}/
        {YYYY}/
          Recursos Humanos/
            0. A Classificar/
            1. Recibos de Vencimento/
              {MM_YYYY}/
            2. Lançamentos Contabilísticos/
              {MM_YYYY}/
            3. Comprovativos de Transferência Vencimentos/
              {MM_YYYY}/
            ...
            13. Extrato Bancário Pagamento SS + IRS/
              {MM_YYYY}/
            14. Base Join/
              BJ_{YYYYMM}.pdf
              BJ_{YYYYMM}.manifest.json
            15. Final Join/
              {employee_code}/
                {YYYYMM}/
                  CF_{YYYYMM}_{employee_code}.pdf
                  CF_{YYYYMM}_{employee_code}.manifest.json
```

##### Folder 14 — Base Join

- Folder `14. Base Join` is exclusively for monthly Base Join outputs and their manifests.
- A Base Join contains the approved documents from folders 2 through 13 for one `MM_YYYY`, in their canonical numeric order.
- Folder 1 employee payslips are excluded from the Base Join because they are added separately for each employee during the Final Join.
- The default compact filename is `BJ_{YYYYMM}.pdf`, for example `BJ_202601.pdf`.
- Not every folder 2 through 13 is guaranteed to contain evidence every month. Missing folders are acceptable only when the operator explicitly confirms them as `passed/missing by approval` with a reason.
- Generation is blocked when required review items for folders 2 through 13 remain unresolved. Missing or incomplete evidence can be overridden only through an audited confirmation/pass record; the manifest must record the missing category, reason, actor, timestamp, and whether the absence affects delivery completeness.
- The Base Join manifest records every included source document/page, missing categories, passed items, explicit missing-evidence confirmations, page count, output hash, and approval history.
- During active monthly work, the Base Join should be represented first as a virtual manifest calculated from approved folders 2 through 13. A physical PDF is materialized only for preview, explicit generation, export, or month lock.
- Correcting a source document updates the virtual Base Join manifest and marks previously materialized outputs stale, but it does not immediately force regeneration of every dependent Comprovante Final.

##### Folder 15 — Final Join / Comprovante Final

- Folder `15. Final Join` is exclusively for generated employee/month outputs. `Final Join` is the internal workflow name; the Portuguese user-facing document name is `Comprovante Final`.
- A Comprovante Final contains the employee's approved folder 1 payslip first, followed by the approved folder 14 Base Join for the same `MM_YYYY`.
- The logical destination is folder 15 for the employee and month. Under the SharePoint-safe storage profile, the physical path is `15_CF/{employee_code}/{YYYYMM}/`.
- The default compact filename is `CF_{YYYYMM}_{employee_code}.pdf`, for example `CF_202601_E0042.pdf`. The UI and manifest display the full employee name; it is not required in the physical filename.
- A Comprovante Final must not be exported as current if the employee payslip is missing/unresolved or the corresponding Base Join virtual manifest is missing, failed validation, stale without operator confirmation, or belongs to a different company/month.
- A Comprovante Final may be exported with incomplete folder 2-13 evidence only when its Base Join virtual manifest contains approved missing-evidence confirmations. The export UI and manifest must clearly label it as complete-with-passed-missing-evidence rather than fully complete.
- The Comprovante Final manifest records the payslip source hash, Base Join hash, final page order, page count, and approval history.
- Operational indexes such as employee lists, batch state, and `persons.json` must be stored in the application's metadata area, not in folder 15. Folder 15 remains dedicated to Final Join deliverables.

There is one shared Base Join virtual manifest per company/month and normally multiple Comprovante Final virtual manifests—one for each employee with an approved payslip for that company/month. The Base Join is not itself an employee deliverable; it is the shared dependency reused by every Comprovante Final. Physical PDFs are materialized lazily when the operator previews, downloads, exports, or locks the month.

#### Investimentos folder structure

Investimentos is divided into calendar quarters and then the 8 numbered evidence folders from section 7.3.

```text
Classified/
  {program}/
    {project}/
      {normalized_company_name}_{corporate_nif}/
        {YYYY}/
          Investimentos/
            1T_{YYYY}/
              1. Fatura Original/
              2. Lançamento Contabilístico da Fatura/
              3. Extrato do Fornecedor/
              4. Comprovativo de Pagamento/
              5. Extrato Bancário/
              6. Amortização - Ficha de Imobilizado/
              7. Orçamentos/
              8. Faturas Não Pagas/
            2T_{YYYY}/
            3T_{YYYY}/
            4T_{YYYY}/
```

The quarter is calculated from the approved target month: January–March=`1T`, April–June=`2T`, July–September=`3T`, and October–December=`4T`.

Example classified files:

```text
PROGRAMA_ABC/
  PROJETO_001/
    AGIX_LDA_513256180/
      2026/
        Recursos Humanos/
          1. Recibos de Vencimento/
            01_2026/
              RV_202601_E0042_001.pdf
        Investimentos/
          1T_2026/
            1. Fatura Original/
              FO_202601_S0017_001.pdf
```

Filename requirements:

- Begin with the approved short document-type code from the versioned code registry.
- Include the target period as compact `YYYYMM`, a stable employee/supplier code when relevant, and a deterministic three-digit sequence only when needed.
- Do not repeat Program, Project, Company, folder description, employee name, or supplier name in the filename when those values are already represented by the containing path and metadata.
- Use the same company, period, quarter, and category represented by the containing folders.
- Remove filesystem-invalid characters and normalize repeated spaces, punctuation, and accents according to configuration.
- Preserve the original extension only when the approved logical document remains in that format; assembled page units are written as PDF.
- Never overwrite an existing file silently. If the target name exists with the same content hash, mark it as an exact duplicate. If its hash differs, increment the sequence or require operator confirmation.
- Renaming and folder placement must be derived from approved metadata, not solely from the original filename.
- Every created file must have a manifest entry mapping it back to original source filenames and page indexes.
- File creation must be atomic: write to a temporary path, validate the page count and hash, then rename it into its final location.
- If any filesystem operation fails, leave the original untouched, remove incomplete temporary files, and mark the item as a recoverable filing error.

#### SharePoint-safe compact naming profile

The SharePoint/OneDrive storage profile separates friendly display labels from compact physical names. The UI continues to show full Portuguese names, while filesystem/SharePoint paths use stable codes.

Recommended filename grammar:

```text
{DOC}_{YYYYMM}[_{ENTITY}][_{SEQ}].pdf
```

Examples:

```text
RV_202601_E0042.pdf       employee payslip
LC_202601_001.pdf         accounting posting
FO_202601_S0017.pdf       supplier invoice
BJ_202601.pdf             monthly Base Join
CF_202601_E0042.pdf       employee Final Comprovante
```

Code rules:

- `DOC` is a unique, immutable 2–5 character code mapped to the canonical document type, such as `RV`, `LC`, `FO`, `BJ`, or `CF`.
- `ENTITY` is a company-scoped stable identifier such as `E0042` for an employee or `S0017` for a supplier. It is not derived from initials alone and must remain stable after a name change.
- The full legal name, NIF, canonical category, friendly filename, original filename, and code-to-name mapping remain searchable in SQLite and the manifest.
- The company JSON may store approved aliases and entity codes, but code allocation is controlled by the application and audited to prevent duplicates.
- Codes must use uppercase ASCII letters and digits. Physical names use only letters, digits, underscore, hyphen, and the final extension; reserved/invalid characters, trailing spaces/periods, and reserved device names are rejected.
- Never solve a collision through silent truncation. If a compact name still collides, use the deterministic sequence or a short hash suffix and record the decision in the manifest.

Initial document-code registry:

| Domain/folder | Code | Friendly meaning |
|---|---:|---|
| RH 0 | `IN` | A Classificar / intake |
| RH 1 | `RV` | Recibo de Vencimento |
| RH 2 | `LC` | Lançamento Contabilístico |
| RH 3 | `TV` | Transferência de Vencimento |
| RH 4 | `EBV` | Extrato Bancário de Vencimento |
| RH 5 | `TSA` | Transferência de Subsídio de Alimentação |
| RH 6 | `EBSA` | Extrato Bancário de Subsídio de Alimentação |
| RH 7 | `SSR` | DMR Segurança Social — Resumo |
| RH 8 | `SSD` | DMR Segurança Social — Detalhe |
| RH 9 | `GIR` | Guia de IRS |
| RH 10 | `LIR` | Listagem de IRS |
| RH 11 | `PSS` | Pagamento de Segurança Social |
| RH 12 | `PIR` | Pagamento de IRS |
| RH 13 | `EBI` | Extrato Bancário de Impostos |
| RH 14 | `BJ` | Base Join mensal |
| RH 15 | `CF` | Comprovante Final |
| Investimentos 1 | `FO` | Fatura Original |
| Investimentos 2 | `LCF` | Lançamento Contabilístico da Fatura |
| Investimentos 3 | `EF` | Extrato do Fornecedor |
| Investimentos 4 | `CP` | Comprovativo de Pagamento |
| Investimentos 5 | `EB` | Extrato Bancário |
| Investimentos 6 | `FI` | Ficha de Imobilizado |
| Investimentos 7 | `ORC` | Orçamento |
| Investimentos 8 | `FNP` | Fatura Não Paga |

Compact physical folder examples for the SharePoint profile include `00_IN`, `01_RV`, `02_LC`, `14_BJ`, and `15_CF`. The UI always displays their full canonical labels. A versioned folder-code registry defines all folders 0–15 and Investimentos 1–8; changing an issued code requires an audited migration.

Path-budget requirements:

- Validate the decoded end-to-end target path, including the configured SharePoint/OneDrive sync root, before filing or export. Microsoft currently documents a 400-character decoded path limit for OneDrive/SharePoint, but the application must also respect stricter local operating-system and sync-client limits.
- Use conservative defaults of at most 80 characters per generated filename and 240 characters for the actual local target path. Permit administrators to change the safety budget only after the destination preflight verifies it.
- Show current length, configured budget, and a compact-name preview during company/shared-folder setup and before batch export.
- If the existing Program/Project/Company root consumes too much of the budget, block export and propose shorter physical folder codes without changing friendly UI names or stable IDs.
- Store original and friendly names as metadata rather than making the filesystem path carry every business description.

The operator may configure **Copy originals** or **Archive originals**. The default MVP behavior is **Copy originals**, because it is safer and preserves folder 0 until the classified output has been verified. After a batch is completed and reconciled, the operator may explicitly archive or clear successfully processed folder 0 files. Processed hashes remain registered so retained originals are not classified again.

### 7.16 Hierarchical navigation, Company Year Workspace, and Monthly Company Workspace

The user interface must make Program -> Project -> Company navigation the primary way to locate work. Raw filesystem paths and internal IDs are secondary details and must not be the main navigation model.

#### Primary navigation

The persistent application navigation contains:

1. Dashboard
2. Programs
3. Projects
4. Companies
5. Review
6. History
7. Settings

Selecting a Program reveals its Projects; selecting a Project reveals its participating Companies. The current scope is always visible as a breadcrumb:

```text
Program ABC / Project 001 / AGIX, LDA / 2026 / January
```

Requirements:

- Preserve the selected Program, Project, Company, year, and month when the user moves between Year overview, Inbox, Review, Base Join, and Comprovantes Finais screens.
- Support direct links/bookmarks to a specific Monthly Company Workspace.
- Support direct links/bookmarks to a Company Year Workspace showing all 12 months.
- Permit searching Programs, Projects, and Companies by name, code, NIF, or alias.
- Show archived Programs, Projects, or Companies only when the user explicitly enables an archived filter.
- Prevent ambiguous filing when the same company participates in multiple projects by requiring an active Project context before approval.
- Allow authorized users to create, edit, archive, and restore Programs, Projects, Companies, and company-project memberships without editing JSON or folders manually.

#### Company Year Workspace

After selecting a Company and Year, the default landing view is the Company Year Workspace. It shows the 12 months for the selected year and lets the operator decide which month or months to process.

The Year Workspace must show:

- company name, NIF, Program, Project, and selected year;
- 12 month cards from January through December;
- each month's folder 0 pending count, review count, evidence completeness, Base Join state, Comprovante Final state/count, and last updated timestamp;
- actions to `Open month`, `Classify selected months`, `Generate selected months`, and `Export selected months`;
- filters for months with pending files, review required, ready Base Join, ready Comprovantes Finais, stale outputs, or completed delivery;
- a clear indication when a month has not yet been created/configured versus when it exists but has no files.

Multi-month actions must process months independently with separate manifests and status. A failure or review blocker in one month must not silently block unrelated months unless the operator explicitly requested an all-or-nothing year export.

#### Monthly Company Workspace

The Monthly Company Workspace is opened from one of the 12 month cards. In this context, **monthly receipts/documents** means the complete monthly evidence set for the company, including folders 1–13, not only folder 1 payslips.

The workspace must show:

- company name, NIF, Program, Project, year, and selected month;
- previous-month and next-month navigation plus a 12-month selector;
- folder 0 pending count and a clear **Classify documents** action;
- folder 1–13 document counts, approval state, missing evidence, and review warnings;
- a monthly completeness indicator that never hides which categories are missing;
- Base Join status: `NOT_READY`, `READY`, `GENERATING`, `CURRENT`, `STALE`, or `FAILED`;
- Comprovante Final status and count by employee (`Final Join` may remain the internal/API name);
- last scan, last classification, last approval, and last join timestamps;
- direct access to page/document preview, source provenance, and final filesystem location.

A recommended monthly layout is:

```text
[Company and month header]
[Folder 0 pending] [Review required] [Completeness] [Base Join status]

Folders 1–13 monthly evidence matrix

Base Join panel
Comprovantes Finais employee panel
Recent activity
```

#### Cross-scope dashboard

The Dashboard summarizes work across the hierarchy without mixing contexts:

- Programs and Projects with active work;
- Companies with documents waiting in folder 0;
- company/month workspaces blocked by review or missing evidence;
- Base Joins ready to generate or currently stale;
- Comprovantes Finais ready, stale, failed, or missing employee payslips;
- processing failures and Ollama availability.

Every dashboard count must be clickable and open the filtered records that produced it.

#### Navigation and filing safeguards

- Every approval, move, rename, Base Join, and Comprovante Final confirmation displays the destination Program, Project, Company, and month.
- Switching Company or Project while unsaved review changes exist requires confirmation.
- The UI must never infer a different Program or Project solely from document text.
- If extracted company metadata conflicts with the selected company, block approval and show both values for resolution.
- Moving a document to another Program, Project, Company, or month is an audited reassignment, not a silent rename.
- Empty states explain the next action, such as adding files to folder 0, reviewing uncertain documents, or generating the Base Join.

#### Monthly workspace usability acceptance criteria

- A trained operator can reach any company's current-month documents from the Dashboard in no more than three interactions.
- The user can identify pending, missing, review-required, and completed monthly evidence without opening individual files.
- The selected Program, Project, Company, and month remain visible on every filing and join screen.
- No document can be approved without an unambiguous Program, Project, Company, year, month, and canonical destination folder.
- Usability testing must cover at least one Program with multiple Projects, one Company participating in multiple Projects, and multiple Companies with documents for the same month.

### 7.17 Detailed UI screen specification

This section is normative for UI design and generated mockups. If a generated design conflicts with the workflow, category order, folder structure, or state dependencies in this PRD, the PRD rules take precedence.

#### Global application shell

- Use one consistent application shell across all screens.
- The primary sidebar contains `Dashboard`, `Programs`, `Projects`, `Companies`, `Review`, `History`, and `Settings`.
- `Batches` or `Processing Runs` appears inside the active company/month context or History; it is not the primary organizational navigation.
- The current Program, Project, Company, year, and month remain visible in a persistent breadcrumb on all classification, review, filing, and join screens.
- The header displays Ollama health using plain operational states: `Ready`, `Processing`, `Unavailable`, or `Model Missing`.
- Model name, version, and diagnostics come from runtime configuration and must never be hard-coded in the UI.
- The application language is Portuguese by default. Internal enum keys and UUIDs are available in details/diagnostics but are not the main user-facing labels.

#### Dashboard screen

The Dashboard prioritizes actionable work rather than technical batch statistics. It must show clickable counts for:

- documents waiting in folder 0;
- documents currently processing;
- documents requiring review;
- company/month workspaces with missing evidence;
- Base Joins ready, stale, failed, or blocked;
- Comprovantes Finais ready, stale, failed, or blocked;
- processing failures;
- Ollama availability.

Dashboard filters include Program, Project, Company, year, month, and operational status. Search supports Program/project codes, company name, corporate NIF, employee, supplier, original filename, and generated filename.

Metrics such as total documents processed may appear as secondary analytics. Vanity metrics, raw token counts, cloud-equivalent cost, and internal batch UUIDs must not displace operational actions.

#### Monthly Company Workspace screen

The Monthly Company Workspace is the product's central screen. Do not create separate overlapping screens named `Final Recibos`, `Employee Payroll Records`, or similar alternatives for the same company/month information.

The screen contains:

1. Program/Project/Company breadcrumb and month navigation.
2. A reference-first onboarding panel with Step 1 `Base Join model` / `Final Join model` and Step 2 `Select folder 0. A Classificar`; individual file selection is secondary.
3. Summary cards for folder 0 pending, review required, evidence completeness, and Base Join state.
4. A complete folders 1–13 evidence matrix.
5. A Base Join dependency and action panel.
6. A Comprovantes Finais employee table.
7. Recent audited activity.

The evidence matrix must show all 13 canonical Recursos Humanos categories from section 7.3 in their exact order and names. It must never report a denominator of 12. Each row displays document count, approved count, review count, missing state, and health. Selecting a row opens its documents.

The interface must distinguish:

- extraction success from classification accuracy;
- a missing category from a category that is intentionally passed;
- document count from employee coverage;
- approved evidence from merely detected evidence.

Do not display unsupported or reordered category labels. In particular, folder 2 is `Lançamentos Contabilísticos`; folders 4 and 5 retain the exact meanings defined in section 7.3.

#### Processing screen

The normal processing view shows:

- current file and page;
- processed pages versus total pages;
- active stage: ingestion, slicing, text extraction/OCR, classification, validation, or review routing;
- elapsed time and estimated time remaining;
- successful, review-required, and failed counts;
- `Pause`, `Resume`, and `Cancel` actions with clear consequences.

GPU telemetry, vLLM details, token streams, and console logs belong in a collapsed `Diagnostics` drawer. The standard operator view must not require understanding model infrastructure. Classification labels shown in the live stream use only canonical types from section 7.3, not generic examples such as `UTILITY_BILL`.

#### Manual Review screen

Use a three-pane desktop layout:

1. Review queue and filters.
2. Large page preview.
3. Metadata and actions inspector.

The queue supports filters for Program, Project, Company, month, reason, confidence, domain, type, and passed state. Queue items show the source filename/page, problem reason, proposed destination, and confidence/validation state.

The preview initially streams a protected excerpt of the first three pages to minimize latency, then supports zoom, rotate, page navigation, highlighted evidence, bounding boxes, and extracted/OCR text. Operators request additional pages only when needed, split before the selected page, or merge adjacent logical units.

The inspector contains:

- Program and Project context, read-only unless the operator starts an audited reassignment;
- Company and corporate NIF;
- domain: `Recursos Humanos`, `Investimentos`, or unresolved;
- one canonical document type valid for the selected domain;
- target month and year;
- document date;
- employee name and employee NIF when applicable;
- supplier name and supplier NIF when applicable;
- continuation/boundary decision;
- model evidence, OCR quality, warnings, and company-rule conflicts;
- proposed destination folder and generated filename preview.

Primary actions are `Approve & Next`, `Save`, `Split`, `Merge`, `Reprocess`, and `Pass for Now`. Passing requires a reason. A manual metadata correction requires an audit reason when it changes company, period, NIF, document type, or boundary. Keyboard shortcuts must exist for approve-next, pass, previous/next, zoom, and rotate.

Do not present combined or unsupported domains such as `RH / Investimentos`, `Faturação`, or `Legal & Compliance` unless a future PRD explicitly adds them. Do not present unsupported types such as `RH_CONTRATO`.

#### Base Join panel and screen

The Base Join view lists folders 2–13 individually with included page/document counts and one of: `COMPLETE`, `MISSING`, `REVIEW_REQUIRED`, `PASSED`, or `FAILED`.

- The dependency panel must never list folder 1 as a Base Join input.
- A screen showing unresolved reviews or missing unpassed evidence in folders 2–13 must display Base Join as `BLOCKED`, not `READY`, and disable generation.
- The Base Join description must state that it compiles approved evidence from folders 2–13; it must not imply that folder 1 payslips are included.

The Base Join action obeys the following state rules:

Missing or incomplete folders 2-13 do not always mean the month is wrong. If there are no unresolved review items, the UI may keep the Base Join action visible as `NEEDS_CONFIRMATION`. In that state, generation opens a confirmation dialog listing each missing/incomplete folder and requiring an operator reason. After confirmation, the virtual Base Join manifest records those folders as `CONFIRMED_MISSING` or `PASSED`, and generation/export proceeds with warnings. Unresolved review items remain truly blocked.

| Condition | Base Join state/action |
|---|---|
| Any unresolved review item in folders 2–13 | `BLOCKED`; generation disabled |
| Missing required evidence without an approved pass reason | `BLOCKED`; generation disabled |
| Dependencies approved or explicitly passed | `READY`; generation enabled |
| Generation in progress | `GENERATING`; duplicate action disabled |
| Output matches current dependency hashes | `CURRENT` |
| Any included dependency changes | `STALE`; regeneration required |
| Generation or validation fails | `FAILED`; retry and error details available |

The panel displays page count, included categories, missing/passed evidence, last generated time, output SHA-256, and a preview/inspect action. It represents one company and one month; a generic `Entities` count must not appear.

The UI must distinguish `BLOCKED` from `NEEDS_CONFIRMATION`: `BLOCKED` means unresolved review or validation failure; `NEEDS_CONFIRMATION` means the operator can intentionally proceed with missing/incomplete evidence after recording a reason.

#### Comprovantes Finais panel and screen

Comprovante Final status is displayed per employee in a table containing employee, payslip status, Base Join status, Comprovante Final status, page count, last generated time, and action. `FINAL_JOIN` remains the internal state/API term.

If the Base Join virtual manifest includes confirmed missing evidence, Comprovantes Finais may be generated/exported as `READY_WITH_WARNINGS`. The warning must be visible in the employee table, preview/export dialog, PDF/export manifest, and audit summary. This state is acceptable only when the missing evidence has an approved pass/confirmation record.

| Condition | Comprovante Final result |
|---|---|
| Employee folder 1 payslip missing or unresolved | `BLOCKED` |
| Base Join missing, blocked, failed, or stale | `BLOCKED` |
| Payslip approved and Base Join current | `READY` |
| Output matches current payslip and Base Join hashes | `CURRENT` |
| Payslip or Base Join hash changes | `STALE` |

The UI must never show Comprovantes Finais as fully ready when the Base Join is blocked or required evidence remains unresolved.

#### Export and audit screen

The export screen presents a human-readable summary before raw JSON:

- Program, Project, Company, year, and month;
- Base Join and Comprovante Final outputs separately;
- included, missing, passed, and unresolved evidence;
- page reconciliation;
- final destination paths;
- SHA-256 hashes;
- Ollama model and processing duration;
- approval history.

Raw manifest JSON is available as a secondary preview/download. The system uses SHA-256 rather than MD5. Cloud-equivalent pricing is optional diagnostic information and is not a primary success metric for local Ollama processing.

Use explicit actions such as `Gerar Base Join`, `Gerar Comprovantes Finais Prontos`, `Descarregar Comprovantes Finais`, and `Bloquear Mês`. Do not use an ambiguous `Finalizar Mês` action without explaining whether it generates files, locks changes, archives folder 0, or performs all three. Locking or archiving requires a confirmation summarizing the consequences.

#### AI provider and credential settings

- Present `Ollama local` as the default and `Groq (cloud prototype)` / `Gemini (cloud test)` as explicit alternatives; do not present cloud mode as a transparent fallback.
- Cloud provider settings provide masked key fields plus `Save encrypted`, `Test connection`, `Replace/rotate`, and `Delete` actions. There is no reveal-key action.
- Show only credential state (`Not configured`, `Stored securely`, `Invalid`, or `Secure storage unavailable`) and optional last four characters.
- Before enabling Groq or Gemini, explain that document content will leave the machine and that free-tier/provider data-use terms may differ from paid service terms. Require explicit confirmation for each batch.
- Show the active provider and model in processing and audit views, and label every cloud-processed page.
- A secure-storage failure disables cloud-provider controls with a clear resolution path while leaving local rules and Ollama available.
- The provider name must be sourced from backend configuration. Hard-coded Gemini labels must not appear when Groq is active.

#### UI status consistency

- Statuses are derived from backend state; mockups and implementation must not independently invent them.
- A missing or review-required dependency cannot coexist with a `READY` Base Join unless it has an approved pass record.
- A blocked or stale Base Join cannot coexist with ready/current Comprovantes Finais generated from it.
- Colour is never the only status indicator; every status uses text and/or an icon.
- Every summary count is clickable and opens the records behind the count.
- Destructive or irreversible actions show source and destination paths and support safe cancellation before commit.
- Activity text must reflect the real source flow: files arrive in folder 0 and are then classified into folders 1–13. It must not claim that users upload new intake directly into a destination folder.

#### MVP UI exclusions

Do not include the following in the primary MVP UI:

- always-visible model console logs;
- detailed vLLM/GPU topology and tensor-parallel telemetry;
- hard-coded model sizes or cloud providers;
- unsupported document domains or document types;
- multiple duplicate company/month dashboard screens;
- raw UUID-first navigation;
- cloud cost as a primary dashboard metric;
- notifications or full profile/team-management complexity unless multi-user operation is enabled; the minimal Operator/Administrator capabilities in section 7.26 still apply;
- decorative charts that do not lead to an operator action.

### 7.18 Product and interaction references

The following products are design and workflow references only. SmartComprovante does not depend on them and must not copy proprietary branding, assets, source code, or protected visual designs. The product should study their interaction principles and adapt them to the requirements in this PRD.

#### Paperless-ngx — local intake, archive, and search reference

Reference: <https://docs.paperless-ngx.com/>

Use as inspiration for:

- a watched/consumption directory comparable to folder `0. A Classificar`;
- non-destructive local document ingestion;
- document type, correspondent/entity, tag, and metadata organization;
- full-text search and filters;
- processing history and source-document provenance;
- local-first operation and workflow rules.

SmartComprovante must extend this pattern with Program -> Project -> Company scope, canonical folders 1–13, Base Join, and Final Join.

#### Rossum — manual validation workspace reference

Reference: <https://rossum.ai/platform/>

Use as inspiration for:

- a review queue beside a large document preview;
- editable extracted fields in a dedicated inspector;
- confidence and validation warnings connected to visible document evidence;
- fast approve-next and exception-handling workflows;
- human validation before downstream filing.

SmartComprovante's implementation remains constrained to the canonical Portuguese RH/Investimentos schema and audited local filing rules in this PRD.

#### Dext Prepare — accounting operator usability reference

Reference: <https://dext.com/uk/products/prepare>

Use as inspiration for:

- simple client/company switching;
- an inbox-first accounting-document workflow;
- plain-language processing states;
- month-oriented organization;
- clear distinction between work waiting, requiring attention, and completed.

SmartComprovante must use the Program -> Project -> Company -> Year -> Month hierarchy rather than adopting Dext's information architecture directly.

#### Nanonets — processing pipeline reference

Reference: <https://docs.nanonets.com/docs/nanonets-overview>

Use as inspiration for:

- the visible sequence upload/intake -> classify -> extract -> validate -> export;
- review routing for uncertain documents;
- configurable workflow rules;
- clear processing-stage feedback.

SmartComprovante remains local-first through Ollama and must not reproduce a cloud-first data flow by default.

#### M-Files — hierarchy and metadata-view reference

Reference: <https://www.m-files.com/platform/>

Use as inspiration for:

- Program -> Project -> Company contextual navigation;
- metadata-driven views that do not depend only on physical folders;
- representing one company in multiple project memberships without duplicating its master record;
- saved searches, filters, and context-aware document views.

Do not reproduce enterprise configuration complexity in the MVP. SmartComprovante keeps the hierarchy and monthly workflow visible and understandable to an accounting operator.

#### DocuWare — intake tray and task-filing reference

Reference: <https://docuware.com/en/document-management>

Use as inspiration for:

- a document tray comparable to folder `0. A Classificar`;
- the explicit flow intake -> index/classify -> review -> file;
- task inboxes with waiting, assigned, completed, passed, and failed states;
- destination preview and filing confirmation;
- audit history for document moves and metadata changes.

The SmartComprovante implementation must retain folder 0 as the authoritative physical RH intake and canonical folders 1–15 as defined in this PRD.

#### Azure Document Intelligence Studio — OCR evidence reference

Reference: <https://learn.microsoft.com/azure/ai-services/document-intelligence/studio-overview>

Use as inspiration only for the document-review component:

- synchronized page image and extracted fields;
- OCR bounding boxes and highlighted evidence;
- per-field confidence and validation feedback;
- structured-output/schema inspection;
- page-level navigation and visual extraction diagnostics.

Do not reproduce a developer-oriented model-training studio as the main operator experience. Local Ollama, local OCR, and the Monthly Company Workspace remain the primary product model.

#### UiPath Document Understanding — human-review lifecycle reference

Reference: <https://docs.uipath.com/document-understanding/automation-cloud/latest/user-guide/about-document-understanding>

Use as inspiration for:

- routing uncertain documents into human validation;
- explicit review assignment and exception reasons when multi-user operation is enabled;
- validation states and resumable automation after approval;
- auditability of human corrections;
- separating automated processing failures from business-validation exceptions.

The MVP should adopt the state clarity without adopting UiPath's wider automation-suite complexity.

#### Combined reference model

The intended experience combines the strongest applicable pattern from each reference:

```text
Paperless-ngx -> folder 0 intake, local archive, search and provenance
Rossum        -> three-pane manual review and validation
Dext          -> friendly company/month accounting workflow
Nanonets      -> visible document-processing pipeline
M-Files       -> Program/Project/Company hierarchy and metadata views
DocuWare      -> intake tray, task queue and confirmed filing
Azure Studio  -> OCR bounding boxes and field-level evidence
UiPath        -> human-validation and exception lifecycle
SmartComprovante -> Portuguese folders 1–15, completeness and join logic
```

Reference priority for the MVP:

1. SmartComprovante PRD rules and canonical workflow;
2. DocuWare/Paperless-ngx patterns for intake and filing;
3. Rossum/Azure Studio patterns for manual review and OCR evidence;
4. M-Files patterns for hierarchy and metadata navigation;
5. Dext patterns for accounting usability;
6. Nanonets/UiPath patterns for visible processing and exception lifecycle.

These references do not override SmartComprovante's unique requirements:

- Program -> Project -> Company hierarchical navigation;
- one Monthly Company Workspace;
- all 13 Recursos Humanos and 8 Investimentos categories;
- folder 0 as the RH intake source;
- dependency-safe folder 14 Base Join;
- employee-specific folder 15 Final Joins;
- company-specific approved rule memory;
- local Ollama processing and local filesystem outputs.

### 7.19 Company-specific rule memory

The application maintains local, versioned JSON rule memory for each company. This is retrieval/configuration supplied to Ollama during classification; it is not automatic model training.

```text
ApplicationData/rules/
  global.json
  companies/{company_id}.json
  memberships/{program_id}_{project_id}_{company_id}.json
```

Company rules may contain approved aliases, corporate NIF, filename patterns, document keywords, exclusions, known banks/suppliers/employees, period-extraction rules, previously approved examples, approved category examples, approved cluster patterns, reference `Base Join` examples, reference `Final Join` examples, local similarity fingerprints, and confidence adjustments. Project-membership rules contain only legitimate project-specific variations.

#### Automatic company-rule lifecycle

- Creating a Company automatically creates `companies/{company_id}.json` from the current validated starter template. The operator does not create or edit the file manually.
- The starter JSON is populated with the stable Company ID, legal name, corporate NIF, approved aliases, creation time, creating operator, `schema_version`, and `rules_version: 1`; optional rule collections begin empty or inherit safe global defaults by reference.
- Company creation and starter-rule creation are one atomic operation. If the JSON cannot be validated or saved, onboarding is not marked complete and the UI provides a safe retry.
- A Company may participate in several Programs or Projects while retaining one company JSON. Legitimate project-specific differences belong in separate membership JSON files and must not duplicate the company master rules.
- Renaming a Company updates its display name and aliases through a new audited rule version; the stable Company ID and rule history do not change.
- Archiving a Company preserves its JSON and history. Permanent deletion requires explicit confirmation and follows the retention policy.
- During classification, deterministic approved company rules are evaluated before the LLM. Strong matches can prefill metadata or avoid unnecessary model calls only when all canonical validation requirements are satisfied; otherwise the rules provide focused context to Ollama/Groq/Gemini.
- Approved reference examples and category examples must be compared locally before a cloud call. The system should use the comparison to classify obvious recurring layouts, identify missing evidence, and generate narrower questions for the LLM only when uncertainty remains.
- Approved corrections create reusable company-scoped signals so repeated filenames, suppliers, employees, banks, layouts, and period patterns require less manual review over time.
- The first approved examples for a company should be treated as foundational learning data. They should improve later clustering, month inference, folder suggestions, and join-reference comparison.
- Correction-to-rule pipeline:
  1. store the original features, proposed classification, corrected classification, operator, reason, and final outcome;
  2. group repeated corrections by privacy-safe pattern such as issuer, header n-grams, layout fingerprint, filename pattern, or document-code signal;
  3. after at least three consistent corrections or one administrator-marked high-value correction, create an inactive `RuleProposal`;
  4. require operator/admin approval of scope, pattern, confidence adjustment, and rollback plan before activation;
  5. monitor activated rule accuracy and flag rules whose later correction rate exceeds 10% or whose conflicts increase.
- The system records rule-hit, example-match, local-similarity, avoided-model-call, model-call, confidence, review, and correction metrics per company so optimization can be measured without storing full sensitive document content.

Minimum company-rule contract:

```json
{
  "schema_version": "1.0",
  "rules_version": 1,
  "company": {
    "company_id": "agix",
    "display_name": "AGIX, LDA",
    "corporate_nif": "513256180",
    "aliases": ["AGIX LDA", "AGIX"]
  },
  "document_rules": {
    "RH_RECIBO_VENCIMENTO": {
      "required_any": ["Recibo de Vencimento", "Vencimento Base"],
      "supporting_keywords": ["Abonos", "Descontos", "Liquido a Receber"],
      "excluded_keywords": ["Fatura", "Extrato de Conta"],
      "period_source": "payroll_month",
      "confidence_adjustment": 0.05
    }
  },
  "filename_patterns": [
    {
      "pattern": "^\\d{2}[_-]\\d{4}\\s+(.+)\\.pdf$",
      "document_type": "RH_RECIBO_VENCIMENTO",
      "employee_capture_group": 1,
      "confidence_adjustment": 0.10
    }
  ],
  "known_entities": {
    "banks": [],
    "suppliers": [],
    "employees": []
  },
  "approved_examples": [],
  "audit": {
    "created_at": "2026-06-22T00:00:00Z",
    "created_by": "operator-id",
    "change_reason": "Initial approved rules"
  }
}
```

The production schema may add typed fields, but it must preserve these versioning, company identity, rule, and audit concepts. `approved_examples` should store compact redacted signals and expected labels, not complete source documents.

Requirements:

- Canonical domains, folders, ordering, Base Join, and Final Join rules in this PRD cannot be overridden by company JSON.
- Load only the relevant validated rule subset for the active company/project and page classification.
- Rule evaluation must meet an initial target of less than 100 ms per page after rules and indexes are loaded. Pre-compile regex patterns at rule-load time and use indexed lookup for document type, known entity, filename pattern, and example-similarity searches.
- Validate rule files against a versioned Zod/JSON schema before use.
- A manual correction may propose a new rule, but it is never learned automatically.
- An operator must approve the proposed rule, scope, and reason before activation.
- Every rule change increments `rules_version`, records an audit entry, and supports rollback.
- Conflicts between global, company, project-membership, and extracted-document evidence enter review rather than resolving silently.
- Provide a friendly rule editor and change-history screen; normal users must not edit JSON manually.
- Sensitive identifiers and examples remain local and follow the retention/redaction requirements in section 10.
- API keys, access tokens, passwords, connection strings, and other secrets are forbidden in global, company, membership, example, prompt, and audit JSON.
- Company rules influence confidence and review recommendations but cannot alone authorize filing when required document evidence is absent.
- Rule precedence is canonical PRD/schema rules, then approved global rules, then company rules, then project-membership rules. A lower layer may specialize but never weaken a higher-layer safety or completeness rule.
- Classification must continue safely with canonical/global rules if a company JSON is temporarily unreadable, but filing remains blocked until the company rule state is repaired and validated.

### 7.20 Processing cache and deliverable lifecycle

The application uses a local, application-managed cross-batch cache so a file is decoded, sliced, OCR-processed, feature-indexed, and classified once per unchanged content hash and compatible dependency versions. The cache accelerates review, Base Join creation, and Final Join generation; it is not the permanent document archive.

```text
ApplicationData/cache/{batch_id}/
  sources/       temporary protected working copies
  pages/         rendered page images and split PDFs
  extraction/    OCR/text and validated classification results
  features/      layout fingerprints, table hints, pHash/text-similarity signatures
  previews/      thumbnails and UI previews
  joins/         temporary Base/Final assembly files before verification
```

Requirements:

- On intake, calculate SHA-256 and create one protected cached working copy or safe local reference. Reopening the same unchanged file reuses valid extraction, OCR, classification, and preview results instead of repeating work.
- Cache entries are keyed by source hash plus extraction version, OCR version, feature version, routing policy version, confidence model version, model/provider, prompt version, schema version, and relevant company `rules_version`. A change to any dependency invalidates only the affected derived entries.
- Template cache entries may store privacy-safe layout fingerprints and extraction strategies for recurring document families so similar future pages can reuse the best extraction path without storing full document content.
- Near-duplicate detection should compare exact hashes, normalized extracted/OCR text, layout fingerprints, and optionally perceptual hashes. Potential duplicates enter review unless already explained by an approved batch rule.
- Recovery state is stored per work item and stage: ingestion registered, pages sliced, text extracted, OCR completed/skipped, features computed, routed, provider attempted, classified, reviewed, filed, assembled, exported. Resuming a batch continues at the first incomplete stage and does not repeat completed work unless an invalidating version changes.
- Cache writes are atomic, access is restricted to the current operating-system user, and cached personal data follows the same redaction and security requirements as source documents.
- Folder 14 Base Join is a durable monthly company output. Folder 15 Comprovantes Finais are the primary downloadable employee deliverables.
- Uploaded folder-0 sources and uploaded Base/Final reference examples are inputs, not downloadable application outputs. The UI does not add download actions for them; only generated/approved deliverables, authorized evidence exports, and audit manifests are downloadable.
- Reference-join PDFs exist only in protected request memory or temporary cache while their structural profile is extracted. After successful validation, retain the hash, page count, privacy-safe profile, rule version, and approval audit, then delete the temporary binary copy.
- A Comprovante Final may be downloaded individually or as a ZIP containing all current employee outputs for the selected company/month. The ZIP contains deliverables and a human-readable summary, not cache files or secret/internal metadata.
- After the Base Join and all requested Comprovantes Finais are generated, hash-validated, page-reconciled, and safely written, temporary pages, OCR images, previews, model responses, and assembly files become eligible for automatic cleanup.
- Cleanup must never delete folder 14, folder 15, manifests required for provenance, active review items, failed/recoverable batch data, or files needed by a pending generation job.
- Source originals and classified folders 1–13 are not cache. The default policy retains or archives them until the configured legal/business retention period expires. An authorized operator may select `Delete source evidence after verified final delivery`, but only after an explicit warning that regeneration and visual audit may become impossible.
- Before source-evidence deletion is permitted, create and verify a restorable backup or evidence export in a separately configured destination. A hash or manifest without the underlying document is not a recoverable backup.
- If source evidence is deleted under that policy, retain the minimal non-document audit record: hashes, original names, classification, source-to-output page mapping, approvals, deletion actor/time/reason, Base Join hash, and Final Join hashes.
- Automatic cleanup runs after successful delivery, on application startup for expired entries, and through a manual `Clear safe cache` action. It must support configurable age/size limits and least-recently-used eviction of only eligible entries.
- Display cache size, last cleanup, reclaimable space, retention policy, and protected/non-eligible data clearly in Settings. `Clear safe cache` must explain that generated deliverables remain available.

### 7.21 Local document-data protection

Protecting the API key is insufficient because payroll, tax, banking, OCR, rules, and metadata are themselves sensitive.

- Restrict application-data, cache, database, rule, backup, and output directories to the authorized operating-system user and explicitly configured shared-folder identities.
- Require an encrypted operating-system volume or approved enterprise encrypted storage for production. If SQLite/application-level encryption is enabled, its key must be kept in the operating-system secret store and separated from the database.
- Do not copy document content to the clipboard, temporary OS folders, crash dumps, telemetry, or unprotected preview locations by default.
- Clear sensitive previews when the user signs out, locks the app, changes company scope, or the inactivity timeout expires.
- Use authenticated IPC with a strict allowlist and context isolation. The Electron renderer must not have direct filesystem, shell, secret-store, or unrestricted Node access.
- Provide a privacy-safe diagnostic export that excludes document bodies, page images, credentials, personal identifiers, and bank details unless the operator explicitly selects and reviews them.

### 7.22 Backup, restore, and data portability

- Back up company/project configuration, company and membership rules, SQLite metadata, audit history, manifests, folder 14 Base Joins, folder 15 Comprovantes Finais, and retained source evidence according to policy.
- Backups must be versioned, encrypted, integrity-checked, and written to a destination separate from the active application-data directory.
- Provide `Create backup`, `Verify backup`, and `Restore preview` actions. Restore must show Programs, Projects, Companies, months, rule versions, documents, conflicts, and estimated disk space before writing.
- Restore into a temporary area first, validate database/schema versions and hashes, then commit atomically. Never overwrite newer local data silently.
- Test a representative restore regularly. A backup is not considered valid until verification and at least one documented restore test succeed.
- Provide a portable company/month evidence export with documents, outputs, manifests, rule-version references, and human-readable index; exclude API credentials and machine-specific secret material.

### 7.23 Untrusted, protected, and digitally signed PDF handling

- Treat every input as untrusted. Verify actual file signatures/MIME types rather than trusting extensions; enforce configured byte, page, dimension, decompression, and processing-time limits.
- Parse and render PDFs in a sandboxed worker with no network access and least filesystem privilege. Integrate optional enterprise antivirus scanning or an approved scanning hook before parsing.
- Detect encrypted/password-protected PDFs and route them to a secure password prompt or manual replacement flow. Passwords are never persisted or logged.
- Detect digital signatures before splitting or joining. Preserve the signed original unchanged and warn that generating a new joined PDF does not preserve or transfer the original signature.
- Manifests identify signed inputs, signature-detection status, and the exact signed source hash. Generated Base/Final Joins must never be presented as digitally signed unless they are separately signed after generation through an approved signing workflow.
- Reject or quarantine malformed files that trigger parser errors, suspicious embedded content, or resource limits; show a safe operator-facing reason without rendering active content.

### 7.24 Concurrency and single-writer protection

- Use a single application-instance lock for the desktop MVP and database transactions/file locks for all state-changing operations.
- Acquire a scoped processing lease for `{program_id, project_id, company_id, year, month}` before classification, filing, Base Join generation, Final Join generation, closure, cleanup, backup, or restore.
- Leases contain owner, operation, start/heartbeat time, and expiry. Stale leases require an audited recovery action; they must not be removed silently.
- Use optimistic version checks for reviews and rule edits. If state changed after a screen was opened, block the stale write, show the newer state, and require reconciliation.
- Final paths are committed atomically only when the expected dependency hashes and versions still match.

### 7.25 Month closure, reopening, and regeneration

Month states are `OPEN`, `READY_TO_CLOSE`, `CLOSED`, and `REOPENED`.

- `Close month` is available only when review is resolved/passed, the Base Join is current, requested Comprovantes Finais are current, reconciliation passes, and a verified backup/export exists when source deletion is enabled.
- Closing freezes approvals, rules-version references, evidence manifests, Base/Final hashes, and retention actions for that company/project/month. It does not silently delete sources or cache.
- Show a confirmation summary of included, passed, missing, and deleted/retained evidence plus all generated outputs.
- Reopening requires an authorized operator, reason, and audit entry. It invalidates closure status and marks affected Base/Final outputs stale when evidence, metadata, or dependency rules change.
- Regeneration creates a new output version and preserves prior manifest/history according to retention policy; it never overwrites the previous verified version silently.

### 7.26 Local authorization and privileged actions

The desktop MVP may rely on the authenticated operating-system account rather than a full multi-user identity system, but privileged actions still require explicit authorization and audit.

- Define at least `Operator` and `Administrator` capabilities. Operators may ingest, review, approve documents, and generate current outputs. Administrators additionally manage providers/keys, retention, source deletion, backup/restore, company-rule activation/rollback, month reopening, and permanent deletion.
- For a single-user installation, administrator capability is granted during setup and protected by the operating-system session. Shared or server deployments require authenticated named users and must not use a shared anonymous administrator.
- Destructive or high-impact actions require re-confirmation showing scope and consequences. Audit actor, role/capability, time, reason, previous state, and result.
- An inactivity lock hides previews and requires operating-system re-authentication or application unlock before sensitive work resumes.

### 7.27 Application updates and schema migration

- Version the application, SQLite schema, company-rule schema, membership-rule schema, manifests, cache format, and generated-output format independently.
- Before any migration, run a compatibility and free-space preflight and create a verified rollback backup of affected persistent data.
- Migrations are ordered, checksummed, transactional where possible, resumable after interruption, and recorded in an audit/migration journal.
- Never silently downgrade or open a newer unsupported data format. Show a recovery-safe compatibility message instead.
- Cache formats may be invalidated and rebuilt; persistent rules, approvals, evidence, manifests, and outputs must be migrated or restored without data loss.
- An update is committed only after post-migration integrity checks pass. On failure, restore the prior compatible state or enter read-only recovery mode.

## 8. Proposed Application Structure

The Next.js layer is the operator UI and lightweight API/CRUD/status surface. Long-running PDF slicing, rendering, OCR, local model calls, cloud model calls, similarity indexing, and join materialization must run in an Electron main-process worker, Node worker thread, child process, or dedicated local processing service. Next.js API routes may enqueue work, update/read SQLite metadata, and stream/poll status, but they must not own long-running CPU-heavy processing loops.

In browser-only prototype mode, processing may be simulated or executed through short development API routes for validation, but production/desktop architecture must move heavy work behind a resumable background worker boundary.

```text
lib/smartcomprovante/
  schema.ts
  config.ts
  ingest.ts
  page-slicer.ts
  text-extractor.ts
  ocr.ts
  heuristics.ts
  rules.ts
  providers/
    types.ts
    gemini.ts
    index.ts
  rate-limiter.ts
  json-repair.ts
  boundaries.ts
  grouping.ts
  sorter.ts
  naming.ts
  path-budget.ts
  code-registry.ts
  compiler.ts
  audit.ts
  storage.ts
  cache.ts
  retention.ts
  authorization.ts
  leases.ts
  pdf-security.ts
  backup.ts
  restore.ts
  migrations.ts
  month-lifecycle.ts
  worker/
    queue.ts
    processor.ts
    extraction-worker.ts
    ocr-worker.ts
    classification-worker.ts
    assembly-worker.ts

app/api/smartcomprovante/
  batches/route.ts
  batches/[batchId]/process/route.ts
  batches/[batchId]/route.ts
  batches/[batchId]/export/route.ts
  review/[itemId]/route.ts

components/smartcomprovante/
  hierarchy-navigation.tsx
  scope-breadcrumb.tsx
  program-project-selector.tsx
  company-selector.tsx
  monthly-company-workspace.tsx
  monthly-evidence-matrix.tsx
  base-join-dependencies.tsx
  final-comprovante-employee-table.tsx
  processing-progress.tsx
  processing-diagnostics.tsx
  review-queue.tsx
  review-inspector.tsx
  destination-preview.tsx
  audit-summary.tsx
  company-rule-editor.tsx
  rule-history.tsx
  backup-restore.tsx
  retention-settings.tsx
  month-closure.tsx
  security-settings.tsx
  batch-upload.tsx
  review-inbox.tsx
  page-preview.tsx
  bundle-preview.tsx
  usage-report.tsx
```

Existing generic PDF tools may remain available but should call shared PDF primitives rather than duplicate SmartComprovante business logic.

## 9. Batch State Model

Batch states:

```text
DRAFT -> INGESTING -> EXTRACTING -> CLASSIFYING -> REVIEW_REQUIRED
      -> READY_TO_EXPORT -> EXPORTING -> COMPLETED
```

Any processing state may transition to `FAILED` or `CANCELLED`. A recoverable failed batch may resume from its last successful checkpoint.

Page states:

```text
PENDING -> EXTRACTED -> CLASSIFIED -> APPROVED -> EXPORTED
                         |              ^
                         -> REVIEW -----|
```

## 10. Storage and Privacy

- MVP storage is local filesystem plus a local metadata store, preferably SQLite.
- Store Programs, Projects, Companies, and company-project memberships as separate records with stable IDs; do not encode these relationships only in folder names.
- Store the filesystem root mapping for each company-project membership so the same company can participate in multiple Projects without ambiguous filing.
- Every batch, page, logical document, review action, manifest, and join retains Program ID, Project ID, Company ID, year, and month.
- Store batch data outside build output directories.
- Provide configurable retention and a delete-batch action.
- Store working cache under the application's protected data directory, never in the web/public directory or alongside source-controlled files.
- Apply separate retention policies to temporary cache, source evidence, audit metadata, Base Joins, and Comprovantes Finais; a generic cache-clear operation affects only eligible temporary cache.
- Development-only API secrets may live in `.env.local`, which must be excluded from Git. Packaged desktop and production installations must use the secure storage contract in section 10.1.
- Logs must redact API keys, full document text, bank account numbers, and sensitive identifiers by default.
- The UI must clearly indicate when content will leave the machine for an AI provider.
- Record operator consent for image/vision transmission.
- Production deployment requires a GDPR/privacy review and provider data-retention assessment.
- Production readiness requires documented local-data encryption, access-control, backup, restore, retention, and incident-recovery decisions; an API-key-only security review is insufficient.

### 10.1 Cloud LLM API-key protection

Gemini, Groq, and any future cloud LLM API keys are secret credentials. Encryption at rest protects the stored value, but the trusted process must briefly decrypt the selected provider key in memory to make that provider request.

Desktop/Electron requirements:

- The renderer provides only masked set/replace/delete/test controls. It must never receive the stored plaintext key or offer a reveal action.
- The renderer sends a newly entered key once to an authenticated IPC handler in the Electron main process. The main process validates the request and never echoes the value.
- Before saving, the main process must check `safeStorage.isEncryptionAvailable()`. If secure encryption is unavailable, cloud providers are disabled and local rules/Ollama remain usable; the application must not silently store plaintext.
- Encrypt using Electron `safeStorage.encryptStringAsync()` and decrypt using `safeStorage.decryptStringAsync()`. Store only the encrypted Base64 blob under the application's user-data directory with restrictive operating-system permissions.
- Never enable Electron plaintext encryption fallback. Never place the key in command-line arguments. If a local server process needs the credential, provide it through a short-lived protected process channel or environment value controlled by the main process.
- Decrypt only immediately before the selected cloud-provider request, keep the plaintext lifetime as short as practical, and discard references after use.

Server/deployed requirements:

- Store the key in a managed secret store or protected server environment, never in client-side JavaScript or a public runtime variable.
- Browser clients call the application's authenticated server endpoint; they never call Groq, Gemini, or another cloud LLM directly with the product key.

Universal controls:

- Never store the plaintext key in `localStorage`, `sessionStorage`, IndexedDB, SQLite, preferences, company-rule JSON, source code, build artifacts, crash reports, logs, prompts, URLs, analytics, or audit manifests.
- Send credentials through the official SDK or an HTTP header over TLS, not a query string.
- Mask diagnostic metadata to at most the last four characters. Audit only who set, replaced, tested, or deleted the credential and when.
- Redact authorization/API-key headers and known key patterns before logging requests, errors, or telemetry.
- Use separate development and production keys; apply API restrictions and quotas where supported; rotate periodically and immediately after suspected exposure.
- The Test connection action returns only success, failure category, model availability, and time. It must never return or log the key.
- No automatic cloud fallback is permitted. The UI must show the active provider and obtain explicit consent before any document content leaves the machine.
- If secure storage, decryption, or credential validation fails, fail closed for that cloud provider and show a recoverable configuration error without exposing secret material.

## 11. Configuration

The MVP must support:

- selected provider and model;
- routing policy mode, thresholds, enabled layers, and cloud-call limits;
- confidence-model weights, penalties, and approved adjustment bounds;
- OCR language and minimum-text threshold;
- confidence threshold, default `0.75`;
- request interval, concurrency, timeout, and retry count;
- maximum input size and pages per batch;
- input/output token prices and pricing effective date;
- output directory;
- Program/Project/Company shared-folder mappings and default current year/month;
- remote vision enabled/disabled;
- retention period;
- Groq/Gemini cloud test mode enabled/disabled, masked credential status, selected active provider, and explicit per-batch cloud consent.
- cache maximum size/age, automatic cleanup, source-evidence retention, and verified-delivery deletion policy.
- backup destination, schedule, encryption, verification frequency, and restore-test reminder;
- inactivity timeout, local capability assignments, month-closure policy, and processing-lease timeout;
- input byte/page/decompression limits, antivirus scanning hook, and signed-PDF handling policy;
- database/rule/manifest schema compatibility and migration status.
- storage profile (`Local` or `SharePoint/OneDrive`), filename/target-path safety budgets, and versioned document/folder/entity-code registries.

Invalid or missing required configuration must be reported at startup and before processing begins.

## 12. Error Handling

Errors must be typed and user-actionable:

- input validation error;
- corrupt or encrypted PDF;
- extraction failure;
- OCR failure;
- provider authentication or configuration failure;
- rate-limit or provider availability failure;
- invalid/irreparable classification response;
- grouping conflict;
- filesystem permission or insufficient-space failure;
- export validation failure;
- malicious/suspicious file or resource-limit quarantine;
- signed/encrypted PDF requiring operator action;
- processing lease/conflicting update failure;
- backup, verification, restore, or migration failure;
- cache/database corruption or incompatible version;
- interrupted download/ZIP generation or application restart;
- local encryption/access-control failure.
- invalid/reserved SharePoint name or end-to-end target path over the configured safety budget.

The UI must show which pages were affected and whether retry, review, configuration, or file replacement is required.

Before ingestion, generation, download, backup, restore, migration, or cleanup, preflight expected disk space and destination permissions. All long-running operations use checkpoints and temporary files; after restart, the application detects incomplete work and offers `Resume`, `Retry`, or `Discard temporary work` without treating partial output as complete.

## 13. Testing and Acceptance

### 13.1 Required test corpus

The approved corpus must include:

- the Alberto Gil January 2026 payroll example;
- the mixed `Comprovante 2175` example;
- vector and scanned versions of every document category;
- examples for all 13 Recursos Humanos categories and all 8 Investimentos categories;
- salary and meal-allowance batch transfers with and without the required detailed batch listing;
- a monthly IRS listing that can be checked against the company's employee list;
- linked investment invoice, accounting posting, supplier statement, transfer proof, bank movement, fixed-asset record, quotation, and unpaid-invoice cases;
- multi-page documents and mixed-document PDFs;
- shuffled pages;
- accented Portuguese names;
- conflicting and missing NIFs;
- missing months/dates;
- malformed provider JSON;
- simulated 429, timeout, and 5xx responses;
- duplicate pages, corrupt PDFs, and unsupported files.

Test documents containing personal data must be authorized and stored outside the public repository.

### 13.2 Automated tests

- Unit tests for schema, JSON repair, NIF/date normalization, boundaries, grouping, sorting, and cost calculations.
- Provider contract tests using mocked responses.
- Integration tests from ingestion through manifest generation.
- Data-model tests proving every entity relationship and invariant in section 6.1, including Program/Project/Company/Year/Month scoping, stable IDs, source hashes, rule versions, and provenance links.
- RoutingPolicy tests proving each layer exits at the configured threshold, skipped LLM calls are audited, cloud-call limits are enforced, and policy changes invalidate only affected cached decisions.
- Confidence-model tests proving component scoring, adjustments, penalties, clamping, thresholds, and review routing match section 7.4.1 for deterministic, Ollama, Groq, and Gemini paths.
- Performance tests proving section 6.2 reference targets or documented hardware-adjusted targets for extraction, OCR, local routing, review inbox load, Base Join generation, and 100-page mature-company batch throughput.
- Worker/queue tests proving extraction, OCR, feature computation, classification routing, and assembly can run as independent resumable stages without blocking UI state or repeating completed work after interruption.
- Architecture tests proving long-running PDF/OCR/LLM/join work executes through the background worker/main-process boundary and that Next.js API routes remain limited to enqueue/status/CRUD/export request coordination.
- Prompt-strategy tests proving minimal, full-taxonomy, document-level, and repair prompts are selected by RoutingPolicy and audited with prompt version, token use, latency, and correction outcome.
- Pre-boundary and multi-page classification tests proving likely logical documents can be classified as units while preserving page-level provenance and review-editable boundaries.
- Text-first classification tests proving usable embedded/OCR text uses rules/text models before any vision model, and vision fallback requires OCR failure, visual ambiguity, or explicit reprocess.
- OCR-adapter tests proving the Windows prototype default Tesseract path works with Portuguese/English packs, exposes the common OCR result shape, and degrades gracefully when bounding boxes are unavailable.
- PDF page-count and order tests.
- Folder 0 intake tests covering approved filing into folders 1–13, passed items, retained processed originals, split mixed PDFs, assembled documents, duplicate names, and interrupted filesystem writes.
- Folder-selection tests proving the browser enumerates supported files and submits one file per request, incremental results append rather than replace, progress identifies the current file, interruption preserves completed results, and re-selection skips unchanged registered hashes.
- Desktop watched-folder tests proving access is explicitly authorized, scoped to the correct company/project, revocable, resistant to SharePoint synchronization placeholders, and never scans folders 1–15 as new intake.
- Folder-routing tests for `MM_YYYY`, `1T_YYYY` through `4T_YYYY`, all numbered category folders, and normalized filenames.
- Base Join tests confirming folders 2–13 are included once in order, folder 1 is excluded, and the manifest reconciles all pages.
- Final Join tests confirming the selected employee's folder 1 payslip appears first, the matching current Base Join follows, and stale/mismatched joins are blocked.
- Confirmed-missing-evidence tests proving incomplete folders 2-13 can proceed only after explicit operator confirmation with reason, unresolved review remains blocked, and Base/Comprovante manifests are labelled with warnings.
- Virtual-join tests proving source corrections update Base/Comprovante manifests, stale materialized PDFs are detected by hash, and dependent employee PDFs are materialized lazily only for preview/download/export/month lock.
- UI tests for manual review and export blocking.
- Hierarchical navigation tests for Program -> Project -> Company -> Year -> Month, persistent breadcrumbs, Year Workspace 12-month overview, monthly switching, multi-month actions, deep links, and company participation in multiple Projects.
- Company Year Workspace tests covering 12 month cards, selected-month processing/generation/export, independent month failures, and correct aggregation of month status.
- Monthly Company Workspace tests covering folder counts, evidence completeness, review warnings, Base Join state, Final Join state, and clickable dashboard filters.
- UI consistency tests proving blocked/missing dependencies cannot display ready/current Base or Final Join states.
- Review-screen tests for canonical domains/types, destination preview, audit reasons, approve-next, pass reason, split/merge, and keyboard navigation.
- Employee-roster tests proving approved folder 1 payslips define the MVP expected employee list, optional imported rosters cross-check rather than overwrite it silently, and IRS/Comprovante completeness uses the approved roster source.
- Roster-mismatch tests proving roster-extra employees create missing-payslip warnings and block only those employees' Comprovantes Finais, while payslip-extra employees create unexpected-employee review warnings requiring operator resolution.
- Accessibility tests for keyboard-only operation, visible focus, semantic labels, status text independent of colour, and WCAG AA contrast.
- Regression fixtures for every corrected misclassification.
- JSON-schema tests for global, company, and project-membership rule files, including version upgrades, precedence, forbidden secrets, invalid regex patterns, conflicts, approval, audit history, and rollback.
- Rule-learning tests proving that manual corrections create inactive proposals and cannot affect later classifications until an operator approves them.
- Reference-first onboarding tests proving that multiple Base Join and Final Join examples can be offered before monthly classification, their privacy-safe structural profiles enter only the selected company rules, compared examples produce reusable structural signals, and guided classification remains available when examples do not exist.
- Category-example tests proving that approved examples for folders 1-13 can be stored as privacy-safe fingerprints/proposals, compared locally before LLM calls, and never stored as downloadable source copies.
- Reference-lifecycle tests proving that temporary reference binaries are deleted after validated profile extraction, cannot be downloaded through the UI/API, and do not leave personal data or copied document text in company rules.
- Company-onboarding tests proving that each new Company atomically receives one schema-valid version-1 JSON, that multi-project memberships reuse it, and that failed rule creation cannot leave a falsely completed Company record.
- Company lifecycle tests for rename, alias history, archive, restore, project-membership overrides, schema migration, and safe handling of missing or corrupt company JSON.
- Optimization tests showing approved deterministic rules, reference examples, category examples, and local similarity are evaluated before the LLM, reduce eligible repeated model calls, record avoided token use, and never bypass canonical evidence, confidence, review, or filing controls.
- Gemini and Groq adapter tests for structured output, authentication failure, quota/rate limits, timeout, consent enforcement, active-provider labeling, and proof that local rules/Ollama never fall back to cloud providers automatically.
- Secret-handling tests proving that cloud API keys never appear in renderer state, renderer network traffic, local/session storage, IndexedDB, SQLite, rule JSON, logs, errors, manifests, telemetry, command-line arguments, or build output.
- Electron secure-storage tests covering encrypted save/read/delete/replace, masked metadata, invalid ciphertext, unavailable encryption, and fail-closed behavior. Tests must never use a real production credential.
- Log-redaction tests for API-key headers, known key patterns, URLs, and provider error payloads.
- Cache tests for content-hash reuse, selective invalidation after model/prompt/schema/rule changes, atomic writes, size/age eviction, protected active jobs, and cleanup after verified delivery.
- Cross-batch/template-cache tests proving unchanged files and compatible recurring templates reuse safe cached extraction/features/classification while invalidating on version, rule, prompt, or policy changes.
- Review-preview tests proving that the default PDF response contains at most the first three pages, uses inline/no-store security headers, never exposes a filesystem path, and remains available while the review item is active.
- Retention tests proving cache cleanup cannot delete folders 14/15, provenance manifests, unresolved reviews, recoverable failures, or source evidence unless the separately authorized verified-delivery deletion policy applies.
- Download tests for individual Comprovantes Finais and company/month ZIP export, including current-hash validation and exclusion of cache/internal/secret files.
- Local-data security tests for directory permissions, renderer/IPC isolation, inactivity locking, protected previews, privacy-safe diagnostic export, and absence of document content in unprotected temporary locations.
- Hostile-input tests covering spoofed extensions, malformed PDFs, embedded content, decompression/resource limits, parser timeout, quarantine, encrypted PDFs, and optional antivirus integration.
- Signed-PDF tests proving the original is preserved, signature status/source hash is manifested, and generated joins are never incorrectly represented as retaining the source signature.
- Backup/restore tests for encryption, integrity verification, wrong/corrupt/incomplete backups, insufficient space, conflict preview, atomic restore, newer local data, and a complete documented restore drill.
- Source-deletion tests proving deletion is impossible before verified final outputs and a separate verified restorable backup/evidence export.
- Migration tests for every supported prior database/rule/manifest version, interrupted migration, checksum mismatch, rollback, read-only recovery, and rejection of unsupported newer formats.
- Concurrency tests for single-instance behavior, scoped leases, stale-lease recovery, stale review/rule edits, dependency-hash changes during generation, and atomic final-path commits.
- Month lifecycle tests for closure prerequisites, frozen manifests/hashes, authorized reopening with reason, stale-output propagation, and version-preserving regeneration.
- Authorization tests proving Operator and Administrator capabilities protect provider keys, retention/source deletion, backup/restore, rule activation/rollback, month reopening, and permanent deletion.
- Operational recovery tests for low disk space, lost permissions, application restart during each pipeline stage, partial ZIP/download, corrupt cache/database, and safe resume/retry/discard behavior.
- SharePoint/OneDrive naming tests for every document/folder code, invalid/reserved names, accents and normalization, long configured roots, decoded-path calculation, local/sync limits, deterministic collisions, compact previews, and blocked over-budget writes.
- Entity-code tests proving employee/supplier codes are unique per company, stable across name changes, auditable, searchable by full name/NIF, and never silently reused.

### 13.3 Definition of done

The MVP is complete when:

- all required pipeline stages are implemented;
- the section 6.1 data model is implemented or explicitly mapped to the chosen storage schema with all invariants tested;
- RoutingPolicy and confidence scoring are implemented as shared runtime logic, not duplicated independently inside provider adapters;
- section 6.2 performance targets are met on reference hardware or deviations are documented with a hardware profile;
- the system supports resumable worker/queue stages and does not require sequential page-by-page provider calls for every document;
- long-running PDF/OCR/LLM/join processing runs outside the Next.js request lifecycle through the approved worker/main-process architecture;
- usable embedded/OCR text is classified through rules/text-first prompts before any vision model is used;
- the approved corpus meets the success criteria;
- unresolved review items cannot be silently exported;
- input/output page reconciliation passes;
- approved documents are filed and renamed under the correct company/month/category folders without overwriting or altering their preserved originals;
- unclear items remain visibly reviewable or explicitly passed and never appear among approved classified documents;
- folder 14 and folder 15 contain only valid materialized deliverables and manifests generated from current virtual join manifests;
- Program, Project, Company, year, and selected month(s) are visible and unambiguous throughout classification, review, filing, and join workflows;
- the Company Year Workspace exposes all 12 months and lets the operator choose one month, multiple months, or all months for classification, generation, and export;
- the Monthly Company Workspace exposes the complete folders 1–13 status and join readiness without requiring the operator to inspect the filesystem;
- the application uses one consistent navigation shell and does not duplicate the Monthly Company Workspace as separate receipts/payroll screens;
- review, Base Join, Final Join, processing, and export screens satisfy section 7.17 and display only backend-derived, mutually consistent states;
- token and cost reporting is verified;
- TypeScript checks and automated tests pass without suppressing build errors;
- the application builds without requiring runtime font downloads;
- setup, environment variables, privacy behavior, and operator workflow are documented;
- company rule files validate against the versioned schema, retain complete approval/change history, contain no secrets, and can be rolled back;
- every newly created Company automatically receives exactly one validated starter rule JSON, shared across its project memberships, before onboarding is complete;
- Groq/Gemini cannot process a page without explicit cloud consent and cannot be enabled when secure credential storage is unavailable;
- automated security tests demonstrate that stored cloud-provider credentials are encrypted at rest and never exposed to the renderer, rules, logs, manifests, source control, or build artifacts;
- unchanged files reuse valid cached processing results, eligible temporary artifacts are cleaned after verified delivery, and durable Base Join/Comprovante Final outputs remain downloadable and intact;
- sensitive local documents, metadata, rules, cache, and backups satisfy the encryption, permissions, IPC isolation, and privacy-safe diagnostics requirements;
- verified backup and restore, schema migration/rollback, concurrency locking, month close/reopen, signed-PDF handling, hostile-input quarantine, authorization, and restart recovery pass their required acceptance tests;
- source evidence cannot be deleted until final delivery and a separately stored restorable backup/evidence export are both verified.
- every generated SharePoint/OneDrive path passes the configured end-to-end length and character preflight, uses the versioned compact-code registry, and remains understandable/searchable through friendly UI labels and manifest metadata.

## 14. Implementation Phases

The complete PRD describes the product direction, but delivery must be sliced. The prototype MVP should prove the classification-to-join mission first; production hardening can follow without blocking learning.

### Release slicing

| Release | Scope |
|---|---|
| Prototype MVP | Single-user local workspace, one active company/month at a time, folder-0 intake, extraction/OCR, local rules/template fingerprinting, Groq/Gemini test adapter if configured, review inbox, virtual Base Join, virtual Comprovante Final, lazy PDF materialization, manifests, and basic cache. |
| v1.0 | Multi-company navigation, stronger company-rule lifecycle, multiple reference/category examples, mature-company fast mode, watched SharePoint/OneDrive folder, batch anomaly detection, and richer reporting. |
| v2.0 | Production security hardening, encrypted credential store, backup/restore, authorization roles, month close/reopen, migration tooling, signed-PDF policy, antivirus hooks, and full retention/source-deletion governance. |

Prototype work may include production-oriented foundations when cheap to implement, but it must not delay the first end-to-end classification -> review -> Base Join -> Comprovante Final loop.

### Phase 1 — Stabilize the existing foundation

- Resolve TypeScript errors instead of ignoring them.
- Make fonts available locally/offline.
- Consolidate shared PDF operations.
- Add test runner, local metadata storage, typed errors, and batch IDs.
- Implement or migrate the section 6.1 data model with stable IDs, relationships, and provenance invariants.
- Implement shared RoutingPolicy and confidence-scoring modules with tests before adding more provider-specific behavior.
- Implement the stage queue/checkpoint model needed for resumable ingestion, extraction, OCR/features, routing, review, and join assembly.
- Establish renderer/IPC isolation, protected application-data directories, schema/version journals, single-instance locking, and backup/restore foundations before processing real personal data.

### Phase 2 — Build deterministic ingestion

- Implement page slicing, stable provenance, text extraction, OCR, hashing, and checkpoints.
- Add schema, heuristics, normalization, local example matching, pre-boundary detection, grouping, sorting, and manifest generation.

### Phase 3 — Add AI classification

- Implement the local Ollama text-model adapter first, strict structured output, local concurrency controls, JSON repair fallback, performance audit, and optional vision-model fallback only for OCR/text failures.
- Add optional Groq/Gemini benchmark adapters behind explicit configuration, encrypted credential storage, active-provider labeling, and privacy consent.
- Evaluate enabled providers on the same anonymized corpus without changing canonical filing rules.

### Phase 4 — Add human review and export

- Implement the review inbox, corrections, boundary editing, bundle preview, audited overrides, and validated export.

### Phase 5 — Validate the MVP

- Run the approved corpus, measure accuracy and cost, correct regressions, complete security/backup/restore/migration/recovery tests, document privacy decisions, and package the desktop build.

## 15. Out of Scope for the MVP

- Autonomous accounting entries or tax filing;
- legal/compliance certification of document contents;
- cloud multi-user collaboration;
- mobile applications;
- permanent enterprise document storage;
- training or fine-tuning proprietary models;
- handwritten-document guarantees;
- automatic payment execution.

## 16. Open Product Decisions

The following must be confirmed before production release but do not block the prototype:

1. Whether the authoritative target period comes from document date, payroll month, payment date, or category-specific rules.
2. Required retention periods for source evidence, audit metadata, Base Joins, Comprovantes Finais, backups, and temporary cache.
3. Whether external Groq/Gemini processing of any real personal and banking data is legally approved; until approval, cloud providers are restricted to synthetic/anonymized/redacted testing.
4. The production Ollama model/hardware profile and the Groq/Gemini test-model/pricing configuration used for benchmarking.
5. The approved production encryption approach for local database/documents and the enterprise backup destination/key-recovery owner.
6. Whether source-evidence deletion will be enabled at all; if enabled, the required separate backup/evidence-export destination and restore-test frequency.
7. Whether deployment remains single-user desktop or later enables named multi-user/server authentication beyond the MVP capability model.
