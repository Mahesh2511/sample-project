# Hands-on test guide

Private practice notes, not pushed to any repository.

Work through this guide once, in order, and you'll have run every scenario yourself and seen every part of the system react. Each exercise has the same five parts:

- **Why**: the requirement or risk behind it
- **What we built**: the code that handles it
- **Do**: the exact commands or clicks
- **Expect**: what you should see
- **Learn**: the point to remember (and to say in the interview)

Time needed: about 60 minutes for Part C (local), about 90 minutes for Part D (GitHub).

---

## Part A. Setup

### A1. Tools

Open **Git Bash** (all commands below are bash). Check:

```bash
python --version        # 3.8 or newer
git --version
gh auth status          # must say: Logged in to github.com account Mahesh2511
```

If `gh` isn't logged in: `gh auth login -h github.com -w`, then `gh auth refresh -h github.com -s workflow`. You need the `workflow` scope to push changes to files under `.github/workflows/`.

### A2. Folders

```
E:\Task\
  implementation\
    shared-devsecops\     -> github.com/Mahesh2511/devsecops-shared-github-actions
    backend-sample\       -> github.com/Mahesh2511/backend-sample
    frontend-sample\      -> github.com/Mahesh2511/frontend-sample
  apache-maven-3.9.16\    Maven (not on PATH)
  interview-prep\         this guide and the interview Q&A
  playground\             create it now: scratch copies for local experiments
```

```bash
mkdir -p /e/Task/playground
cd /e/Task/implementation
# Short aliases for this terminal session:
PRCHECK="python /e/Task/implementation/shared-devsecops/actions/prcheck-utils-action/main.py"
BUILD="python /e/Task/implementation/shared-devsecops/actions/build-action/main.py"
FIX=/e/Task/implementation/shared-devsecops/tests/fixtures
PLAY=/e/Task/playground
```

If you open a new terminal, run the four alias lines again.

Local experiments always use **copies in the playground**, so the real repos stay clean.

---

## Part B. The mental model (read this first)

```
consumer repo  .github/workflows/build.yml      "I am backend" (artifact_type)
     |  uses shared build.yml@v1
     v
shared build.yml
     job pr-check  ---------->  pr_check.yml
                                  1. checkout the consumer's code
                                  2. prcheck-utils-action (artifact_type, xml_path)
                                        main.py -> backend or frontend validator
                                        -> result_map["artifact_consistency"] = {passed: true/false}
                                        -> block_merge = any required check failed
                                  3. gate: fail the job unless block_merge == "false"
     job build  (needs pr-check, and block_merge must be "false")
                                  checkout -> build-action -> build plan for artifact_type

GitHub branch protection: the check "build / PR Check / PR checks" must pass before merge.
```

Four rules explain almost everything:

1. **The consumer only declares; the shared repo decides.** No logic lives in consumer repos.
2. **The validator returns true or false. The result goes into `result_map`, and `block_merge` is computed over all checks.**
3. **The action reports; the gate step enforces.** The action always exits 0 with a verdict, and the gate step fails the job.
4. **A failed job skips the build (`needs`), and a failed required check blocks the merge (branch protection).**

Keep this picture in mind. Every exercise below tests one arrow or one box of it.

---

## Part C. Local tests (no GitHub needed)

Everything here runs `main.py` exactly as the GitHub action does, just from your terminal. The flag `--enforce` makes the exit code 1 when `block_merge=true`, so you can see pass or fail with `echo "exit=$?"`.

### C1. Run the whole test suite

- **Why:** before touching anything, prove that the code works as shipped.
- **What we built:** 36 unit tests in `shared-devsecops/tests/`, covering both validators, result_map, block_merge, the GitHub output format and build-action.
- **Do:**
  ```bash
  cd /e/Task/implementation/shared-devsecops
  python -m unittest discover -s tests -v
  # one module only:
  python -m unittest discover -s tests -p "test_frontend*.py" -v
  # one single test:
  (cd tests && python -m unittest test_backend_validator.BackendValidatorTest.test_fail_when_one_artifact_id_differs)
  ```
- **Expect:** `Ran 36 tests ... OK`.
- **Learn:** the tests read like a specification. Open `tests/test_backend_validator.py` and read the test names: each one is a requirement.

### C2. Backend PASS on the real sample

- **Why:** the requirement says all `artifactId` values must match.
- **What we built:** `utils/backend_validator.py` finds every `pom.xml` recursively, reads the project-level `artifactId` and groups files by value. One group means pass.
- **Do:**
  ```bash
  cd /e/Task/implementation
  $PRCHECK --artifact-type backend --workspace backend-sample --enforce; echo "exit=$?"
  ```
- **Expect:** the JSON shows `files_inspected` (3 files), `distinct_artifact_ids: ["sample-service"]`, `"passed": true`, then `block_merge=false` and `exit=0`.
- **Learn:** read the whole JSON once. It's exactly what goes into `result_map` on GitHub.

### C3. Backend FAIL: one artifactId differs

- **Why:** this is the main failure the check exists for.
- **Do:**
  ```bash
  rm -rf $PLAY/b-mismatch && cp -r backend-sample $PLAY/b-mismatch
  # service-b/pom.xml has two artifactIds: the <parent> one (1st) and the project one (2nd).
  # This changes every match after the first one, i.e. only the project-level one:
  sed -i '0,/<artifactId>sample-service<\/artifactId>/! s#<artifactId>sample-service</artifactId>#<artifactId>another-service</artifactId>#' $PLAY/b-mismatch/service-b/pom.xml
  grep -n artifactId $PLAY/b-mismatch/service-b/pom.xml
  $PRCHECK --artifact-type backend --workspace $PLAY/b-mismatch --enforce; echo "exit=$?"
  ```
  (Or open the file in an editor and change the `artifactId` that comes after `</parent>`.)
- **Expect:** `"passed": false`, the error `artifactId mismatch: 2 distinct values found: 'another-service' in service-b/pom.xml; 'sample-service' in pom.xml, service-a/pom.xml`, then `block_merge=true` and `exit=1`.
- **Learn:** the message names both values *and* the files, so the developer knows what to fix without reading code.

### C4. Only the project's own artifactId counts

- **Why:** every real POM has other `artifactId` elements (inside `<parent>`, `<dependencies>`, `<plugins>`). Comparing those would make every repo fail.
- **What we built:** `extract_artifact_id()` only reads the `artifactId` that is a direct child of `<project>`, and it strips the Maven namespace.
- **Do:** change only the parent reference (the first match):
  ```bash
  rm -rf $PLAY/b-parent && cp -r backend-sample $PLAY/b-parent
  sed -i '0,/<artifactId>sample-service<\/artifactId>/ s#<artifactId>sample-service</artifactId>#<artifactId>renamed-parent</artifactId>#' $PLAY/b-parent/service-b/pom.xml
  grep -n artifactId $PLAY/b-parent/service-b/pom.xml
  $PRCHECK --artifact-type backend --workspace $PLAY/b-parent --enforce; echo "exit=$?"
  ```
- **Expect:** still `block_merge=false`, `exit=0`.
- **Learn:** this is the most important correctness detail of the backend rule. Also look at `tests/fixtures/backend/pass/`: its modules use a different parent ID and a dependency, on purpose.

### C5. Recursive scan, any layout

- **Why:** "do not assume a fixed module structure."
- **Do:**
  ```bash
  mkdir -p $PLAY/b-mismatch/libs/deep/nested/core
  printf '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><artifactId>sample-service</artifactId></project>\n' > $PLAY/b-mismatch/libs/deep/nested/core/pom.xml
  $PRCHECK --artifact-type backend --workspace $PLAY/b-mismatch | grep -A6 files_inspected
  ```
- **Expect:** the new `libs/deep/nested/core/pom.xml` appears in `files_inspected`. Nothing had to be configured.
- **Learn:** the number, names and depth of modules don't matter. Only `.git/` is skipped.

### C6. Backend errors that must fail safely

- **Why:** "do not convert configuration or parsing errors into successful validation."
- **Do:** run each and read the error:
  ```bash
  $PRCHECK --artifact-type backend --workspace $FIX/backend/missing_artifact_id --enforce; echo "exit=$?"
  $PRCHECK --artifact-type backend --workspace $FIX/backend/malformed --enforce; echo "exit=$?"
  $PRCHECK --artifact-type backend --workspace $FIX/backend/no_pom --enforce; echo "exit=$?"
  ```
- **Expect:**
  - `module-a/pom.xml: no project-level <artifactId> element (a direct child of <project>)`
  - `module-a/pom.xml: malformed XML: mismatched tag: line ..., column ...`
  - `No pom.xml files found in the repository; a backend artifact must contain at least one.`
  - `exit=1` every time.
- **Learn:** "nothing to check" is a failure, not a pass. A repo declared as backend with no POM is misconfigured.

### C7. Frontend PASS on the real sample

- **Why:** frontend rule: every XML file under a configured path must be well-formed.
- **What we built:** `utils/frontend_validator.py` resolves `xml_path` safely, finds every `*.xml` below it and parses each one.
- **Do:**
  ```bash
  $PRCHECK --artifact-type frontend --xml-path config --workspace frontend-sample --enforce; echo "exit=$?"
  ```
- **Expect:** `valid_files` lists 3 files under `config/`, `invalid_files` is empty, `exit=0`.

### C8. Frontend FAIL: malformed XML

- **Do:**
  ```bash
  rm -rf $PLAY/f-broken && cp -r frontend-sample $PLAY/f-broken
  sed -i 's#<theme>light</theme>#<theme>light#' $PLAY/f-broken/config/settings.xml
  $PRCHECK --artifact-type frontend --xml-path config --workspace $PLAY/f-broken --enforce; echo "exit=$?"
  ```
- **Expect:** `config/settings.xml: mismatched tag: line 8, column 2`. `valid_files` still lists the other 2 files. `exit=1`.
- **Learn:** it reports every bad file with line and column, not just the first one.

### C9. The path is configuration, not code

- **Why:** "do not hard-code xyz"; each repo can keep its XML anywhere.
- **Do:**
  ```bash
  mkdir -p $PLAY/f-custom/src/main/resources/i18n
  printf '<strings><s id="hi">Hello</s></strings>\n' > $PLAY/f-custom/src/main/resources/i18n/en.XML
  printf '<broken>\n' > $PLAY/f-custom/outside.xml          # malformed, but outside xml_path
  printf '{ not xml' > $PLAY/f-custom/src/main/resources/notes.json
  $PRCHECK --artifact-type frontend --xml-path src/main/resources --workspace $PLAY/f-custom --enforce; echo "exit=$?"
  ```
- **Expect:** pass. `en.XML` is found (the extension match is case-insensitive), `outside.xml` is ignored because it's outside the path, and `notes.json` is ignored because it isn't XML.
- **Learn:** the validator does exactly what the consumer declares and nothing more.

### C10. Frontend configuration errors

- **Do:**
  ```bash
  $PRCHECK --artifact-type frontend --xml-path does-not-exist --workspace frontend-sample | grep summary
  $PRCHECK --artifact-type frontend --workspace frontend-sample | grep summary
  $PRCHECK --artifact-type frontend --xml-path config/settings.xml --workspace frontend-sample | grep summary
  $PRCHECK --artifact-type frontend --xml-path ../../etc --workspace frontend-sample | grep summary
  $PRCHECK --artifact-type frontend --xml-path xyz --workspace $FIX/frontend/empty | grep summary
  ```
- **Expect:** in order:
  - `Configured xml_path 'does-not-exist' does not exist in the repository.`
  - `xml_path is required when artifact_type is 'frontend'; ...`
  - `Configured xml_path 'config/settings.xml' is not a directory.`
  - `xml_path '../../etc' resolves outside the repository root; ...`
  - `No .xml files found under xml_path 'xyz'.`
- **Learn:** inputs come from a workflow file that is part of the PR, so they're untrusted. Path traversal is rejected by `resolve_within()` in `utils/fs_utils.py`.

### C11. The artifact_type input

- **Why:** the single input that selects behaviour. It must never pass silently when wrong.
- **What we built:** `run_artifact_consistency()` in `main.py` normalizes the value and looks it up in the `VALIDATORS` registry.
- **Do:**
  ```bash
  $PRCHECK --artifact-type mobile   --workspace backend-sample | grep summary
  $PRCHECK --artifact-type ""       --workspace backend-sample | grep summary
  $PRCHECK --artifact-type " Backend " --workspace backend-sample | tail -1
  ```
- **Expect:** `Unsupported artifact_type 'mobile'. Supported values: backend, frontend.`, then `artifact_type is required...`, then `block_merge=false` (case and spaces are normalized).
- **Learn:** `workflow_call` inputs can't declare allowed values (no enum), so validation happens once, here. Adding a type later means adding one registry entry.

### C12. result_map: joining the existing gate

- **Why:** the exercise says the check must use the **existing** result_map / block-merge mechanism, not a new one.
- **What we built:** the action takes an incoming `result_map` from earlier checks, adds `artifact_consistency`, and computes `block_merge` over all entries (`compute_block_merge()` in `utils/result_utils.py`).
- **Do:**
  ```bash
  # an existing check failed, ours passes -> still blocked
  $PRCHECK --artifact-type backend --workspace backend-sample --result-map '{"security_check":{"passed":false,"summary":"CVE found"}}' | tail -1
  # an existing check passed, ours passes -> not blocked, both keys present
  $PRCHECK --artifact-type backend --workspace backend-sample --result-map '{"security_check":{"passed":true}}' | grep -E '"security_check"|block_merge'
  # an advisory check (required=false) failing does not block
  $PRCHECK --artifact-type backend --workspace backend-sample --result-map '{"lint":{"passed":false,"required":false}}' | tail -1
  # garbage input blocks
  $PRCHECK --artifact-type backend --workspace backend-sample --result-map '{oops' | tail -1
  ```
- **Expect:** `block_merge=true (failed required checks: security_check)`, then both keys with `block_merge=false`, then `block_merge=false`, then `block_merge=true (failed required checks: result_map_input)`.
- **Learn:** the artifact check has no special power. It's one vote among all required checks. This is the answer to exercise question 4.

### C13. See exactly what GitHub sees

- **Why:** on GitHub, the action talks to the runner through files and log commands. You can simulate that locally.
- **What we built:** `write_outputs()` (heredoc format in `$GITHUB_OUTPUT`), `write_step_summary()` (markdown table) and `emit_annotations()` (`::error file=...::` lines).
- **Do:**
  ```bash
  touch $PLAY/out $PLAY/summary; : > $PLAY/out; : > $PLAY/summary
  GITHUB_ACTIONS=true GITHUB_OUTPUT=$PLAY/out GITHUB_STEP_SUMMARY=$PLAY/summary \
    $PRCHECK --artifact-type frontend --xml-path config --workspace $PLAY/f-broken | grep '^::'
  echo "----- outputs file"; cat $PLAY/out
  echo "----- summary file"; cat $PLAY/summary
  ```
- **Expect:** a line `::error file=config/settings.xml,title=PR check%3A artifact_consistency::...`; the outputs file with `result_map<<EOF_...` JSON and `block_merge=true`; a markdown table in the summary file.
- **Learn:** these three files and lines are the whole interface between Python and GitHub. The exit code is still 0: the action reports and the gate enforces.

### C14. The gate step logic

- **Why:** an output value blocks nothing on its own. Something must fail the job, and it must fail safe.
- **What we built:** the `Enforce merge gate` step in `pr_check.yml`, which passes only on the literal `false`.
- **Do:** paste the gate logic into your terminal:
  ```bash
  gate() { BLOCK_MERGE="$1"; if [ "$BLOCK_MERGE" = "false" ]; then echo "PASS"; else echo "FAIL (block_merge=${BLOCK_MERGE:-<unset>})"; fi; }
  gate false; gate true; gate ""; gate False
  ```
- **Expect:** only the first prints PASS.
- **Learn:** a crash, a renamed output or a typo leaves the value empty, and empty blocks. Checking `== "true"` instead would have let those through.

### C15. build-action

- **Why:** the diagram shows a build action next to the PR check action. It must build according to the same `artifact_type`.
- **What we built:** `actions/build-action/` with `action.yml`, `main.py` and `utils/build_plans.py` (the `BUILD_PLANS` registry).
- **Do:**
  ```bash
  $BUILD --artifact-type backend; $BUILD --artifact-type frontend; $BUILD --artifact-type mobile; echo "exit=$?"
  ```
- **Expect:** a Maven plan, an npm plan, then `ERROR: Unsupported artifact_type 'mobile'...` with `exit=1`.
- **Learn:** it's mocked (it prints the plan), because the real build commands are private and the backend sample can't build with Maven (see C17).

### C16. Lint the workflows (optional)

- **Why:** YAML mistakes only show up on GitHub unless you lint.
- **Do:**
  ```bash
  python -m pip install --target $PLAY/al actionlint-py
  cp -r /e/Task/implementation/shared-devsecops $PLAY/lint && cd $PLAY/lint && git init -q && $PLAY/al/bin/actionlint.exe -shellcheck= && echo "actionlint clean"; cd /e/Task/implementation
  ```
- **Expect:** `actionlint clean`.
- **Learn:** actionlint also checks that the inputs `build.yml` passes to `pr_check.yml` match what `pr_check.yml` declares.

### C17. The Maven caveat

- **Why:** you must be able to explain the one place where the requirement conflicts with Maven itself.
- **Do:**
  ```bash
  cd /e/Task/implementation/backend-sample && /e/Task/apache-maven-3.9.16/bin/mvn -B -q validate; cd ..
  ```
- **Expect:** `Project 'com.example:sample-service:1.0.0-SNAPSHOT' is duplicated in the reactor`.
- **Learn:** Maven needs unique module artifactIds, but the requirement says they must all match. We implemented the requirement as written, documented the conflict and would confirm the real intent with the framework owners. This is a strong interview point: you found a flaw in the spec by testing.

---

## Part D. GitHub tests

In Part C you ran the logic. Here you watch the real chain: consumer -> build.yml -> pr_check.yml -> action -> gate -> build -> branch protection.

**Branch protection is on** for `main` in both sample repos, so you can't push to `main` there. Every experiment is a branch plus a PR, which is exactly how developers would meet the check.

**Where to look on GitHub for any run:**
- PR page, *Checks* tab: `build / PR Check / PR checks` and `build / Build`.
- Click the PR check job. Step **Run PR checks** shows the full `result_map`. Step **Enforce merge gate** shows the gate decision.
- The job's **Summary** page shows the check table and `block_merge`.
- *Files changed* tab: annotations appear inline on the broken file.
- Bottom of the PR *Conversation* tab: the merge box.

Useful commands:

```bash
gh run list -R Mahesh2511/backend-sample -L 5                  # recent runs
gh run watch -R Mahesh2511/backend-sample                      # follow the latest run live
gh run view <run-id> -R Mahesh2511/backend-sample --log-failed # only the failing step logs
gh pr checks <pr-number> -R Mahesh2511/backend-sample          # check status of a PR
```

### D1. The framework tests itself

- **Why:** a shared library used by many repos must prove itself before every release.
- **What we built:** `ci.yml` in the shared repo: unit tests, 11 scenario jobs that run the real `prcheck-utils-action` on fixtures and assert `block_merge`, and 2 build-action jobs.
- **Do:**
  ```bash
  gh workflow run ci.yml -R Mahesh2511/devsecops-shared-github-actions --ref main
  gh run watch -R Mahesh2511/devsecops-shared-github-actions
  ```
  Then open the run in the browser: *Actions* tab > *Framework CI*.
- **Expect:** 14 green jobs. Open `Action scenario: backend-mismatch`: the action reported `block_merge=true`, and the job is green because the *assertion* matched the expectation.
- **Learn:** there's a difference between "the check fails" and "the test of the check passes". In ci.yml the action is used with `./actions/...`, because here the shared repo is the checked-out code.

### D2. A pass run without a PR

- **Do:**
  ```bash
  gh workflow run build.yml -R Mahesh2511/backend-sample --ref main
  gh workflow run build.yml -R Mahesh2511/frontend-sample --ref main
  gh run watch -R Mahesh2511/frontend-sample
  ```
- **Expect:** `build / PR Check / PR checks` passes, then `build / Build` passes.
- **Look:** in the PR check job, step *Run PR checks*, find `"artifact_type": "frontend"` and `"xml_path": "config"`. That's the input you set in the consumer file, which arrived four hops later. In the *Build* job, the build-action step prints the npm plan.
- **Learn:** you've just seen the input flow (exercise question 1) with your own eyes.

### D3. Backend mismatch PR (the main demo)

- **Do:**
  ```bash
  cd /e/Task/implementation/backend-sample
  git switch main && git pull -q
  git switch -c test/mismatch
  sed -i '0,/<artifactId>sample-service<\/artifactId>/! s#<artifactId>sample-service</artifactId>#<artifactId>another-service</artifactId>#' service-b/pom.xml
  git diff
  git commit -am "test: change service-b artifactId" && git push -u origin test/mismatch
  gh pr create --fill
  gh pr checks --watch
  ```
- **Expect:** the PR check fails, `build / Build` is **skipped**, and the merge box says required checks have failed. The failing step shows `artifactId mismatch: ...`, and the same message appears as an error annotation on the check. It isn't pinned to a file, because a mismatch involves several files. Errors that belong to one file (malformed XML, a missing artifactId) are pinned to that file; you'll see that in D6.
- **Try to merge:** `gh pr merge --merge`. It's refused.
- **Learn:** three separate mechanisms in one picture: the gate step failed the job, `needs` skipped the build, and branch protection blocked the merge.

### D4. The fix turns it green (same PR)

- **Do:**
  ```bash
  git revert --no-edit HEAD && git push
  gh pr checks --watch
  ```
- **Expect:** the check passes, the build runs, and the merge box turns green. Don't merge: close the PR at cleanup, or merge it (the net change is zero).
- **Learn:** the check re-runs on every push to the PR. Developers fix and push; nothing manual is needed.

### D5. Parent change does not fail (same idea as C4, on GitHub)

- **Do:** new branch from `main`, change only the `<parent>` artifactId in `service-b/pom.xml` (the first match), push and open a PR:
  ```bash
  git switch main && git switch -c test/parent-only
  sed -i '0,/<artifactId>sample-service<\/artifactId>/ s#<artifactId>sample-service</artifactId>#<artifactId>renamed-parent</artifactId>#' service-b/pom.xml
  git commit -am "test: change only the parent reference" && git push -u origin test/parent-only && gh pr create --fill && gh pr checks --watch
  ```
- **Expect:** the check passes.

### D6. Frontend malformed, then fixed

- **Do:**
  ```bash
  cd /e/Task/implementation/frontend-sample
  git switch main && git pull -q && git switch -c test/broken-xml
  sed -i 's#</locale>#<locale>#' config/settings.xml
  git commit -am "test: break settings.xml" && git push -u origin test/broken-xml
  gh pr create --fill && gh pr checks --watch
  git revert --no-edit HEAD && git push && gh pr checks --watch
  ```
- **Expect:** first a failure with the build skipped and an error annotation pinned to `config/settings.xml` (the message contains `line 8, column 2`; the annotation itself is attached to the file, not to a line), then a pass with the build running.

### D7. The XML path comes from the consumer

- **Why:** proves the path is configuration that each repo owns.
- **Do:** on a new branch, add XML in a new folder and point the consumer at it:
  ```bash
  git switch main && git switch -c test/custom-path
  mkdir -p ui/labels && printf '<labels><l id="ok">OK</l></labels>\n' > ui/labels/en.xml
  sed -i 's#xml_path: config#xml_path: ui#' .github/workflows/build.yml
  git add -A && git commit -m "test: validate ui/ instead of config/" && git push -u origin test/custom-path
  gh pr create --fill && gh pr checks --watch
  ```
- **Expect:** pass. In the log, `files_inspected` lists only `ui/labels/en.xml`, not `config/`.
- **Then:** change it to a folder that doesn't exist and push again:
  ```bash
  sed -i 's#xml_path: ui#xml_path: missing-folder#' .github/workflows/build.yml
  git commit -am "test: wrong path" && git push && gh pr checks --watch
  ```
  Expect: `Configured xml_path 'missing-folder' does not exist in the repository.`, and the build is skipped.
- **Learn:** for `pull_request` events, GitHub runs the workflow file from the PR itself, so changing the workflow in a PR takes effect in that PR. Remember this for D9.

### D8. Unsupported or missing configuration

- **Do:** on a new branch in frontend-sample:
  ```bash
  git switch main && git switch -c test/bad-config
  sed -i 's#artifact_type: frontend#artifact_type: mobile#' .github/workflows/build.yml
  git commit -am "test: unsupported type" && git push -u origin test/bad-config && gh pr create --fill && gh pr checks --watch
  # then: back to frontend but remove xml_path
  sed -i 's#artifact_type: mobile#artifact_type: frontend#; /xml_path:/d' .github/workflows/build.yml
  git commit -am "test: frontend without xml_path" && git push && gh pr checks --watch
  ```
- **Expect:** `Unsupported artifact_type 'mobile'. Supported values: backend, frontend.`, then `xml_path is required when artifact_type is 'frontend'`. Both fail, and in both the build is skipped.
- **Learn:** misconfiguration never passes silently.

### D9. Think about bypass (discussion, no commands)

In D7 and D8 you changed the consumer workflow inside a PR and the change took effect. So a developer could delete the `uses:` call in a PR. What stops that? Try it: on a branch, replace the job in `.github/workflows/build.yml` with a job that only runs `echo`, and open a PR. The replacement job passes, but the PR stays `BLOCKED` and `gh pr merge` is refused. Why:
- The required check `build / PR Check / PR checks` would then never report, so the PR stays blocked ("expected, waiting for status").
- Code review sees the workflow change.
- At organization level: a ruleset with **required workflows** runs the check from the central repo, whatever the consumer file says.

### D10. Branch protection itself

- **Do:**
  ```bash
  gh api repos/Mahesh2511/backend-sample/branches/main/protection -q '{checks: .required_status_checks.checks, enforce_admins: .enforce_admins.enabled}'
  ```
  In the browser: backend-sample > *Settings* > *Branches* > rule for `main`.
  Try a direct push to main (it's expected to be refused):
  ```bash
  cd /e/Task/implementation/backend-sample && git switch main
  git commit --allow-empty -m "test: direct push" && git push origin main
  git reset --hard origin/main       # drop the local test commit afterwards
  ```
- **Expect:** the required check is `build / PR Check / PR checks` from app id 15368 (GitHub Actions), admins are included, and the push is rejected because the required status check is missing.
- **Learn:** the workflow makes the job fail; the *repository setting* turns that failure into a blocked merge. Workflow YAML alone can't block a merge.

### D11. Versions and pinning

- **Why:** a change to the shared repo reaches every consumer. Tags control when.
- **Do:** on a new backend-sample branch, pin the consumer to the first release:
  ```bash
  cd /e/Task/implementation/backend-sample && git switch main && git switch -c test/pin-old
  sed -i 's#build.yml@v1$#build.yml@v1.0.0#' .github/workflows/build.yml && grep uses .github/workflows/build.yml
  git commit -am "test: pin to v1.0.0" && git push -u origin test/pin-old && gh pr create --fill && gh pr checks --watch
  ```
- **Expect:** the build job is named `build / Build (backend)` (the old name), and its steps are the old inline `Build backend artifact (mock)` steps, with no build-action. Compare with any recent run on `@v1`.
- **Also notice:** the *PR check* in that run still uses the current action code, because `pr_check.yml` at `v1.0.0` refers to the action as `@v1`. That's the "inner references float" limit described in `docs/reuse-and-onboarding.md`.
- **Also notice:** the PR is still mergeable, because the required check is `build / PR Check / PR checks`, and that name is the same in every version. The build job's name changed between `v1.0.0` and `v1.0.1`, which is why `Build` shouldn't be the required check, and why it now has a stable name.
- **Proof of the float in the log:** the run shows `Uses: .../build.yml@refs/tags/v1.0.0 (ea0bf73...)` but `Download action repository '...@v1' (SHA:010af4c...)`, which is `v1.1.0`.
- **Learn:** `@v1` means "compatible updates", `@v1.0.0` means "exactly this release", and `@main` would mean "whatever was merged last" (never use it for consumers).

### D12. Onboard a brand-new repository (the reuse proof)

- **Why:** the design goal is reuse across all current and future repos. Prove it with a repo the framework has never seen.
- **Do:**
  ```bash
  mkdir -p $PLAY/payments-service && cd $PLAY/payments-service && git init -q -b main
  git config user.name "Mahesh2511" && git config user.email "88716330+Mahesh2511@users.noreply.github.com"
  mkdir -p api/v2/core .github/workflows
  printf '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.acme</groupId><artifactId>payments</artifactId><version>1</version></project>\n' > pom.xml
  printf '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><artifactId>payments</artifactId></project>\n' > api/v2/core/pom.xml
  cp /e/Task/implementation/shared-devsecops/templates/consumer-build.yml .github/workflows/build.yml
  git add -A && git commit -qm "Onboard payments-service to the shared PR checks"
  gh repo create Mahesh2511/payments-service --public --source . --push
  gh workflow run build.yml -R Mahesh2511/payments-service --ref main && sleep 10 && gh run watch -R Mahesh2511/payments-service
  ```
- **Expect:** pass, with `files_inspected` showing `api/v2/core/pom.xml` and `pom.xml` and artifactId `payments`. Different names, a different layout, and no change to the framework.
- **Learn:** onboarding is one copied file. Then, as the last step for a real repo, protect `main` (D10). To delete the test repo later: `gh auth refresh -h github.com -s delete_repo`, then `gh repo delete Mahesh2511/payments-service --yes`. (If it already exists from an earlier run, skip `gh repo create` and just run the workflow.)

### D13. Change the framework safely (advanced)

- **Why:** see how the shared library protects all consumers from a bad change.
- **Do:** in the shared repo, on a branch, break an expectation and open a PR:
  ```bash
  cd /e/Task/implementation/shared-devsecops && git switch main && git pull -q && git switch -c test/break-fixture
  sed -i 's#<artifactId>orders-api</artifactId>#<artifactId>orders-API</artifactId>#' tests/fixtures/backend/pass/core/pom.xml
  git commit -am "test: break the pass fixture" && git push -u origin test/break-fixture
  gh pr create --fill && gh pr checks --watch
  ```
- **Expect:** *Framework CI* fails: the unit tests fail, and the `backend-pass` scenario reports `Expected block_merge=false but got 'true'`. Consumers aren't affected, because nothing was tagged.
- **Learn:** consumers only see a change after it passes CI, is merged, is tagged and `v1` is moved. Close this PR without merging.

---

## Part E. Cleanup

```bash
# close test PRs and delete their branches
for r in backend-sample frontend-sample devsecops-shared-github-actions; do
  gh pr list -R Mahesh2511/$r --state open --json number,headRefName -q '.[] | select(.headRefName | startswith("test/")) | .number' \
    | while read n; do gh pr close $n -R Mahesh2511/$r --delete-branch; done
done
# local repos back to main
for d in backend-sample frontend-sample shared-devsecops; do git -C /e/Task/implementation/$d switch -q main; done
# scratch copies
rm -rf /e/Task/playground
```

Keep the two original demo PRs (#1 in each sample repo) open for reviewers.

---

## Part F. Check your understanding

If you can answer these without looking, you understand the system. Answers are in `interview-qa.md` (question numbers in brackets).

1. Which single input makes one workflow serve both repo types, and why isn't it inferred? [2]
2. Name every hop the input passes through. [3]
3. Why does `build.yml` call `pr_check.yml` with `./`, but `pr_check.yml` call the action with `owner/repo@v1`? [10]
4. Whose code does the checkout in `pr_check.yml` fetch? [8]
5. Which artifactId does the backend check compare, and what would break if it compared all of them? [21]
6. What does `block_merge=true` do by itself? [12]
7. Why does the action exit 0 when validation fails? [13]
8. Why does the gate check for `"false"` rather than `"true"`? [14]
9. What two mechanisms stop the build, and what one mechanism stops the merge? [11, 12]
10. Why isn't `build / Build` a required check? [16]
11. How does a failing security check interact with a passing artifact check? [31]
12. How does a new repo adopt the framework, and how does a new artifact type get added? [54]
13. What does pinning `@v1.0.0` give you, and what does it not? (D11)
14. What's wrong with the requirement from Maven's point of view? [47]

---

## Appendix. Where things are

| Question | File |
|---|---|
| What does a consumer write? | `templates/consumer-build.yml` |
| Order of stages, build gating | `.github/workflows/build.yml` |
| Checkout, action call, gate | `.github/workflows/pr_check.yml` |
| Inputs, env vars, outputs of the PR check | `actions/prcheck-utils-action/action.yml` |
| Dispatch, registries, GitHub output | `actions/prcheck-utils-action/main.py` |
| Backend rule | `actions/prcheck-utils-action/utils/backend_validator.py` |
| Frontend rule | `actions/prcheck-utils-action/utils/frontend_validator.py` |
| result_map and block_merge rule | `actions/prcheck-utils-action/utils/result_utils.py` |
| Safe paths, recursive scan | `actions/prcheck-utils-action/utils/fs_utils.py` |
| Build plans | `actions/build-action/utils/build_plans.py` |
| Framework self-test | `.github/workflows/ci.yml`, `tests/` |
| Design, assumptions, evidence | `docs/` in the shared repo |

**Troubleshooting**

| Symptom | Cause and fix |
|---|---|
| `refusing to allow an OAuth App to create or update workflow` | The token lacks the `workflow` scope: `gh auth refresh -h github.com -s workflow` |
| Push to `main` in a sample repo rejected | Branch protection, as intended. Use a branch and a PR |
| `sed` changed both artifactIds | Use the exact `0,/.../` forms above, or edit the file by hand |
| A run doesn't start after `gh workflow run` | Wait a few seconds, then `gh run list`. Manual runs need the `workflow_dispatch` trigger, which both samples have |
| PR diff shows the whole file changed | Line endings changed to CRLF. Convert back with `sed -i 's/\r$//' <file>` |

---

## Appendix. Results of a full Part D run (2026-09-25)

Every exercise was run end to end on GitHub. Use this to compare with your own run.

| Exercise | Result |
|---|---|
| D1 Framework CI | 14 of 14 jobs passed. The backend-mismatch scenario logged `block_merge=true` and `OK: block_merge=true as expected` |
| D2 Manual runs | Both repos: PR checks pass, Build passes. Logs showed `"artifact_type": "backend"`, and `"frontend"` with `"xml_path": "config"`. Build plans `mvn -B -ntp verify` and `npm ci` |
| D3 Mismatch PR | PR checks fail, Build skipped, `mergeState=BLOCKED`, merge refused: "the base branch policy prohibits the merge" |
| D4 Revert on same PR | PR checks pass, Build passes, `mergeState=CLEAN` |
| D5 Parent-only change | Pass |
| D6 Broken XML, then fixed | Fail with an annotation on `config/settings.xml` (`mismatched tag: line 8, column 2`), then pass |
| D7 Custom path | `xml_path: ui` passed with only `ui/labels/en.xml` inspected. `missing-folder` failed with "does not exist" |
| D8 Bad config | `mobile` failed with "Unsupported artifact_type". Missing `xml_path` failed with "xml_path is required". Build skipped both times |
| D9 Bypass attempt | Replacement job passed, but the PR stayed `BLOCKED` and the merge was refused |
| D10 Protection | Direct push rejected: `GH006: Protected branch update failed ... Required status check "build / PR Check / PR checks" is expected` |
| D11 Pin v1.0.0 | Jobs `build / Build (backend)` with the old inline mock steps; PR checks passed; `mergeState=CLEAN`; the action floated to `v1` (`010af4c`) |
| D12 New repo | `Mahesh2511/payments-service` passed on the first run. `files_inspected`: `api/v2/core/pom.xml`, `pom.xml`; artifactId `payments` |
| D13 Bad framework change | Framework CI failed (4 unit tests, plus the backend-pass scenario `Expected block_merge=false but got 'true'`). `v1` untouched, consumers unaffected |

Things the run surfaced (good interview material):

- GitHub warned that `actions/checkout@v4` and `actions/setup-python@v5` target the deprecated Node.js 20. The fix is moving to their Node 24 majors (`checkout@v5`, `setup-python@v6`) in a framework release.
- GitHub noticed that `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19. Pinning `ubuntu-24.04`, or an optional `runs_on` input, avoids surprise changes.
- The artifactId comparison is case-sensitive (`orders-API` differs from `orders-api`), matching Maven, where coordinates are case-sensitive.
- Annotations could also carry the line number, so they appear on the exact line in *Files changed*.
