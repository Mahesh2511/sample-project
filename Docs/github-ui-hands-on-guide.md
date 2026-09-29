# Hands-on guide using only the GitHub website

This guide lets anyone, including someone who has never seen this project, understand the whole PR-check framework by using it in a browser. You don't need Git, Python or a terminal. Every scenario is a short loop: create a branch, change a file, open a pull request, watch what the checks do, and read why.

Work through it in order. Part 2 explains the system in one page, and every later scenario refers back to it.

Time needed: about 2 to 3 hours for everything, or about 45 minutes for the core scenarios (marked **Core**).

---

## Part 1. Before you start

### 1.1 The repositories

| Repository | Role |
|---|---|
| https://github.com/Mahesh2511/devsecops-shared-github-actions | The shared framework: all the logic |
| https://github.com/Mahesh2511/backend-sample | A backend (Maven) repo that uses the framework |
| https://github.com/Mahesh2511/frontend-sample | A frontend (XML) repo that uses the framework |
| https://github.com/Mahesh2511/payments-service | A third repo that was onboarded later, as proof of reuse |

### 1.2 Choose how you'll work

You need permission to create branches in the repos you test with. Pick one route.

**Route A: you're a collaborator on Mahesh2511's repos** (the owner invited you under *Settings > Collaborators*). Work directly in `backend-sample` and `frontend-sample`. Branch protection is already set up. Skip to Part 2.

**Route B: you're anyone else (recommended for newcomers).** Make your own copies with **forks**. Your forks keep using the shared framework from `Mahesh2511/devsecops-shared-github-actions`, which is public, so everything works the same. Do these steps once:

1. **Fork `backend-sample`.** Open https://github.com/Mahesh2511/backend-sample and click **Fork** (top right). Keep the name, leave "Copy the main branch only" ticked, and click **Create fork**. You're now on `github.com/<you>/backend-sample`.
2. **Enable Actions in the fork.** Click the **Actions** tab. GitHub shows "Workflows aren't being run on this forked repository". Click **I understand my workflows, go ahead and enable them**.
3. **Run the workflow once.** Still on the Actions tab: click **Build** in the left list, then **Run workflow** (right side), keep branch `main`, and click the green **Run workflow**. Wait until it's green. This matters: GitHub only lets you pick a required check in step 4 if it has run recently.
4. **Protect `main`.** *Settings > Branches > Add branch protection rule* (or *Add classic branch protection rule*):
   - Branch name pattern: `main`
   - Tick **Require status checks to pass before merging**. In the search box type `PR checks` and select `build / PR Check / PR checks`.
   - Tick **Do not allow bypassing the above settings** (this applies it to admins too, meaning you).
   - Click **Create**.
5. **Repeat steps 1 to 4 for `frontend-sample`.**
6. **Optional (for scenario S20 only):** fork `devsecops-shared-github-actions` and enable its Actions the same way.

**One trap in forks:** when you open a pull request in a fork, GitHub often proposes the *original* repository (`Mahesh2511/...`) as the base. On the "Open a pull request" page, check the **base repository** dropdown and set it to **your fork** (`<you>/backend-sample`, base: `main`). Every PR in this guide goes to your own fork.

### 1.3 The GitHub screens you'll use

| Screen | How to get there | What it shows |
|---|---|---|
| File view | Click a file name | The file. The pencil icon (**Edit this file**) opens the editor |
| Commit dialog | **Commit changes...** in the editor | Message, and a choice: commit to the current branch, or **Create a new branch for this commit and start a pull request** |
| PR Conversation tab | Open the PR | Timeline and, at the bottom, the **merge box** with check results |
| PR Checks tab | **Checks** on the PR | Each job, with its steps and logs |
| Run summary | Actions tab > click a run | Jobs diagram, the **job summary** table and **annotations** |
| PR Files changed tab | **Files changed** on the PR | Your diff, with error annotations shown on files |

### 1.4 Two checks, three outcomes

Every PR in the consumer repos shows two checks:

- `build / PR Check / PR checks`: the artifact validation. This is the **required** check.
- `build / Build`: the build. It only runs when the PR check passed.

So you'll see one of three outcomes:

| PR checks | Build | Merge box |
|---|---|---|
| Pass | Pass | Green, merge allowed |
| Fail | Skipped | "Merging is blocked", required check failed |
| Never reports | (whatever) | Blocked, "Expected, waiting for status to be reported" |

---

## Part 2. The system in one page

```
Your repo: .github/workflows/build.yml
   "I am backend"  (artifact_type: backend)
   "I am frontend, XML is in config/"  (artifact_type: frontend, xml_path: config)
        |
        |  uses: Mahesh2511/devsecops-shared-github-actions/.github/workflows/build.yml@v1
        v
Shared build.yml
   job 1: pr-check  --->  pr_check.yml
                            step 1  check out YOUR repo's code
                            step 2  prcheck-utils-action
                                      backend:  every pom.xml must have the same artifactId
                                      frontend: every .xml under xml_path must be well-formed
                                      result -> result_map["artifact_consistency"] = { passed: true/false }
                                      block_merge = true if any required check failed
                            step 3  merge gate: fail this job unless block_merge is "false"
   job 2: build  (needs job 1; runs only if job 1 passed)
                            build-action: runs the build plan for artifact_type (mocked)

Branch protection on main: "build / PR Check / PR checks" must pass before merge.
```

Four rules explain almost everything you'll see:

1. **Your repo only declares what it is. The shared repo decides.** There's no validation code in the consumer repos. The type is never guessed from file names or the repo name.
2. **The check answers true or false.** The answer goes into `result_map` next to any other checks, and `block_merge` is true if any required check failed.
3. **The action reports; the gate step enforces.** A result on its own blocks nothing. The gate step turns `block_merge=true` into a failed job.
4. **A failed job skips the build (`needs`). A failed required check blocks the merge (branch protection).**

---

## Part 3. Read the code first (15 minutes)

- **Why:** the scenarios make much more sense once you've seen the few files involved.
- **Do:** open these in order, in the browser. For each one, the thing to look for is listed.

| # | File | What to look for |
|---|---|---|
| 1 | `backend-sample/.github/workflows/build.yml` | The whole consumer: `on: pull_request`, one `uses:` line, `artifact_type: backend` |
| 2 | `frontend-sample/.github/workflows/build.yml` | The same file, with `artifact_type: frontend` and `xml_path: config` |
| 3 | shared repo `.github/workflows/build.yml` | Job `pr-check` first; job `build` with `needs: pr-check` and the `if:` line |
| 4 | shared repo `.github/workflows/pr_check.yml` | The comments `[1]` checkout, `[2]` the action, `[3]` the merge gate |
| 5 | shared repo `actions/prcheck-utils-action/action.yml` | Inputs become `PRCHECK_*` environment variables, then `main.py` runs |
| 6 | shared repo `actions/prcheck-utils-action/main.py` | `VALIDATORS = {"backend": ..., "frontend": ...}` and `CHECKS` |
| 7 | shared repo `actions/prcheck-utils-action/utils/backend_validator.py` | `extract_artifact_id()`: only the `artifactId` directly under `<project>` |
| 8 | shared repo `actions/prcheck-utils-action/utils/frontend_validator.py` | Path checks, then parse every `.xml` |
| 9 | shared repo `actions/prcheck-utils-action/utils/result_utils.py` | `compute_block_merge()`: the whole pass/fail rule in about 15 lines |

- **Learn:** that's the complete system. The consumer file is 16 lines, and everything else lives in the shared repo.

---

## Part 4. Scenarios

Every scenario has the same layout: **Why** (the requirement), **Steps**, **Expect**, **Learn**. "Your backend repo" means `backend-sample` (Route A) or your fork of it (Route B).

**How to name branches:** start every test branch with `test/`, for example `test/mismatch`. Cleanup (Part 5) is then easy.

### S1. The framework tests itself

- **Why:** a shared library used by many repos must prove itself before every release.
- **Steps:**
  1. Open https://github.com/Mahesh2511/devsecops-shared-github-actions/actions and click **Framework CI** on the left.
  2. Open the latest green run.
  3. Look at the jobs: **Unit tests**, 11 jobs named **Action scenario: ...**, and 2 named **Build action: ...**.
  4. Open **Action scenario: backend-mismatch** and expand the steps **Run prcheck-utils-action** and **Assert block_merge**.
- **Expect:** the action logs `block_merge=true (failed required checks: artifact_consistency)`, and the job is still green, with `OK: block_merge=true as expected`.
- **Learn:** the job checks that the action *correctly blocks* a bad input. There's a difference between "the check failed" (the right answer here) and "the test of the check failed" (a bug). Every scenario in this guide also exists as an automated test in this CI.

### S2. A passing run, and how the input travels (**Core**)

- **Why:** exercise question 1: how does one workflow know backend from frontend, and how does that input flow through every layer?
- **Steps:**
  1. In your frontend repo: **Actions** tab > **Build** > **Run workflow** > branch `main` > **Run workflow**.
  2. Open the run when it appears. Both jobs should turn green.
  3. Click the job **build / PR Check / PR checks** and expand **Run PR checks (prcheck-utils-action)**.
  4. Find `"artifact_type": "frontend"` and `"xml_path": "config"` in the printed `result_map`.
  5. Go back to the run page and scroll down to the job summary **PR checks (prcheck-utils-action)**: a table with `artifact_consistency`, PASS and `block_merge = false`.
  6. Open the job **build / Build** and expand **Build artifact (build-action)**. It prints `MOCK step 1: npm ci`.
  7. Repeat for your backend repo. You'll see `"artifact_type": "backend"` and `MOCK step 1: mvn -B -ntp verify`.
- **Expect:** all green, as described.
- **Learn:** the value you typed in the consumer file arrived unchanged, four hops later: consumer -> `build.yml` -> `pr_check.yml` -> action -> Python. Both repos used the same shared code, and only that one line was different.

### S3. Backend: one artifactId differs (**Core**)

- **Why:** the main backend rule. All `pom.xml` files must declare the same `artifactId`.
- **Steps:**
  1. In your backend repo, open `service-b/pom.xml` and click the pencil icon.
  2. On **line 14** (below the comment, *not* the one inside `<parent>`), change `<artifactId>sample-service</artifactId>` to `<artifactId>another-service</artifactId>`.
  3. **Commit changes...** > message `test: change service-b artifactId` > choose **Create a new branch for this commit and start a pull request** > branch name `test/mismatch` > **Propose changes**.
  4. On the next page (Route B: check the base repository is your fork) click **Create pull request**.
  5. Wait about a minute. Watch the merge box at the bottom of the PR.
  6. Open the **Checks** tab > **build / PR Check / PR checks** > expand **Run PR checks** and **Enforce merge gate**.
- **Expect:**
  - `build / PR Check / PR checks` fails, and `build / Build` is **skipped**.
  - The log shows `artifactId mismatch: 2 distinct values found: 'another-service' in service-b/pom.xml; 'sample-service' in pom.xml, service-a/pom.xml` and `block_merge=true`.
  - The gate step shows `Merge blocked: block_merge=true...`.
  - The merge box says merging is blocked because a required check failed. The merge button is disabled.
- **Learn:** you've now seen all three mechanisms at once (exercise questions 2 and 4):
  1. The action produced `block_merge=true` and the gate step failed the job.
  2. `needs: pr-check` skipped the build.
  3. Branch protection blocked the merge.
  The error is attached to the check rather than a file, because a mismatch involves several files.

### S4. Fix it on the same PR (**Core**)

- **Why:** developers fix and push; the check re-runs on its own.
- **Steps:**
  1. On the PR, open **Files changed**, click the **...** menu on `service-b/pom.xml` > **Edit file**. (Or go to the repo, switch the branch dropdown to `test/mismatch`, open the file and click the pencil icon.)
  2. Change line 14 back to `sample-service`.
  3. **Commit changes...** > keep **Commit directly to the test/mismatch branch** > **Commit changes**.
  4. Return to the PR and wait.
- **Expect:** both checks pass and the merge box turns green.
- **Learn:** every push to a PR branch re-runs the check. Don't merge; you'll close the PR in cleanup.

### S5. Only the project's own artifactId counts

- **Why:** a real POM has other `artifactId` elements (in `<parent>` and dependencies). Comparing those would make every repo fail.
- **Steps:**
  1. Edit `service-b/pom.xml` again, starting from `main`.
  2. This time change **line 9**, the one inside `<parent>`, to `<artifactId>renamed-parent</artifactId>`. Leave line 14 alone.
  3. Commit to a new branch `test/parent-only` and create the PR.
- **Expect:** both checks pass.
- **Learn:** the validator reads only the `artifactId` that is a direct child of `<project>`. That's the most important correctness detail of the backend rule.

### S6. Backend: missing artifactId

- **Why:** "fail safely". A POM without its own `artifactId` must fail, not be skipped.
- **Steps:** from `main`, edit `service-b/pom.xml`, **delete line 14** entirely, commit to a new branch `test/missing-id` and create the PR.
- **Expect:** the PR check fails with `service-b/pom.xml: no project-level <artifactId> element (a direct child of <project>)`. Note it doesn't pick up the `artifactId` inside `<parent>` instead. On **Files changed**, the error annotation is attached to `service-b/pom.xml`, because this error belongs to a single file.
- **Learn:** a missing value is an error, never a pass.

### S7. Backend: malformed pom.xml

- **Steps:** from `main`, edit `service-a/pom.xml`, delete the line `</parent>`, commit to a new branch `test/malformed-pom` and create the PR.
- **Expect:** the PR check fails with `service-a/pom.xml: malformed XML: mismatched tag: line ..., column ...`, and the build is skipped.
- **Learn:** parse errors come with a position, so the fix is quick.

### S8. Any layout, any depth

- **Why:** "do not assume a fixed module structure". Repos have any number of modules at any depth.
- **Steps:**
  1. From `main`: **Add file** > **Create new file**.
  2. In the name box type `libs/deep/nested/core/pom.xml`. Each `/` creates a folder.
  3. Paste:
     ```xml
     <project xmlns="http://maven.apache.org/POM/4.0.0">
       <modelVersion>4.0.0</modelVersion>
       <artifactId>sample-service</artifactId>
     </project>
     ```
  4. Commit to a new branch `test/deep-module`, create the PR, and wait. It should pass.
  5. Open the PR check log: `files_inspected` now lists `libs/deep/nested/core/pom.xml` as well.
  6. On the same branch, edit the new file, change the `artifactId` to `deep-service` and commit to the branch.
- **Expect:** first a pass with 4 files inspected, then a failure naming `libs/deep/nested/core/pom.xml`.
- **Learn:** the scan is recursive from the repo root. Nothing had to be configured to include the new folder.

### S9. Backend: no pom.xml at all (optional)

- **Why:** a repo declared as backend with no POM is misconfigured. "Nothing to check" must not count as a pass.
- **Steps:** on a new branch `test/no-pom` (create it from the branch dropdown: type `test/no-pom` > **Create branch test/no-pom from main**), delete the three POMs one by one: open each file > **...** menu > **Delete file** > commit to `test/no-pom`. Then open a PR from `test/no-pom`.
- **Expect:** `No pom.xml files found in the repository; a backend artifact must contain at least one.`

### S10. Frontend: malformed XML, then fixed (**Core**)

- **Why:** the frontend rule. Every XML file under `xml_path` must be well-formed.
- **Steps:**
  1. In your frontend repo, edit `config/settings.xml`. On **line 7**, change `<theme>light</theme>` to `<theme>light` (remove the closing tag).
  2. Commit to a new branch `test/broken-xml` and create the PR.
  3. After it fails, look at **Files changed**: the error annotation is attached to `config/settings.xml`.
  4. Put `</theme>` back on the same branch (as in S4) and commit.
- **Expect:** first `config/settings.xml: mismatched tag: line 8, column 2` with the build skipped, then everything green.
- **Learn:** the other two XML files were still reported under `valid_files`. Every bad file is listed, not just the first.

### S11. The XML folder is the repo's own choice

- **Why:** "do not hard-code xyz". The folder comes from configuration.
- **Steps:**
  1. From `main`: **Add file** > **Create new file** > name `ui/labels/en.xml` > content `<labels><l id="ok">OK</l></labels>` > commit to a new branch `test/custom-path` and create the PR.
  2. On that branch, edit `.github/workflows/build.yml`: change `xml_path: config` to `xml_path: ui`. Commit to the branch.
  3. Open the latest PR check log and find `files_inspected`.
- **Expect:** pass, with only `ui/labels/en.xml` inspected. `config/` isn't scanned any more.
- **Learn:** the shared code has no folder name in it. For `pull_request` runs, GitHub uses the workflow file from the PR itself, which is why your change took effect immediately.

### S12. Frontend: wrong or missing path

- **Steps:** on the same `test/custom-path` branch, edit `.github/workflows/build.yml` again:
  1. Set `xml_path: missing-folder` and commit. Wait for the result.
  2. Then delete the `xml_path:` line entirely and commit. Wait for the result.
  3. Then set `xml_path: config/settings.xml` (a file, not a folder) and commit. Wait for the result.
- **Expect:**
  1. `Configured xml_path 'missing-folder' does not exist in the repository.`
  2. `xml_path is required when artifact_type is 'frontend'; ...`
  3. `Configured xml_path 'config/settings.xml' is not a directory.`
  The build is skipped each time.
- **Learn:** configuration mistakes fail with a message that says how to fix them.

### S13. Only XML inside the configured folder counts

- **Why:** the check must validate exactly what the repo declared, and nothing else.
- **Steps:** from `main`, create `notes/broken.xml` with the content `<broken>` (deliberately malformed) and also `config/readme.txt` with any text. Commit both to a new branch `test/scope` (create the second file with **Commit directly to the test/scope branch**) and create the PR.
- **Expect:** pass. `notes/broken.xml` is outside `config/`, and `readme.txt` isn't an XML file.

### S14. An unsupported artifact_type (**Core**)

- **Why:** the input that selects the behaviour must never pass silently when it's wrong.
- **Steps:** from `main`, edit `.github/workflows/build.yml` in either repo and change `artifact_type` to `mobile`. Commit to a new branch `test/bad-type` and create the PR.
- **Expect:** `Unsupported artifact_type 'mobile'. Supported values: backend, frontend.` The build is skipped.
- **Learn:** GitHub reusable workflows can't restrict input values, so the framework checks them in one place. Also try `artifact_type: backend` in the **frontend** repo: it fails with `No pom.xml files found`. This proves the framework does exactly what the repo declares and never guesses the type itself.

### S15. Try to bypass the check

- **Why:** since a PR can change its own workflow file (S11), could a developer just remove the check?
- **Steps:** from `main`, edit `.github/workflows/build.yml` in either repo and replace everything from `jobs:` downward with:
  ```yaml
  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - run: echo "skipping the shared PR checks"
  ```
  Commit to a new branch `test/bypass` and create the PR.
- **Expect:** a check named `build` passes, but the merge box still says merging is blocked. The required check `build / PR Check / PR checks` is listed as **Expected, waiting for status to be reported**.
- **Learn:** branch protection asks for a specific check by name. Deleting it doesn't satisfy it. In an organization, "required workflows" in a ruleset go further, running the check from the central repo whatever the PR changes.

### S16. Branch protection itself

- **Steps:**
  1. Your backend repo > **Settings** > **Branches** (or **Rules**) > open the rule for `main`. Note the required check `build / PR Check / PR checks` and the "do not allow bypassing" setting.
  2. Try to commit straight to `main`: open `README.md`, click the pencil icon, make a small change, click **Commit changes...**.
- **Expect:** GitHub doesn't let you commit to `main` directly. The dialog steers you to a new branch and a PR, or the commit is rejected because the required status check is missing.
- **Learn:** the workflow makes a job fail; only this *repository setting* turns that failure into a blocked merge.

### S17. Versions: what pinning to a tag means

- **Why:** a change to the shared repo reaches every consumer. Tags decide when.
- **Steps:**
  1. Look at the tags: shared repo > **Code** tab > branch dropdown > **Tags**. There are `v1.0.0`, `v1.0.1`, `v1.1.0` and `v1`.
  2. In your backend repo, from `main`, edit `.github/workflows/build.yml` and change `build.yml@v1` to `build.yml@v1.0.0`. Commit to a new branch `test/pin-old` and create the PR.
  3. When it's done, open the **Checks** tab.
- **Expect:**
  - The build job is now called `build / Build (backend)`, and its steps are `Build backend artifact (mock)` and `Build frontend artifact (mock)`. That's how the first release worked, before build-action existed.
  - Open the PR check job's **Set up job** step: `build.yml` and `pr_check.yml` come from `v1.0.0`, but the action is downloaded as `...@v1`. The inner action reference floats to the latest `v1`.
  - The PR is still mergeable, because the required check's name is the same in every version.
- **Learn:** `@v1` means "compatible updates", `@v1.0.0` means "this exact release", and `@main` would mean "whatever was merged last", which is never right for consumers.

### S18. Onboard a brand-new repository (the reuse proof)

- **Why:** the design goal is reuse across every current and future repo. Prove it with a repo the framework has never seen.
- **Steps:**
  1. Top right **+** > **New repository**. Name `my-new-service`, Public, tick **Add a README file**, **Create repository**.
  2. **Add file** > **Create new file** > name `pom.xml`:
     ```xml
     <project xmlns="http://maven.apache.org/POM/4.0.0">
       <modelVersion>4.0.0</modelVersion>
       <groupId>com.acme</groupId>
       <artifactId>orders</artifactId>
       <version>1</version>
     </project>
     ```
     **Commit changes** (directly to `main` is fine here; the repo isn't protected yet).
  3. Create `api/v2/core/pom.xml` the same way, with the same `artifactId` (`orders`).
  4. Open https://github.com/Mahesh2511/devsecops-shared-github-actions/blob/main/templates/consumer-build.yml, click **Raw**, and copy everything.
  5. In your new repo: **Add file** > **Create new file** > name `.github/workflows/build.yml` > paste > **Commit changes**.
  6. **Actions** tab > **Build** > **Run workflow**.
- **Expect:** both jobs pass. The log lists `api/v2/core/pom.xml` and `pom.xml` with artifactId `orders`. New names and a new layout worked with no framework change.
- **Learn:** onboarding is one copied file. For a real repo, finish with branch protection (Part 1.2 step 4). You can see the same result in https://github.com/Mahesh2511/payments-service.

### S19. How a new check joins the existing gate (reading exercise)

- **Why:** exercise question 4: the result must feed the *existing* block-merge mechanism used by other checks.
- **Steps:**
  1. Open the shared repo's `actions/prcheck-utils-action/utils/result_utils.py` and read `compute_block_merge()`.
  2. Open `tests/test_result_utils.py` and read `test_existing_failure_still_blocks_even_if_artifact_check_passes` and `test_non_required_failures_do_not_block`.
  3. Open `action.yml` and find the `result_map` input.
- **Learn:**
  - Earlier checks pass their `result_map` in, and the artifact check adds one entry to it.
  - `block_merge` is true if *any* required entry didn't pass. So a failing security check blocks even when the artifact check passes, and the other way round.
  - A check marked `required: false` is reported but never blocks. That's how a new rule can be rolled out safely.
  The unit tests in S1 prove all of this on every change.

### S20. Change the framework safely (needs your fork of the shared repo)

- **Why:** see how the shared library protects every consumer from a bad change.
- **Steps:**
  1. In your fork of `devsecops-shared-github-actions` (Actions enabled), open `tests/fixtures/backend/pass/core/pom.xml`.
  2. On **line 9**, change `orders-api` to `orders-API`.
  3. Commit to a new branch `test/break-fixture` and open a PR *into your fork's main*.
- **Expect:** **Framework CI** fails. **Unit tests** reports 4 failures, and **Action scenario: backend-pass** says `Expected block_merge=false but got 'true'`.
- **Learn:**
  - Changes reach consumers only after they pass CI, get merged, get tagged, and `v1` is moved. A broken change is caught before any repo sees it.
  - This also shows that the comparison is case-sensitive, like Maven coordinates.

---

## Part 5. Cleanup

1. **Close each test PR.** Open it > **Close pull request** > **Delete branch**.
2. **Delete leftover branches.** Repo > **branches** link (next to the branch dropdown) > trash icon on each `test/...` branch.
3. **Optional:** delete the repos you created for S18. Repo > **Settings** > bottom of the page > **Delete this repository**. Forks can be deleted the same way.

---

## Part 6. Check your understanding

If you can answer these without looking, you understand the framework.

1. Which single line tells the framework whether a repo is backend or frontend? Does it ever guess? (S2, S14)
2. Name every hop the value passes through before Python reads it. (S2)
3. Whose code does the checkout in `pr_check.yml` fetch? (Part 3, file 4)
4. Why did S5 pass but S3 fail, when both changed an `artifactId` in the same file? (S5)
5. What does `block_merge=true` do on its own? What makes it a failed check? (S3, rule 3)
6. What skips the build, and what blocks the merge? (S3)
7. Why is only `build / PR Check / PR checks` required, and not `build / Build`? (S3: a skipped required check counts as passing)
8. Why can't a developer escape the check by deleting it from their workflow? (S15)
9. Why is the folder name never in the shared code? (S11)
10. What does a failing security check do when the artifact check passes? (S19)
11. How does a brand-new repo start using the framework? (S18)
12. What do `@v1` and `@v1.0.0` each give a consumer, and what's the one surprise? (S17)
13. How is a bad framework change stopped before it reaches any repo? (S20)

---

## Appendix. If something doesn't match

| What you see | Why, and what to do |
|---|---|
| No checks appear on your PR (Route B) | Actions aren't enabled in your fork. **Actions** tab > enable them, then push any change to the PR branch |
| The PR opened against `Mahesh2511/...` instead of your fork | Close it and open a new PR with the base repository set to your fork |
| The merge button is green although the check failed (Route B) | Branch protection isn't set in your fork. See Part 1.2 step 4 |
| `build / PR Check / PR checks` isn't offered when you create the rule | It must have run at least once recently. Run the workflow from the Actions tab first |
| The check failed but you expected a pass | Open the **Run PR checks** step. The `errors` list in `result_map` says exactly which file and why |
| You changed line 9 instead of line 14 in S3 | That's S5, the parent reference, which correctly still passes |
