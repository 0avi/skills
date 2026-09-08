# GitLab CI

Single-file pipelines with a strong DAG model. GitLab's distinctive strengths for delivery are `needs` for real dependency graphs, `rules` for precise triggering, and `resource_group` for serialising deploys.

| Question | Answer |
| -------- | ------ |
| Stages or `needs`? | **`needs`.** Stages serialise unnecessarily; `needs` builds an actual DAG |
| `rules` or `only`/`except`? | **`rules`.** `only`/`except` is legacy |
| Cloud identity? | **`id_tokens`.** `CI_JOB_JWT` is removed |
| How do I reuse pipeline code? | `include`, or a **CI/CD Component** for a versioned, reusable unit |
| How do I stop concurrent deploys? | **`resource_group`** |

---

## Shape

```yaml
stages: [build, test, deploy]

variables:
  MAVEN_OPTS: "-Dmaven.repo.local=.m2/repository"

default:
  image: eclipse-temurin:25-jdk
  cache:
    key:
      files: [pom.xml]
    paths: [.m2/repository]

build:
  stage: build
  script: mvn -B package -DskipTests
  artifacts:
    paths: [target/*.jar]
    expire_in: 1 week
    reports:
      dotenv: build.env          # pass variables to later jobs

test:
  stage: test
  needs: [build]                 # DAG, not just stage order
  script: mvn -B verify
  artifacts:
    when: always                 # reports matter most on failure
    reports:
      junit: target/surefire-reports/TEST-*.xml

deploy:prod:
  stage: deploy
  needs: [test]
  environment:
    name: production
    url: https://app.example.com
  resource_group: production     # serialise: no concurrent prod deploys
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
  id_tokens:
    AWS_TOKEN: { aud: sts.amazonaws.com }
  script: ./deploy.sh
```

Every line of that earns its place: `needs` for the DAG, `when: always` so test reports survive a failure, `resource_group` to serialise, `rules` with `when: manual` as the gate, and `id_tokens` instead of a stored key.

## `needs` against stages

Stages are a simple linear model: every job in stage N waits for **all** of stage N-1. That is usually more waiting than the dependencies require.

```yaml
# stage-only: integration waits for lint even though it does not need it
lint:        { stage: test, script: ... }
integration: { stage: test, script: ... }

# needs: integration starts as soon as build finishes
integration: { needs: [build], script: ... }
```

`needs` lets a job start as soon as *its* dependencies are done, which is what shortens the critical path. **Declare `needs` even where stage order would suffice**, because it documents the real dependency and stops the pipeline serialising as it grows. See [pipeline-design.md](pipeline-design.md).

`needs` also controls artifact download: by default a job downloads artifacts from all earlier stages, but with `needs` it downloads only from the jobs it names, which is usually what you want and is faster.

## `rules`

`rules` replaced `only`/`except`, which is legacy and should not appear in new pipelines.

```yaml
rules:
  # skip entirely on a docs-only change
  - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    changes: [src/**/*, pom.xml]
  - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  - if: $CI_PIPELINE_SOURCE == "schedule"
    when: always
  - when: never                  # explicit default
```

Two things worth knowing:

- **Rules are evaluated in order and the first match wins.** An overly broad early rule masks the later ones.
- **End with an explicit `when: never`** rather than relying on the implicit default. It makes the intent readable, and a pipeline that unexpectedly runs or unexpectedly does not is nearly always a rules-ordering problem.

`workflow:rules` at the top level decides whether the *pipeline* is created at all, which is the right place to prevent duplicate pipelines for a branch and its merge request.

## `include` and Components

| Mechanism | Use |
| --------- | --- |
| `include:local` | Split a large pipeline within one repository |
| `include:project` | Share across projects. **Pin `ref`** |
| `include:remote` | External URL. Risky - unpinned code execution |
| `include:template` | GitLab's bundled templates |
| **CI/CD Component** | A **versioned**, documented, reusable unit. The current answer |

CI/CD Components are the closest thing to a GitHub reusable workflow: versioned, published to a catalogue, and consumed with an explicit version.

```yaml
include:
  - component: gitlab.com/myorg/ci-components/maven-build@1.2.0
    inputs: { java_version: '25' }
```

**Always pin the version or ref.** An unpinned `include` executes whatever is there today, which is the same class of problem as an unpinned action SHA. See [actions-security.md](actions-security.md).

## `id_tokens` for cloud identity

```yaml
deploy:
  id_tokens:
    AWS_TOKEN: { aud: sts.amazonaws.com }
  script:
    - aws sts assume-role-with-web-identity
        --role-arn "$ROLE_ARN" --role-session-name ci
        --web-identity-token "$AWS_TOKEN"
```

**`CI_JOB_JWT` and `CI_JOB_JWT_V2` are removed.** Any pipeline still referencing them needs migrating.

Bind the cloud trust policy to the narrowest claim available - project, ref and environment - rather than to the whole namespace. See [oidc-and-secrets.md](oidc-and-secrets.md).

## Variables and protection

| Setting | Effect |
| ------- | ------ |
| **Masked** | Hidden in logs. Best-effort, and has value-format requirements |
| **Protected** | Available only to protected branches and tags |
| **Environment scope** | Available only for a matching environment |

**Protected plus environment-scoped is the combination for a deployment credential.** Masked alone is not a control: an unprotected variable is readable from any branch, including one a contributor just pushed.

Note that masking imposes format constraints (length, character set); a value that cannot be masked is silently *not* masked, so verify rather than assuming.

## `resource_group` and environments

```yaml
deploy:prod:
  environment: { name: production }
  resource_group: production      # one at a time
```

`resource_group` serialises jobs sharing the name, which is how you prevent two concurrent production deploys racing. It is easy to add and frequently omitted.

Protected environments additionally restrict *who* may deploy, which together with `when: manual` forms the approval gate. See [environments-and-promotion.md](environments-and-promotion.md).

## Version notes

| | Status |
| --- | ------ |
| `rules` | Current. `only`/`except` is legacy |
| `id_tokens` | Current. **`CI_JOB_JWT` removed** |
| CI/CD Components | Current mechanism for versioned reuse |
| `needs` | Supports cross-stage and cross-pipeline dependencies |
| Feature availability | **Tier-dependent** (Free, Premium, Ultimate) and version-dependent on self-managed |

- **Self-managed instances lag GitLab.com**, sometimes by a lot. Check syntax against the instance version, not the public docs.
- **Several security scanners are tier-gated**, so a pipeline copied from documentation may reference jobs your tier does not include. See [scanning.md](scanning.md).
- **Not verified here:** nothing in this file was executed. No GitLab instance is available on this machine; cited from GitLab's documentation.

## Gotchas

- Agent uses `only`/`except` in a new pipeline - legacy; `rules` is current
- Agent relies on stage order alone - jobs wait on unrelated work, and the pipeline serialises further as it grows
- Agent omits `needs` and then wonders why every artifact is downloaded - without `needs`, all earlier-stage artifacts are fetched
- Agent writes rules whose first match is too broad - first match wins, so later rules never evaluate
- Agent omits a final `when: never` - the implicit default makes unexpected runs hard to reason about
- Agent uses an unpinned `include:remote` or `include:project` - executes whatever is there today
- Agent references `CI_JOB_JWT` - removed; use `id_tokens`
- Agent marks a deployment credential masked but not protected - readable from any branch
- Agent assumes masking always applies - values that do not meet the format requirements are silently unmasked
- Agent omits `resource_group` on a production deploy - concurrent deploys race
- Agent copies a pipeline from documentation without checking the tier - scanner jobs may not exist on Free
- Agent omits `artifacts: when: always` on test reports - the report is missing precisely when the job failed

## Related

- [platform-matrix.md](platform-matrix.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [environments-and-promotion.md](environments-and-promotion.md) · [runners.md](runners.md) · [caching.md](caching.md) · [scanning.md](scanning.md) · [pipeline-design.md](pipeline-design.md) · [platform-versions.md](platform-versions.md) · [checklist.md](checklist.md)
