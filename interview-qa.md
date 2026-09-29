# Interview preparation: questions and answers

> Private prep notes. They're not pushed to any repository.
> Answers are written in the first person so you can say them almost as-is. Short answer first, then detail if the interviewer digs.

Quick links to have open during the call:
- Shared library: https://github.com/Mahesh2511/devsecops-shared-github-actions
- Failing PR (blocked): https://github.com/Mahesh2511/backend-sample/pull/1
- Fail -> fix PR: https://github.com/Mahesh2511/frontend-sample/pull/1

---

## A. The 60-second pitch

**"Walk me through your solution."**

> I built a shared library repository with two reusable workflows and two composite actions, matching your diagram. Every application repo has one tiny workflow that calls the shared `build.yml@v1` and declares `artifact_type`: backend or frontend, plus `xml_path` for frontend.
> `build.yml` runs a PR-check stage first. It calls `pr_check.yml`, which checks out the consumer's code and runs `prcheck-utils-action`. The action picks a validator by `artifact_type`. For backend, every `pom.xml` must have the same artifactId. For frontend, every XML file under the configured path must be well-formed.
> The result goes into the shared `result_map` as one entry, `artifact_consistency`. `block_merge` becomes true if any required check failed. A gate step turns `block_merge=true` into a failed job, so the build job, which `needs` the PR check, is skipped, and the failed check blocks the merge through branch protection.
> I didn't just write it: it runs on GitHub. There's a live PR where the check fails, the build is skipped and the merge button is blocked.

---

## B. Workflow design and input flow

**1. Why one workflow file instead of separate backend and frontend files?**
> The behaviour differs only by configuration, so the logic belongs in one place. Two files would drift apart. One template means every repo has the same shape, and only the `with:` block differs. Adding a third type later is a new validator in the shared library, not a new workflow in 200 repos.

**2. What input did you add and why that name?**
> `artifact_type`, with values `backend` or `frontend`, plus `xml_path` for frontend. It's an explicit declaration. I deliberately don't infer the type from the repo name, file presence or branch, because inference is fragile: a backend repo might contain XML, a frontend repo might have a stray `pom.xml`. The explicit input is the single source of truth, and it's visible in code review.

**3. How exactly does the input travel?**
> Consumer `with: artifact_type` -> `build.yml` declares it under `on.workflow_call.inputs` -> the `pr-check` job forwards it with `with:` to `pr_check.yml` -> which forwards it with `with:` to the action -> `action.yml` passes it to Python as the env var `PRCHECK_ARTIFACT_TYPE` -> `main.py` uses it to pick the validator. Every hop forwards it unchanged. actionlint verifies the build.yml -> pr_check.yml contract.

**4. Why didn't you use a `choice` type to restrict the values?**
> `choice` only exists for `workflow_dispatch`. `workflow_call` inputs can be string, boolean or number only. So I validate in exactly one place, the action, and an unknown value fails the PR check with a message listing the supported values. It never passes silently.

**5. Could the file be byte-identical in every repo?**
> Yes. The template shows the option: `artifact_type: ${{ vars.ARTIFACT_TYPE }}`, using repository or organization variables. The trade-off is that the declaration moves out of code review into settings. An unset variable arrives as an empty string and fails the check, so it's still safe. I chose explicit literals as the default because they're reviewable.

**6. Why is `xml_path` optional rather than required?**
> Backend repos don't need it. Making it required would force a meaningless value on them. The frontend validator enforces it: frontend without `xml_path` fails with "xml_path is required".

**7. What if a team needs a new setting later?**
> Add an optional input with a default at each hop. Existing consumers keep working unchanged, which is why the interface is additive. A breaking change becomes `v2`.

---

## C. GitHub Actions mechanics

**8. Where does the checkout happen, and whose code is checked out?**
> In `pr_check.yml`, the first step, before the action. Inside a reusable workflow, `actions/checkout` checks out the *caller's* repository, the consumer, at the PR merge ref. That's exactly what would land on main, so we validate the post-merge state.

**9. Why does the build job check out again?**
> Jobs run on separate fresh runners and share no filesystem. Each job that needs the source must check it out.

**10. In build.yml you call pr_check.yml with `./`, but in pr_check.yml you call the action with the full `owner/repo@v1`. Why the difference?**
> For reusable workflows, GitHub resolves a `./` path to the same commit as the calling workflow file, so `./` inside the shared `build.yml` means the shared repo at the same version. That keeps the versions consistent automatically. For actions, `./` resolves against the checked-out workspace, which after checkout is the *consumer's* code, so the action wouldn't be found. And `uses:` can't contain expressions, so I reference `owner/repo/actions/x@v1`. The release process moves the `v1` tag, so they stay aligned.

**11. How does a failed check actually stop the build?**
> Two layers. First, the gate step exits 1 when `block_merge` isn't literally `false`, so the PR-check job fails. Then the build job has `needs: pr-check`, and by default a job is skipped if something it needs failed. On top of that I added `if: needs.pr-check.result == 'success' && needs.pr-check.outputs.block_merge == 'false'`, so even if someone later adds `always()`, the build still won't run on a failed check.

**12. Does setting `block_merge=true` block the merge?**
> No, and this is an important distinction. An output is just a string. What blocks a merge is a failed status check that's configured as **required** in branch protection or a ruleset. My design makes the PR-check job fail, which produces a failed check named `build / PR Check / PR checks`. I set that as a required check on both demo repos, and GitHub shows `BLOCKED`. In an organization I'd put it in an org-level ruleset so every repo gets it.

**13. Why doesn't the action itself exit 1 when validation fails?**
> Separation of verdict and enforcement. The action always publishes `result_map` and `block_merge`, even on failure, so the summary, annotations and any downstream consumer of the outputs get them reliably. Then one explicit gate step enforces. For standalone or local use there's a `--enforce` flag. If the action crashes, it still publishes `block_merge=true` and exits 1, so a crash can't look like a pass.

**14. Why check for `"false"` instead of `"true"` in the gate?**
> Fail-safe. If the output is missing because of a crash, a renamed output or a typo, `"$BLOCK_MERGE" = "true"` would be false and the gate would *pass*. Checking for the explicit pass value means anything unexpected blocks.

**15. Why is the build job called just "Build" and not "Build (backend)"?**
> I found this while testing on GitHub. When a job is skipped, GitHub doesn't evaluate expressions in its name, so it showed literally `Build (${{ inputs.artifact_type }})`. A check name that changes between states can't be matched reliably as a required check. I made it static and released `v1.0.1`. It's a good example of why I tested on real GitHub and not just locally.

**16. Why isn't `Build` also a required check?**
> GitHub treats a *skipped* required check as passing. When the PR check fails, the build is skipped, so requiring it adds no protection. The PR check is the one that must be required.

**17. What's the full check name, and why three parts?**
> `build / PR Check / PR checks`: the caller job id `build` in the consumer, then the job name `PR Check` in shared `build.yml`, then the job `PR checks` in `pr_check.yml`. Nested reusable workflows prefix their callers' job names.

**18. How deep can reusable workflows nest?**
> Up to ten levels in total: the top-level caller plus nine levels of reusable workflows. I use three: consumer -> build.yml -> pr_check.yml.

**19. How do outputs get from the action up to the consumer?**
> Python writes to the `$GITHUB_OUTPUT` file -> a composite action output -> step `id: prcheck` -> job `outputs:` in `pr_check.yml` -> `on.workflow_call.outputs` -> `needs.pr-check.outputs` in `build.yml` -> re-exported by build.yml's `workflow_call.outputs`. I write `result_map` using the heredoc delimiter format, so any content is safe.

**20. Why a composite action and not Docker or JavaScript?**
> A composite action with stdlib Python needs no image build or pull (Docker is also Linux-only) and no bundled `node_modules`. It's readable and fast. The trade-off is that it depends on Python on the runner, so I pin it with `actions/setup-python`.

---

## D. Validation logic

**21. Which artifactId do you read from a POM?**
> Only the project's own: the `<artifactId>` that is a direct child of `<project>`. A POM also has artifactIds inside `<parent>`, `<dependencies>` and `<plugins>`. If I read all of them, every real POM would "mismatch". My test fixture deliberately has a different parent artifactId and a dependency, to prove they're ignored.

**22. How do you handle the Maven namespace?**
> POMs usually declare `xmlns="http://maven.apache.org/POM/4.0.0"`, so ElementTree tags look like `{namespace}artifactId`. I compare local names by stripping the namespace, so both namespaced and legacy non-namespaced POMs work. There's a fixture for each.

**23. What if a pom.xml has no artifactId, an empty one, or isn't even a POM?**
> All three fail with the file named: "no project-level artifactId", "artifactId is present but empty" and "not a Maven POM (root element is ...)". Malformed XML fails with the parser's line and column.

**24. What if there are no POMs at all?**
> Fail. A repo declared as backend with no `pom.xml` is misconfigured, and passing it would be a vacuous success. Same for frontend: a path with no XML fails.

**25. Frontend: what does "valid" mean?**
> Well-formed: the document parses. I don't validate against XSD or DTD, and I don't compare contents, because the requirement is well-formedness. Schema validation could be a future optional setting.

**26. Is xml_path hard-coded anywhere?**
> No. The PDF's example `xyz` appears only in the framework's own test fixtures, and the sample uses `config`. The shared code has no path, artifact ID or repo name. I grep-audited that.

**27. What stops someone passing `xml_path: ../../etc`?**
> `resolve_within()` resolves the path and rejects anything outside the repo root, including absolute paths and `..` traversal. Inputs come from a workflow file that's part of the PR, so I treat them as untrusted.

**28. Is parsing untrusted XML safe?**
> Python's stdlib parser doesn't fetch external entities, and the expat versions bundled with current Python releases limit entity expansion (the "billion laughs" attack). We only parse, never execute. For stricter hardening, `defusedxml` is a drop-in replacement.

**29. Why is the scan deterministic?**
> I sort directories and files during the walk, so diagnostics and the result_map are always in the same order. That makes logs diffable and tests stable.

**30. Do you skip any directories?**
> Only `.git`. On a fresh checkout there's no `target/` or build output, so I didn't hard-code more exclusions, since those are opinions that belong in configuration.

---

## E. result_map and block_merge

**31. How does your check integrate with the *existing* checks?**
> It doesn't create a new gate. It adds one entry, `artifact_consistency`, to the same `result_map` that other checks write to. The action accepts the incoming `result_map` from earlier checks, merges its entry in, and recomputes `block_merge` across *all* entries. If a security check fails and mine passes, the merge is still blocked, and vice versa. There's a test for each direction.

**32. What's the exact rule for block_merge?**
> `block_merge = true` if any entry whose `required` isn't `false` lacks a literal `passed: true`. That covers missing `passed`, the string `"true"`, `null` and malformed entries, which all block. An empty map also blocks, because nothing vouched for the PR.

**33. Why a `required` flag?**
> So a team can introduce a new check in advisory mode: it's reported in the summary but doesn't block. Once it's stable, flip it to required. That's a safe rollout pattern for new policies.

**34. What if the incoming result_map is invalid JSON?**
> It's recorded as a failing `result_map_input` entry, so it blocks. Garbage in never becomes a pass.

---

## F. Testing

**35. How did you test it?**
> Four levels. There are 36 unit tests for the validators, the result logic and the `$GITHUB_OUTPUT` contract. actionlint checks all workflows. The shared repo's own CI runs the real composite action against 11 PASS/FAIL fixtures and asserts `block_merge`, plus the build action for both types. And end to end on GitHub: real PRs in the consumer repos, including a blocked merge and a fail-then-fix PR.

**36. Why static fixtures instead of generating files in tests?**
> They double as documentation and as CI inputs: the same fixture directory is used by unit tests, by the CI matrix and by manual `main.py` runs. A reviewer can open `tests/fixtures/backend/mismatch` and see the scenario.

**37. How do you test the GitHub output format without GitHub?**
> The test runs `main.py` as a subprocess with `GITHUB_OUTPUT` pointing to a temp file, then parses that file the way the runner does, including the heredoc syntax.

**38. What did testing on real GitHub find that local testing didn't?**
> Three things. First, an unquoted `echo "MOCK: ..."` was invalid YAML (a colon followed by a space), which my YAML parse check caught. Second, the unevaluated job name on skipped jobs. Third, operational things: the token needed the `workflow` scope to push workflow files, and a Windows line-ending change made one PR diff show the whole file changed. I fixed it so the diff shows the single line.

---

## G. Versioning, rollout and operations

**39. How do consumers get updates?**
> They pin `@v1`. I release by tagging the exact version, say `v1.1.0`, then moving `v1`. Every consumer gets the change on its next run with no PR in 200 repos. Breaking changes go to `v2`, and teams opt in. I did exactly this three times: `v1.0.0`, `v1.0.1` and `v1.1.0`.

**40. Why not `@main`?**
> One bad merge to main would break every repo instantly. Tags give a release gate and an easy rollback: move `v1` back to the previous version.

**41. Doesn't moving a tag defeat pinning?**
> A major tag is a deliberate "compatible updates" channel. Teams that want immutability can pin `@v1.1.0`, or a commit SHA, which is the strongest option. For third-party actions like checkout I'd use SHAs in production, since those are supply-chain risks.

**42. How would you roll this out to 500 repos?**
> Start with the check as `required: false` (advisory) and watch the failure rates on dashboards. Fix false positives. Add the workflow file to repos with a bulk-PR tool, or through org workflow templates. Then flip it to required and add the check to the org ruleset. Communicate the change, and document how to fix each failure type, which the error messages already point to.

**43. How would you handle a private shared repo?**
> Set the shared repo's *Settings -> Actions -> General -> Access* to allow the org's repositories. Reusable workflows and actions from a private repo are then usable by other repos in the org or account.

---

## H. Security

**44. Is this safe for pull requests from forks?**
> Yes. It triggers on `pull_request`, not `pull_request_target`. Fork PRs run with a read-only token and no secrets. Everything uses `permissions: contents: read` and `persist-credentials: false`. The validators only read files and never execute PR code. `pull_request_target` would be dangerous because it runs with base-repo privileges.

**45. Any injection risk from the inputs?**
> Inputs go into Python via `env:` and are never interpolated into a `run:` script. `${{ }}` inside a script is textual substitution, which is the classic GitHub Actions injection vector. The paths are also traversal-checked.

**46. Could a developer bypass the check by editing their workflow file in the PR?**
> Partly, and I'm honest about it: the consumer workflow is in the repo, so a PR could change `artifact_type` or remove the call. The protection is that the *required check name* must appear and pass, and code review sees the workflow change. The org-level answer is a ruleset with **required workflows**, which run from the central repo regardless of the consumer's files. I'd use that in production.

---

## I. Tricky or critical questions

**47. Your sample Maven project wouldn't even build. Isn't that a problem?**
> Good catch, and I flagged it myself. Maven requires unique `groupId:artifactId` per module in a reactor. I ran Maven 3.9.16 on the sample and it reports "Project is duplicated in the reactor". So the requirement as written, all artifactIds identical, conflicts with a standard multi-module build. I implemented it exactly as specified and documented the conflict. The likely real intents: repos with several single-module POMs for one artifact, or "all modules share the same *parent* artifactId", which is a small change in `extract_artifact_id`. I'd clarify with the framework owners before rollout rather than silently reinterpret the requirement.

**48. What happens on a huge monorepo?**
> The scan is a linear walk and parsing is fast, so time isn't the issue. Output size is: job outputs are capped at 1 MB. I'd scope the scan with the existing `working_directory` input, trim `details` to counts plus the first N failures, and put the full report in the job summary or an artifact.

**49. What would you do differently with more time?**
> Required workflows through an org ruleset; SHA-pinned third-party actions; `defusedxml`; a configurable exclude list; a JSON schema for `result_map` shared by all checks; a real build in the build action once the Maven question is resolved; and org-wide failure metrics.

**50. Why did you mock instead of asking for the real files?**
> I did ask. The clarification said the components are internal and asked for reasonable mocks with documented interfaces. So everything I assumed is in `assumptions.md`, with a note on how to reconcile it if the real framework differs. For example, if the real pr_check enforces through a separate gating job, my check still plugs in unchanged, because it only contributes a result_map entry.

**51. How do you know `./` inside a reusable workflow resolves to the shared repo and not the consumer?**
> The GitHub docs say a `./` reusable-workflow reference uses "the same commit as the caller workflow", and the caller here is the shared build.yml. It's also proven empirically: the consumer runs on GitHub resolve pr_check.yml from the shared repo.

**52. Why are there two actions?**
> Your diagram shows a build action and a PR_check action under Actions, each with Action.yml, Utils and main.py. I mirrored that: PR checks decide *whether* we build, and the build action decides *how* to build for each artifact type. Both dispatch on the same `artifact_type` through a registry, so adding a type is symmetrical.

**53. What does a developer see when the check fails?**
> An inline annotation on the offending file in the PR, the exact error ("artifactId mismatch: 'another-service' in service-b/pom.xml ..."), a summary table of all checks with block_merge, the build shown as skipped, and a merge box saying required checks failed. The error tells them what to fix.

**54. If you had to add a "node" artifact type tomorrow?**
> Write `utils/node_validator.py`, add one entry to `VALIDATORS` and one to `BUILD_PLANS`, add fixtures and tests, then release `v1.2.0`. Node repos set `artifact_type: node`. No existing consumer changes.

---

## J. Numbers to remember

| Fact | Value |
|---|---|
| Unit tests | 36 |
| CI scenario jobs | 11 PR-check + 2 build-action |
| Consumer workflow size | 14-15 lines |
| Releases | v1.0.0 -> v1.0.1 (job name) -> v1.1.0 (build-action); `v1` = v1.1.0 |
| Required check name | `build / PR Check / PR checks` |
| Reusable workflow nesting used | 3 levels (limit 10) |
| Job output limit | 1 MB per job |
