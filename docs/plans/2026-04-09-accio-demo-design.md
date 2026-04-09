# Accio Demo Design

Date: 2026-04-09

## Goal

Build a local Accio-like procurement workflow demo inside this repository as an isolated vertical slice.

The first version must:

- stay separate from the existing CodeRemote chat flow
- run as a local demo inside the current `apps/web` and `apps/server` stack
- model the core Accio workflow from sourcing brief to supplier shortlist and inquiry draft
- use lightweight multi-agent orchestration rather than a single chatbot prompt
- work with local sample data and rules, with optional LLM enhancement

The first version does not need to support:

- real supplier-platform integrations
- payments, logistics, or after-sales flows
- enterprise permissions and team collaboration
- automated outbound messaging through WhatsApp, Telegram, or email
- fully autonomous negotiation loops
- persistent user accounts or long-term memory

## Product Scope

The demo should reproduce the most distinctive part of Accio's public workflow:

- procurement brief intake
- market analysis
- requirement normalization
- supplier discovery and scoring
- supplier comparison
- inquiry draft generation
- compliance and procurement risk guidance

The goal is not to build a general sourcing chatbot. The goal is to build a task-oriented procurement workspace that shows multiple agents contributing structured outputs.

## Approved Architecture

Use a lightweight multi-agent orchestration design.

### Frontend

Add a dedicated Accio demo page inside `apps/web` instead of extending the existing unified chat page.

The UI should behave like a compact procurement workstation:

- `BriefPanel` for structured sourcing input
- `RunPanel` for agent progress and stage logs
- `ResultsPanel` for structured outputs
- `FollowUpBar` for refinement prompts after the first run

### Backend

Add a dedicated `accio-demo` module inside `apps/server`.

This module should expose its own thin API surface and internal orchestration logic without changing the provider-based chat runtime.

### Data Sources

The first version should combine:

- local supplier sample data
- local market-signal sample data
- deterministic scoring rules
- optional LLM calls for richer analysis and writing

This keeps the demo realistic enough for workflow validation without depending on real marketplace APIs.

## Options Considered

### 1. Single-agent sequential workflow

Rejected.

Pros:

- fastest to build
- easiest to debug

Cons:

- too close to a normal prompt chain
- does not reflect the product feel of Accio Agent

### 2. Lightweight multi-agent orchestration

Chosen.

Pros:

- captures the core Accio behavior
- keeps boundaries between analysis, matching, writing, and compliance clear
- still feasible as an MVP in the current repo

Cons:

- requires shared job state and stage coordination
- slightly more complex than a linear pipeline

### 3. Event-driven agent runtime

Rejected for the first version.

Pros:

- best long-term extensibility
- cleaner support for resumable jobs and human approval later

Cons:

- too much runtime infrastructure for the MVP

## Functional Scope

### Must Have

- structured procurement brief form
- market research output
- normalized sourcing requirements output
- supplier matching and weighted scoring
- comparison table for shortlisted suppliers
- inquiry draft generation
- compliance and procurement risk notes
- visible multi-agent progress and intermediate outputs

### Should Have

- clarification questions for incomplete briefs
- ranking mode switch:
  - low price
  - quality
  - balanced
- follow-up refinements such as:
  - lower MOQ
  - faster lead time
  - stronger inquiry wording
- exportable procurement summary

### Not In Scope

- real scraping or marketplace search
- live supplier messaging
- shipping workflow execution
- payment workflow execution
- tax filing and customs document generation
- team workspace features

## Core Data Model

The central object is a procurement job.

### ProcurementBrief

Raw user input.

Suggested fields:

- `productName`
- `targetMarket`
- `budgetRange`
- `targetPrice`
- `moqTarget`
- `certifications`
- `materials`
- `specs`
- `referenceLinks`
- `referenceImages`
- `priorityMode`

### NormalizedRequirements

Structured sourcing requirements generated from the brief.

This becomes the canonical input for downstream stages.

### MarketInsight

Contains:

- target buyer
- use cases
- target price band
- value propositions
- competition/risk summary
- recommended positioning

### SupplierProfile

Local catalog data for a supplier.

Suggested fields:

- `supplierId`
- `name`
- `region`
- `categories`
- `priceBand`
- `minMoq`
- `leadTimeDays`
- `certifications`
- `materials`
- `customizationSupport`
- `reliabilityScore`

### SupplierMatch

Matching output tied to a supplier profile.

Suggested fields:

- `fitScore`
- `pros`
- `cons`
- `missingInfo`
- `recommendedFor`

### ComparisonTable

Frontend-friendly matrix for shortlisted suppliers.

### InquiryDraft

Generated inquiry content with at least:

- `professional`
- `concise`

### ComplianceNote

Market-specific procurement and compliance guidance.

### JobRun

Execution record for a procurement job.

Suggested fields:

- `jobId`
- `status`
- `stages`
- `createdAt`
- `updatedAt`
- `brief`
- `outputs`

Statuses:

- `queued`
- `running`
- `completed`
- `failed`
- `needs_input`

## Agent Roles

The orchestrator should coordinate five role-specific workers.

### market-analyst

Input:

- `ProcurementBrief`

Output:

- `MarketInsight`

Responsibility:

- identify buyers, price range, differentiation, and market risks

### requirements-normalizer

Input:

- `ProcurementBrief`
- `MarketInsight`

Output:

- `NormalizedRequirements`

Responsibility:

- translate fuzzy sourcing intent into structured constraints

### supplier-scout

Input:

- `NormalizedRequirements`

Output:

- `SupplierMatch[]`

Responsibility:

- search the local supplier catalog
- score and rank suppliers
- produce a shortlist

### compliance-reviewer

Input:

- `NormalizedRequirements`
- `targetMarket`

Output:

- `ComplianceNote`

Responsibility:

- call out certifications, sampling advice, payment risk, import risk, and timeline warnings

### procurement-writer

Input:

- `NormalizedRequirements`
- `SupplierMatch[]`
- `ComplianceNote`

Output:

- `InquiryDraft`

Responsibility:

- generate inquiry drafts and next-step guidance

### synthesizer

Input:

- outputs from all previous stages

Output:

- final job result payload

Responsibility:

- merge stage outputs into one frontend response object

## Execution Flow

Recommended order:

1. create `JobRun`
2. run `market-analyst`
3. run `requirements-normalizer`
4. run `supplier-scout`
5. run `compliance-reviewer` and `procurement-writer` in parallel
6. run `synthesizer`
7. publish final result

The orchestrator should own:

- stage order
- shared state
- retries and fallback behavior

It should not generate domain content itself.

## Frontend Design

The demo page should use a dedicated state slice and API layer.

### BriefPanel

Collect:

- product
- market
- pricing
- MOQ
- certifications
- specs
- links
- priority mode

### RunPanel

Display:

- current stage
- stage status
- agent log entries
- retry state

### ResultsPanel

Display:

- market insights
- supplier shortlist
- supplier comparison table
- inquiry draft
- compliance/risk notes

### FollowUpBar

Allow refinement prompts such as:

- find lower MOQ suppliers
- prioritize faster lead time
- rewrite inquiry draft

## Backend API

The API should remain thin and demo-specific.

### HTTP

- `POST /api/accio-demo/jobs`
- `GET /api/accio-demo/jobs/:id`
- `POST /api/accio-demo/jobs/:id/follow-ups`
- `GET /api/accio-demo/catalog/suppliers`

### Streaming

Use SSE for the first version unless existing server primitives make WebSocket reuse significantly simpler.

Suggested event types:

- `job.started`
- `job.stage.updated`
- `job.stage.completed`
- `job.completed`
- `job.failed`

## Error Handling

### Input Problems

If key fields are missing, return `needs_input` with clarification prompts instead of failing hard.

### Stage Failures

A failed stage should:

- record the failing stage name
- record an operator-readable error message
- support stage-level retry

### LLM or Data Failures

If the LLM is unavailable:

- fall back to deterministic templates and rules

If supplier matches are too weak:

- return a transparent warning rather than fabricated confidence

## Testing Plan

### Backend Unit Tests

- orchestration order
- job status transitions
- supplier scoring by priority mode
- normalization stability
- fallback behavior when LLM calls fail
- follow-up refinement updates

### Frontend Tests

- brief submission
- stage-progress rendering
- result-card rendering
- one happy-path integration flow

## File Layout

### Frontend

- `apps/web/src/accio-demo/AccioDemoPage.tsx`
- `apps/web/src/accio-demo/components/*`
- `apps/web/src/accio-demo/state/*`
- `apps/web/src/accio-demo/types.ts`
- `apps/web/src/accio-demo/api.ts`

### Backend

- `apps/server/src/accio-demo/index.ts`
- `apps/server/src/accio-demo/routes.ts`
- `apps/server/src/accio-demo/orchestrator.ts`
- `apps/server/src/accio-demo/agents/marketAnalyst.ts`
- `apps/server/src/accio-demo/agents/requirementsNormalizer.ts`
- `apps/server/src/accio-demo/agents/supplierScout.ts`
- `apps/server/src/accio-demo/agents/procurementWriter.ts`
- `apps/server/src/accio-demo/agents/complianceReviewer.ts`
- `apps/server/src/accio-demo/catalog/suppliers.ts`
- `apps/server/src/accio-demo/catalog/marketSignals.ts`
- `apps/server/src/accio-demo/scoring/supplierScoring.ts`
- `apps/server/src/accio-demo/storage/jobStore.ts`
- `apps/server/src/__tests__/accio-demo/*`

## MVP Acceptance Criteria

1. A user can submit a procurement brief and create a job.
2. The UI shows at least four stage transitions in real time.
3. The system returns market insights, a supplier shortlist, a comparison table, an inquiry draft, and risk notes.
4. The user can switch among at least three ranking modes:
   - low price
   - quality
   - balanced
5. The user can run at least two follow-ups:
   - lower MOQ
   - rewrite inquiry
6. The system still returns usable output when the LLM is unavailable.

## Implementation Recommendation

Proceed with the lightweight multi-agent design as an isolated demo module in the existing monorepo.

This keeps the first version focused on the part of Accio that is most distinctive and most feasible to reproduce locally: structured sourcing execution rather than generic chat.
