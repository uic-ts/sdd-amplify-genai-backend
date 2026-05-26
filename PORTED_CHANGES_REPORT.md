# Ported Changes & Migration Report

This document provides a comprehensive list of all changes ported and merged from the repository `/Users/rling3/Desktop/Projects/amplify/amplify-genai-backend` into the current repository `/Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend`. 

These changes resolve crucial AWS deployment bugs, update default resources to target the **`us-east-2`** region, introduce dynamic claims mapping in Cognito tokens, and fix critical streaming race conditions in the Javascript runtime.

---

## 📁 1. General Configuration & Infrastructure

### [MODIFY] [.gitignore](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/.gitignore)
* **What it does:** Appends `frontend.env` and `.serverless_cache/` to the file ignore rules.
* **Why it matters:** Prevents local frontend environment secrets and Serverless Framework Python packaging caches from being checked into version control, keeping the codebase clean.

### [MODIFY] [package.json](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/package.json)
* **What it does:** Bumps the `serverless` dependency from `^3.38.0` to `^3.40.0`.
* **Why it matters:** Ensures full compatibility with Serverless Framework Compose features and crucial fixes for AWS deployment runtimes.

### [MODIFY] [dev-var.yml-example](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/dev-var.yml-example)
* **What it does:** Changes the default fallback value for `DEP_REGION` to `"us-east-2"` and updates documentation for regional RDS Hosted Zone IDs.
* **Why it matters:** Standardizes configuration templates for development and testing environments targeting `us-east-2`.

### [NEW] [.github/workflows/backend-ci.yml](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/.github/workflows/backend-ci.yml)
* **What it does:** Configures an optimized continuous integration/deployment pipeline featuring:
  1. **Concurrency Control:** Automatic cancellation of outdated jobs in progress when a new push occurs, avoiding CloudFormation state locks.
  2. **Manual Promotion Triggers:** Manual triggers (`workflow_dispatch`) enabling developers to deploy specific stages (`dev`, `staging`, `prod`) and override AWS regions.
  3. **Build Caching:** Caches pip packages and Serverless Framework pythonRequirements static package builds (`.serverless_cache/`) to cut deployment times dramatically.
  4. **Dynamic Configuration Extraction:** Extracts the real **`DEP_NAME`** (e.g. `"sdd"`) dynamically from the downloaded `var/${stage}-var.yml` configuration file using python, eliminating hardcoded naming schemas.
  5. **Validation Check:** Executes a Serverless print dry-run configuration check prior to deploying AWS resources to catch configuration errors early.
* **Why it matters:** Drastically cuts execution costs and build durations while guaranteeing safe, clean deployments under concurrent push conditions with custom names like `"sdd"`.

### [NEW] [.github/workflows/sync-upstream.yml](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/.github/workflows/sync-upstream.yml)
* **What it does:** Runs a daily cron job that attempts to merge changes from the parent `gaain-platform/amplify-genai-backend` repository. If new updates are found, it automatically creates a Pull Request.
* **Why it matters:** Automates upstream synchronization, ensuring feature forks don't drift or fall behind the master codebase.

---

## 🛠️ 2. Migration & Admin CLI Scripts

### [MODIFY] [scripts/MIGRATION_README.md](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/scripts/MIGRATION_README.md)
* **What it does:** Replaces occurrences of `us-east-1` with `us-east-2` within instructions.
* **Why it matters:** Aligns operational documentation with the target migration environment.

### [MODIFY] [scripts/id_migration.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/scripts/id_migration.py)
* **What it does:** Changes the default `--region` command-line parameter fallback to `us-east-2`.
* **Why it matters:** Prevents accidental operations in the wrong region when running user ID consolidation.

### [MODIFY] [scripts/populate_parameter_store.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/scripts/populate_parameter_store.py)
* **What it does:** Sets the default region to `us-east-2` and appends `USER_IDENTIFIER_CLAIM` to the shared variables list to sync into AWS Systems Manager Parameter Store.
* **Why it matters:** Automates SSM synchronization for user claims parameters, allowing serverless modules to fetch it at deploy-time.

### [MODIFY] [scripts/s3_data_migration.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/scripts/s3_data_migration.py)
* **What it does:** Standardizes `us-east-2` fallbacks across data consolidation procedures for S3 user logs, files, workflows, and settings.
* **Why it matters:** Safely executes migration functions inside the target AWS region.

---

## 🔑 3. Cognito & User Authentication Flow

### [NEW] [preTokenGeneration.js](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda-js/cognito/preTokenGeneration.js)
* **What it does:** Implements a Cognito Pre-Token Generation Lambda trigger using the V2 event schema. It dynamically injects the user's `email` as both `email` and `immutable_id` claims inside Cognito Access Tokens.
* **Why it matters:** Bypasses database lookups during user authorization. Since standard Cognito tokens lack custom attributes by default, this allows the backend to directly verify user identity from token metadata.

### [MODIFY] [amplify-lambda-js/common/handlers.js](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda-js/common/handlers.js)
* **What it does:** Reads `process.env.USER_IDENTIFIER_CLAIM` (e.g. `email`). Modifies parameter extraction to check this configurable claim first. If not present, it sequentially falls back to checking `immutable_id` custom claim, checking Cognito `sub` in the DynamoDB users table, and finally standard IDP username stripping.
* **Why it matters:** Facilitates highly customizable token validation. Adapts to whichever claim Cognito is configured to inject, maintaining backward-compatibility.

---

## ⚡ 4. JavaScript Backend Core & Streaming Improvements

### [MODIFY] [amplify-lambda-js/common/secrets.js](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda-js/common/secrets.js)
* **What it does:** Sets the default connection region for `SecretsManagerClient` to `us-east-2`.
* **Why it matters:** Allows loading secure database credentials and configurations from regional secret stores.

### [MODIFY] [amplify-lambda-js/groupassistants/conversationAnalysis.js](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda-js/groupassistants/conversationAnalysis.js)
* **What it does:** Changes fallback clients for DynamoDB, S3, and SQS to target `us-east-2`.
* **Why it matters:** Resolves regional mismatch errors when processing background group conversation analysis tasks.

### [MODIFY] [amplify-lambda-js/index.js](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda-js/index.js)
* **What it does:** Removes the redundant `Access-Control-Allow-Origin: '*'` header from the streaming handler's metadata response block.
* **Why it matters:** Since CORS headers are configured directly on AWS Lambda Function URLs, duplicating this header causes web browsers to block pre-flight preflight requests due to duplicate headers. Removing it fixes CORS.

### [MODIFY] [amplify-lambda-js/litellm/amplify_litellm.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda-js/litellm/amplify_litellm.py)
* **What it does:** Configures default Bedrock client fallback region to `us-east-2`.
* **Why it matters:** Links regional Bedrock LLM models to correct endpoints.

### [MODIFY] [amplify-lambda-js/router.js](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda-js/router.js)
* **What it does:** 
  1. Aborts requests with a clean `503 Service Unavailable` if `user_model_data` fails to load, avoiding unexpected server failures.
  2. Applies `await` to all `returnResponse` calls in catch blocks and exit functions.
* **Why it matters:** Resolves a major runtime crash where synchronous `finally` blocks closed response streams (`ensureStreamClosed()`) before asynchronous error responses finished writing. This fixes the `ERR_STREAM_WRITE_AFTER_END` crash.

---

## 🐍 5. Python Backend Core, RAG & S3 Addressing

### [MODIFY] [amplify-lambda/rag/handlers/markdown.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda/rag/handlers/markdown.py)
* **What it does:** Uses a safe `.get("transcription")` dictionary lookup, with a fallback default string `"Visual content"` if the value is missing or empty.
* **Why it matters:** Prevents the RAG text parser from throwing key errors when indexing files with missing image transcription metadata.

### [MODIFY] [amplify-lambda/rag/handlers/shared_functions.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda/rag/handlers/shared_functions.py)
* **What it does:** Replaces direct bracket dictionary access with `.get()` defaults for missing `transcription`, `type`, and `title` metadata keys.
* **Why it matters:** Safeguards visual metadata styling during ingestion, eliminating runtime crashes for incomplete data sets.

### [MODIFY] [amplify-lambda/state/conversation.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda/state/conversation.py)
* **What it does:** Introduces a custom S3 client (`get_s3_client()`) configured with `Config(s3={"addressing_style": "virtual"})` and defaults it to `us-east-2`. Applies this client to presigned URL generation.
* **Why it matters:** Avoids S3 Signature Version mismatches when generating temporary download links for conversation histories in regions like `us-east-2` that require virtual host-style addressing.

### [MODIFY] [amplify-agent-loop-lambda/agent/prompt.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-agent-loop-lambda/agent/prompt.py)
* **What it does:** Fallbacks default Bedrock integration client to `us-east-2`.
* **Why it matters:** Aligns agent bedrock execution calls with correct regional resource configurations.

### [MODIFY] [amplify-agent-loop-lambda/events/mock.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-agent-loop-lambda/events/mock.py)
* **What it does:** Updates mock event objects to use `us-east-2` region and topic ARNs.
* **Why it matters:** Prevents errors when simulating SNS and SQS test invocations locally or in dev.

### [MODIFY] [embedding/shared_functions.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/embedding/shared_functions.py)
* **What it does:** Targets DynamoDB client to `us-east-2` by default.
* **Why it matters:** Ensures data splitting and vector operations interact with database tables in the correct region.

### [MODIFY] [amplify-lambda-admin/service/core.py](file:///Users/rling3/Desktop/Projects/amplifynew/amplify-genai-backend/amplify-lambda-admin/service/core.py)
* **What it does:** 
  1. Targets all client config and secret loaders to `us-east-2`.
  2. Integrates an environment-configured `ADMINS` comma-separated list of emails and unions them with database-configured admins in `authorized_admin()`.
* **Why it matters:** Enables convenient administrative bootstrapping during deployments without requiring initial administrative items to exist in the database table beforehand.

---
