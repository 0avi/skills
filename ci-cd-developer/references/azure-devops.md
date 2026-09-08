# Azure DevOps

YAML pipelines only. **Classic pipelines are in maintenance mode** - Microsoft has invested new capability exclusively in the YAML model since 2023 - so Classic is out of scope here, and any material predating 2023 is teaching the wrong model.

That matters for sourcing: a widely-used Packt title on Azure DevOps dates from **December 2020** and covers deployment through *release pipelines*, which are Classic. Measured across its 438 pages, "Release pipeline" appears 100 times against 3 mentions of `azure-pipelines.yml`. Treat pre-2023 Azure DevOps books as concept references for service connections, environments and agent pools, and take no pipeline syntax from them. See [book-deltas.md](book-deltas.md).

| Question | Answer |
| -------- | ------ |
| Where does cloud identity come from? | A **workload identity federation** service connection. Not a service principal secret |
| How do I reuse pipeline code? | **Templates**, with typed parameters. Not the same as a GitHub reusable workflow |
| Which expression syntax? | Three exist. `${{ }}` compile-time, `$[ ]` runtime, `$( )` macro |
| Where do approvals live? | On the **environment**, as approvals and checks |
| What is a service connection? | A first-class, permissioned, auditable credential object. The platform's best idea |

---

## Shape

```yaml
trigger:
  branches: { include: [main] }
pr:
  branches: { include: [main] }

variables:
  - group: build-settings          # variable group, possibly Key Vault backed

stages:
  - stage: Build
    jobs:
      - job: build
        pool: { vmImage: ubuntu-latest }
        steps:
          - task: JavaToolInstaller@0
            inputs: { versionSpec: '25', jdkArchitectureOption: x64, jdkSourceOption: PreInstalled }
          - script: mvn -B verify
          - task: PublishPipelineArtifact@1
            inputs: { targetPath: target/app.jar, artifact: app }

  - stage: DeployProd
    dependsOn: Build
    condition: succeeded()
    jobs:
      - deployment: deploy
        environment: production      # approvals and checks attach here
        strategy:
          runOnce:
            deploy:
              steps:
                - download: current
                  artifact: app
                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'prod-federated'   # service connection
                    appName: myapp
                    package: $(Pipeline.Workspace)/app/app.jar
```

Note the `deployment` job rather than `job`: it is what binds to an environment, records deployment history, and gives you the `strategy` block.

## The three expression syntaxes

This is the platform's sharpest edge, because the wrong choice produces an **empty or literal value rather than an error**.

| Syntax | Evaluated | Use for |
| ------ | --------- | ------- |
| `${{ }}` | **Compile time**, before the pipeline runs | Template parameters, structural decisions, `if` in templates |
| `$[ ]` | **Runtime**, when the job starts | Conditions depending on earlier stages |
| `$( )` | **Macro**, substituted by the agent | Variable values inside `script` steps |

```yaml
# WRONG: compile-time expansion cannot see a runtime output
- script: echo ${{ variables.fromEarlierStage }}     # empty

# RIGHT
- script: echo $(fromEarlierStage)
```

**A value set by an earlier job is not available at compile time**, so `${{ }}` on it silently yields nothing. If a variable is mysteriously blank, this is the first thing to check.

## Templates

Templates are **text substitution with typed parameters**, which is genuinely different from a GitHub reusable workflow:

```yaml
# templates/build.yml
parameters:
  - name: javaVersion
    type: string
    default: '25'
  - name: runTests
    type: boolean
    default: true
steps:
  - script: mvn -B ${{ if parameters.runTests }}verify${{ else }}package -DskipTests${{ endif }}
```

```yaml
# consumer
steps:
  - template: templates/build.yml
    parameters: { javaVersion: '25', runTests: true }
```

Use **typed parameters** (`string`, `boolean`, `number`, `object`, `stepList`), because they are validated at compile time. Untyped parameters fail at runtime with a worse message.

Two things templates do **not** give you, both of which a GitHub reusable workflow does: their own permission scope, and an isolated identity for provenance. A template runs with whatever the calling pipeline has. See [platform-matrix.md](platform-matrix.md).

**Template injection is a real concern**: a template from another repository is code you execute. Pin the repository resource to a ref, and prefer templates you control.

## Service connections and federation

The service connection is the platform's best abstraction: a named, permissioned, auditable credential object, with its own access control, rather than a secret in a variable.

**Use workload identity federation**, not a service principal with a client secret. It removes the secret entirely, and therefore removes the rotation obligation and the leak surface:

```yaml
- task: AzureCLI@2
  inputs:
    azureSubscription: 'prod-federated'   # federated service connection
    scriptType: bash
    scriptLocation: inlineScript
    inlineScript: az webapp deploy ...
```

Then restrict which pipelines may use the connection. A connection usable by any pipeline in the project is a project-wide grant to production. See [oidc-and-secrets.md](oidc-and-secrets.md).

## Environments, approvals and checks

An environment carries **approvals and checks**, which are richer than a simple reviewer list:

| Check | Purpose |
| ----- | ------- |
| Approvals | Named humans must approve |
| Branch control | Only from `main` |
| Business hours | No production deploys at 2am Sunday |
| Exclusive lock | **Serialise deploys** to this environment |
| Invoke REST API / Azure Function | Gate on an external system |

**Exclusive lock is the one people miss.** Without it, two concurrent pipeline runs deploy to the same environment and race. See [environments-and-promotion.md](environments-and-promotion.md).

## Variables and secrets

| Mechanism | Use |
| --------- | --- |
| Inline `variables:` | Non-secret pipeline settings |
| **Variable group** | Shared settings across pipelines |
| **Key Vault-backed variable group** | Secrets, with rotation in one place |
| Secret variable | Masked in logs, not passed to scripts as an env var automatically |

**A secret variable is not automatically available as an environment variable in a `script` step.** It must be mapped explicitly, which surprises people and produces empty values:

```yaml
- script: ./deploy.sh
  env:
    TOKEN: $(mySecret)        # explicit mapping required
```

Masking is best-effort, exactly as elsewhere: any transformation defeats it.

## Version notes

| | Status |
| --- | ------ |
| YAML pipelines | **The only model receiving investment** since 2023 |
| Classic pipelines | **Maintenance mode.** Out of scope |
| Workload identity federation | Current recommendation over service principal secrets |
| Task versions | Pinned with `@N` (`AzureWebApp@1`). Majors change inputs |
| Agent pools | Microsoft-hosted images roll continuously, like GitHub's |

- **Pin task major versions.** `AzureWebApp@1` and `@2` take different inputs.
- **Feature availability differs between Azure DevOps Services and Server**, and self-hosted Server lags. Check the instance.
- **The 2020 Packt book is a Classic-pipelines source**, quantified above. Concepts yes, syntax no.
- **Not verified here:** nothing in this file was executed. No Azure DevOps organisation is available on this machine, so all of it is cited from Microsoft's documentation.

## Gotchas

- Agent writes Azure DevOps guidance from a pre-2023 source - that is Classic pipelines, which are maintenance-mode
- Agent uses `${{ }}` for a value produced by an earlier stage - compile-time expansion yields empty, with no error
- Agent expects a template to behave like a GitHub reusable workflow - a template is substitution with no permission scope of its own
- Agent uses untyped template parameters - fails at runtime instead of compile time
- Agent consumes a template from another repository without pinning the ref - executing code that can change under you
- Agent uses a service principal with a client secret - workload identity federation removes the secret entirely
- Agent leaves a service connection usable by every pipeline - a project-wide grant to production
- Agent omits the exclusive lock on a production environment - concurrent deploys race
- Agent expects a secret variable to appear as an environment variable in a script - it must be mapped explicitly
- Agent uses `job` where a `deployment` job is needed - no environment binding, no deployment history, no `strategy`
- Agent leaves task versions unpinned - a major bump changes the inputs
- Agent relies on log masking for a secret - defeated by any encoding

## Related

- [platform-matrix.md](platform-matrix.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [environments-and-promotion.md](environments-and-promotion.md) · [runners.md](runners.md) · [target-azure.md](target-azure.md) · [pipeline-design.md](pipeline-design.md) · [book-deltas.md](book-deltas.md) · [platform-versions.md](platform-versions.md) · [checklist.md](checklist.md)
