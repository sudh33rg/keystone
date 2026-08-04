/* eslint-disable no-useless-escape -- manifest and configuration regexes retain explicit bracket escapes. */
import { posix } from "node:path";
import type { AdapterCapability, AdapterDetection } from "../../../shared/contracts/adapters";
import type { IntelligenceSymbolRecord } from "../../../shared/contracts/intelligence";
import type { SemanticSourceFileInput } from "../semantic/SemanticModel";
import { rangeAt, wholeRange } from "./AdapterEvidenceFactory";
import type { AdapterOutputBuilder } from "./BaseAdapter";
import { DeterministicAdapter, detection, lines } from "./BaseAdapter";
import { capability } from "./UniversalAdapters";

export class DeterministicBuildPackageAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.build-package";
  readonly version = "1.0.0";
  capability(): AdapterCapability {
    return capability(
      this,
      "build",
      [
        "npm",
        "pnpm",
        "yarn",
        "maven",
        "gradle",
        "msbuild",
        "dotnet",
        "python-packaging",
        "poetry",
        "pip",
        "go-modules",
        "cargo",
        "make",
        "cmake",
      ],
      "tier-5",
      "structural",
      [
        "keystone.core.Package",
        "keystone.core.ExternalDependency",
        "keystone.core.BuildTarget",
        "keystone.core.BuildCommand",
        "keystone.core.TestCommand",
        "keystone.core.LintCommand",
        "keystone.core.Plugin",
      ],
      [
        "keystone.core.DEPENDS_ON",
        "keystone.core.BUILDS_WITH",
        "keystone.core.HAS_SCRIPT",
        "keystone.core.EXECUTES",
        "keystone.core.GENERATES",
      ],
      [
        "Build scripts are classified, not executed.",
        "Conditional dependency resolution and remote repositories are not evaluated.",
      ],
    );
  }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const rules: Array<[string, RegExp]> = [
      ["npm", /(^|\/)package\.json$/],
      ["pnpm", /(^|\/)pnpm-(?:lock|workspace)\.ya?ml$/],
      ["yarn", /(^|\/)yarn\.lock$/],
      ["maven", /(^|\/)pom\.xml$/],
      ["gradle", /(^|\/)(?:build|settings)\.gradle(?:\.kts)?$/],
      ["msbuild", /\.(?:csproj|fsproj|vbproj|sln)$/],
      ["python-packaging", /(^|\/)(?:pyproject\.toml|setup\.py)$/],
      ["pip", /(^|\/)requirements[^/]*\.txt$/],
      ["go-modules", /(^|\/)go\.mod$/],
      ["cargo", /(^|\/)Cargo\.toml$/],
      ["make", /(^|\/)Makefile$/i],
      ["cmake", /(^|\/)CMakeLists\.txt$/i],
    ];
    return rules.flatMap(([technology, expression]) => {
      const selected = files.filter((file) => expression.test(file.relativePath));
      return selected.length
        ? [
            detection(
              this.id,
              technology,
              "structural",
              selected,
              "manifest",
              `${technology} manifest/build file matched.`,
            ),
          ]
        : [];
    });
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) {
      const name = posix.basename(file.relativePath).toLowerCase();
      if (name === "package.json") this.packageJson(file, output);
      else if (name === "pom.xml") this.maven(file, output);
      else if (/\.gradle(?:\.kts)?$/.test(name)) this.gradle(file, output);
      else if (/\.(?:csproj|fsproj|vbproj)$/.test(name)) this.msbuild(file, output);
      else if (name === "pyproject.toml" || name === "setup.py" || name.startsWith("requirements"))
        this.python(file, output);
      else if (name === "go.mod") this.go(file, output);
      else if (name === "cargo.toml") this.cargo(file, output);
      else if (name === "makefile" || name === "cmakelists.txt") this.targets(file, output);
      else this.lockfile(file, output);
    }
  }
  private packageJson(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    let value: unknown;
    try {
      value = JSON.parse(file.content) as unknown;
    } catch {
      output.failedFiles++;
      output.diagnostic(
        "parse-failure",
        "warning",
        "package.json is not valid JSON.",
        file,
        undefined,
        { technologyId: "npm" },
      );
      return;
    }
    const record = asRecord(value);
    const packageName = string(record.name) ?? posix.dirname(file.relativePath);
    const pkg = output.entity(
      file,
      "keystone.core.Package",
      packageName,
      `${file.relativePath}#package:${packageName}`,
      wholeRange(file.content),
      { packageManager: packageManager(file, record) },
    );
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const)
      for (const dependencyName of Object.keys(asRecord(record[section])).sort()) {
        const dependency = output.entity(
          file,
          "keystone.core.ExternalDependency",
          dependencyName,
          `${file.relativePath}#dependency:${dependencyName}`,
          wholeRange(file.content),
          { dependencyKind: section },
        );
        output.relationship(pkg, dependency, "keystone.core.DEPENDS_ON", file, dependency.range, {
          properties: { dependencyKind: section },
        });
      }
    for (const [scriptName, commandValue] of Object.entries(asRecord(record.scripts))) {
      const type = /test/.test(scriptName)
        ? "keystone.core.TestCommand"
        : /build/.test(scriptName)
          ? "keystone.core.BuildCommand"
          : /lint/.test(scriptName)
            ? "keystone.core.LintCommand"
            : "keystone.core.Command";
      const script = output.entity(
        file,
        type,
        scriptName,
        `${pkg.qualifiedName}.scripts.${scriptName}`,
        wholeRange(file.content),
        { scriptName, commandKind: classifyCommand(string(commandValue) ?? "") },
      );
      output.relationship(pkg, script, "keystone.core.HAS_SCRIPT", file, script.range, {
        properties: { scriptName },
      });
    }
  }
  private maven(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const artifact = xmlText(file.content, "artifactId") ?? posix.dirname(file.relativePath);
    const pkg = output.entity(
      file,
      "keystone.core.Package",
      artifact,
      `${file.relativePath}#maven:${artifact}`,
      wholeRange(file.content),
      { buildSystem: "maven" },
    );
    for (const dependencyBlock of file.content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g))
      if (dependencyBlock.index !== undefined) {
        const group = xmlText(dependencyBlock[1] ?? "", "groupId") ?? "";
        const name = xmlText(dependencyBlock[1] ?? "", "artifactId");
        if (!name) continue;
        const dependency = output.entity(
          file,
          "keystone.core.ExternalDependency",
          name,
          `${file.relativePath}#maven-dependency:${group}:${name}`,
          rangeAt(
            file.content,
            dependencyBlock.index,
            dependencyBlock.index + dependencyBlock[0].length,
          ),
          { dependencyKind: xmlText(dependencyBlock[1] ?? "", "scope") ?? "compile", group },
        );
        output.relationship(pkg, dependency, "keystone.core.DEPENDS_ON", file, dependency.range);
      }
    for (const pluginBlock of file.content.matchAll(/<plugin>([\s\S]*?)<\/plugin>/g))
      if (pluginBlock.index !== undefined) {
        const name = xmlText(pluginBlock[1] ?? "", "artifactId");
        if (!name) continue;
        const plugin = output.entity(
          file,
          "keystone.core.Plugin",
          name,
          `${file.relativePath}#maven-plugin:${name}`,
          rangeAt(file.content, pluginBlock.index, pluginBlock.index + pluginBlock[0].length),
          { buildSystem: "maven" },
        );
        output.relationship(pkg, plugin, "keystone.core.BUILDS_WITH", file, plugin.range);
      }
  }
  private gradle(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const pkg = output.entity(
      file,
      "keystone.core.Package",
      posix.dirname(file.relativePath),
      `${file.relativePath}#gradle`,
      wholeRange(file.content),
      { buildSystem: "gradle" },
    );
    for (const match of file.content.matchAll(
      /^\s*(implementation|api|testImplementation|runtimeOnly|compileOnly)\s*(?:\(|\s)["']([^"']+)["']/gm,
    ))
      if (match.index !== undefined && match[1] && match[2]) {
        const dependency = output.entity(
          file,
          "keystone.core.ExternalDependency",
          match[2],
          `${file.relativePath}#gradle-dependency:${match[2]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { dependencyKind: match[1] },
        );
        output.relationship(pkg, dependency, "keystone.core.DEPENDS_ON", file, dependency.range, {
          properties: { dependencyKind: match[1] },
        });
      }
    for (const match of file.content.matchAll(
      /(?:tasks\.(?:register|create)\s*\(\s*["']([^"']+)["']|^\s*task\s+([A-Za-z_]\w*))/gm,
    ))
      if (match.index !== undefined) {
        const name = match[1] ?? match[2];
        if (!name) continue;
        const target = output.entity(
          file,
          "keystone.core.BuildTarget",
          name,
          `${file.relativePath}#task:${name}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { buildSystem: "gradle" },
        );
        output.relationship(pkg, target, "keystone.core.CONTAINS", file, target.range);
      }
  }
  private msbuild(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const project = output.entity(
      file,
      "keystone.core.Package",
      posix.basename(file.relativePath),
      file.relativePath,
      wholeRange(file.content),
      {
        buildSystem: "msbuild",
        targetFramework:
          xmlText(file.content, "TargetFramework") ??
          xmlText(file.content, "TargetFrameworks") ??
          "unknown",
      },
    );
    for (const match of file.content.matchAll(/<PackageReference\s+Include=["']([^"']+)["']/g))
      if (match.index !== undefined && match[1]) {
        const dependency = output.entity(
          file,
          "keystone.core.ExternalDependency",
          match[1],
          `${file.relativePath}#nuget:${match[1]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { dependencyKind: "nuget" },
        );
        output.relationship(
          project,
          dependency,
          "keystone.core.DEPENDS_ON",
          file,
          dependency.range,
        );
      }
    for (const match of file.content.matchAll(/<Target\s+Name=["']([^"']+)["']/g))
      if (match.index !== undefined && match[1]) {
        const target = output.entity(
          file,
          "keystone.core.BuildTarget",
          match[1],
          `${file.relativePath}#target:${match[1]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { buildSystem: "msbuild" },
        );
        output.relationship(project, target, "keystone.core.CONTAINS", file, target.range);
      }
  }
  private python(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const name =
      file.content.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] ??
      file.content.match(/name\s*=\s*["']([^"']+)["']/)?.[1] ??
      posix.dirname(file.relativePath);
    const pkg = output.entity(
      file,
      "keystone.core.Package",
      name,
      `${file.relativePath}#python:${name}`,
      wholeRange(file.content),
      { packageManager: /poetry/i.test(file.content) ? "poetry" : "python" },
    );
    const dependencies = posix.basename(file.relativePath).startsWith("requirements")
      ? file.content
          .split(/\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
          .map((line) => line.split(/[<>=!~\[]/)[0] ?? "")
          .filter(Boolean)
      : [...file.content.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(?:["']|\{)/gm)]
          .map((match) => match[1] ?? "")
          .filter(Boolean);
    for (const dependencyName of [...new Set(dependencies)]) {
      const dependency = output.entity(
        file,
        "keystone.core.ExternalDependency",
        dependencyName,
        `${file.relativePath}#python-dependency:${dependencyName}`,
        wholeRange(file.content),
        { dependencyKind: "python" },
      );
      output.relationship(pkg, dependency, "keystone.core.DEPENDS_ON", file, dependency.range);
    }
  }
  private go(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const module =
      file.content.match(/^module\s+([^\s]+)$/m)?.[1] ?? posix.dirname(file.relativePath);
    const pkg = output.entity(
      file,
      "keystone.core.Package",
      module,
      `${file.relativePath}#go:${module}`,
      wholeRange(file.content),
      { packageManager: "go-modules" },
    );
    for (const match of file.content.matchAll(/^\s*([\w./-]+)\s+v\d[^\s]*/gm))
      if (match.index !== undefined && match[1] && match[1] !== "module") {
        const dependency = output.entity(
          file,
          "keystone.core.ExternalDependency",
          match[1],
          `${file.relativePath}#go-dependency:${match[1]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { dependencyKind: "go-module" },
        );
        output.relationship(pkg, dependency, "keystone.core.DEPENDS_ON", file, dependency.range);
      }
  }
  private cargo(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const name =
      file.content.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1] ?? posix.dirname(file.relativePath);
    const pkg = output.entity(
      file,
      "keystone.core.Package",
      name,
      `${file.relativePath}#cargo:${name}`,
      wholeRange(file.content),
      { packageManager: "cargo" },
    );
    let dependencies = false;
    for (const line of lines(file.content)) {
      if (/^\s*\[.*dependencies.*\]\s*$/.test(line.text)) {
        dependencies = true;
        continue;
      }
      if (/^\s*\[/.test(line.text)) dependencies = false;
      const match = dependencies ? line.text.match(/^\s*([A-Za-z0-9_-]+)\s*=/) : undefined;
      if (!match?.[1]) continue;
      const dependency = output.entity(
        file,
        "keystone.core.ExternalDependency",
        match[1],
        `${file.relativePath}#cargo-dependency:${match[1]}`,
        rangeAt(file.content, line.start, line.end),
        { dependencyKind: "cargo" },
      );
      output.relationship(pkg, dependency, "keystone.core.DEPENDS_ON", file, dependency.range);
    }
  }
  private targets(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const system = /cmakelists/i.test(file.relativePath) ? "cmake" : "make";
    const build = output.entity(
      file,
      "keystone.core.BuildTarget",
      system,
      `${file.relativePath}#build`,
      wholeRange(file.content),
      { buildSystem: system },
    );
    const expression =
      system === "make"
        ? /^([A-Za-z0-9_.-]+)\s*:(?![=])/gm
        : /(?:add_executable|add_library|add_custom_target)\s*\(\s*([A-Za-z0-9_.-]+)/gi;
    for (const match of file.content.matchAll(expression))
      if (match.index !== undefined && match[1] && !match[1].startsWith(".")) {
        const target = output.entity(
          file,
          "keystone.core.BuildTarget",
          match[1],
          `${file.relativePath}#target:${match[1]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { buildSystem: system },
        );
        output.relationship(build, target, "keystone.core.CONTAINS", file, target.range);
      }
  }
  private lockfile(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    output.entity(
      file,
      "keystone.core.BuildArtifact",
      posix.basename(file.relativePath),
      file.relativePath,
      wholeRange(file.content),
      { metadataOnly: true, lockfile: true },
    );
  }
}

export class DeterministicCiAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.ci";
  readonly version = "1.0.0";
  capability(): AdapterCapability {
    return capability(
      this,
      "build",
      [
        "github-actions",
        "gitlab-ci",
        "azure-pipelines",
        "jenkins",
        "circleci",
        "travis-ci",
        "bitbucket-pipelines",
      ],
      "tier-5",
      "structural",
      [
        "keystone.core.Pipeline",
        "keystone.core.Workflow",
        "keystone.core.Job",
        "keystone.core.Step",
        "keystone.core.Trigger",
        "keystone.core.Artifact",
        "keystone.core.DeploymentUnit",
      ],
      [
        "keystone.core.CONTAINS",
        "keystone.core.EXECUTES",
        "keystone.core.TRIGGERED_BY",
        "keystone.core.RUNS_TEST_COMMAND",
        "keystone.core.RUNS_BUILD_COMMAND",
        "keystone.core.PRODUCES",
        "keystone.core.DEPLOYS",
      ],
      [
        "YAML anchors/templates and remote reusable workflows are not expanded.",
        "Secret references are stored by name only.",
      ],
    );
  }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const rules: Array<[string, RegExp]> = [
      ["github-actions", /(^|\/)\.github\/workflows\/.*\.ya?ml$/],
      ["gitlab-ci", /(^|\/)\.gitlab-ci\.ya?ml$/],
      ["azure-pipelines", /(^|\/)azure-pipelines\.ya?ml$/],
      ["jenkins", /(^|\/)Jenkinsfile$/i],
      ["circleci", /(^|\/)\.circleci\/config\.ya?ml$/],
      ["travis-ci", /(^|\/)\.travis\.ya?ml$/],
      ["bitbucket-pipelines", /(^|\/)bitbucket-pipelines\.ya?ml$/],
    ];
    return rules.flatMap(([technology, expression]) => {
      const selected = files.filter((file) => expression.test(file.relativePath));
      return selected.length
        ? [
            detection(
              this.id,
              technology,
              "structural",
              selected,
              "format",
              `${technology} CI path matched.`,
            ),
          ]
        : [];
    });
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) this.pipeline(file, output);
  }
  private pipeline(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const provider = ciProvider(file.relativePath);
    const pipeline = output.entity(
      file,
      "keystone.core.Pipeline",
      posix.basename(file.relativePath),
      file.relativePath,
      wholeRange(file.content),
      { provider },
    );
    const jobs = new Map<string, IntelligenceSymbolRecord>();
    let inJobs = false;
    let currentJob: IntelligenceSymbolRecord | undefined;
    let jobIndent = 0;
    for (const line of lines(file.content)) {
      if (/^jobs:\s*$/.test(line.text.trim()) || /^stages?\s*\{?\s*$/.test(line.text.trim())) {
        inJobs = true;
        continue;
      }
      const key = line.text.match(/^(\s*)([A-Za-z0-9_.-]+):\s*$/);
      if (
        inJobs &&
        key?.[2] &&
        !["steps", "script", "stage", "variables", "artifacts", "rules"].includes(key[2])
      ) {
        const indent = key[1]?.length ?? 0;
        if (!currentJob || indent <= jobIndent) {
          jobIndent = indent;
          currentJob = output.entity(
            file,
            "keystone.core.Job",
            key[2],
            `${file.relativePath}#job:${key[2]}`,
            rangeAt(file.content, line.start, line.end),
            { provider },
          );
          jobs.set(key[2], currentJob);
          output.relationship(
            pipeline,
            currentJob,
            "keystone.core.CONTAINS",
            file,
            currentJob.range,
          );
          continue;
        }
      }
      const run =
        line.text.match(/^\s*(?:-\s*)?(?:run|script|powershell|bash):\s*(.+)$/) ??
        line.text.match(/^\s*-\s+(.+)$/);
      if (currentJob && run?.[1] && !/^uses:/.test(run[1])) {
        const signature = commandSignature(run[1]);
        const step = output.entity(
          file,
          "keystone.core.Step",
          signature.label,
          `${currentJob.qualifiedName}#step:${line.start}`,
          rangeAt(file.content, line.start, line.end),
          {
            provider,
            commandKind: signature.kind,
            ...(signature.scriptName ? { scriptName: signature.scriptName } : {}),
            secretReferences: secretReferences(run[1]),
          },
        );
        output.relationship(currentJob, step, "keystone.core.CONTAINS", file, step.range);
        output.relationship(
          step,
          pipeline,
          signature.kind === "test"
            ? "keystone.core.RUNS_TEST_COMMAND"
            : signature.kind === "build"
              ? "keystone.core.RUNS_BUILD_COMMAND"
              : "keystone.core.EXECUTES",
          file,
          step.range,
          {
            properties: {
              commandKind: signature.kind,
              ...(signature.scriptName ? { scriptName: signature.scriptName } : {}),
            },
          },
        );
      }
    }
    for (const trigger of file.content.matchAll(
      /(?:^|\n)\s*(?:on|trigger):\s*(?:\n\s*-\s*)?([A-Za-z_][\w-]*)/g,
    ))
      if (trigger.index !== undefined && trigger[1]) {
        const entity = output.entity(
          file,
          "keystone.core.Trigger",
          trigger[1],
          `${file.relativePath}#trigger:${trigger[1]}`,
          rangeAt(file.content, trigger.index, trigger.index + trigger[0].length),
          { provider },
        );
        output.relationship(pipeline, entity, "keystone.core.TRIGGERED_BY", file, entity.range);
      }
  }
}

export class DeterministicInfrastructureAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.infrastructure";
  readonly version = "1.0.0";
  capability(): AdapterCapability {
    return capability(
      this,
      "infrastructure",
      [
        "docker",
        "docker-compose",
        "kubernetes",
        "helm",
        "terraform",
        "opentofu",
        "serverless",
        "cloudformation",
      ],
      "tier-5",
      "structural",
      [
        "keystone.core.Container",
        "keystone.core.ContainerImage",
        "keystone.core.Service",
        "keystone.core.Port",
        "keystone.core.Volume",
        "keystone.core.InfrastructureResource",
        "keystone.core.Deployment",
        "keystone.core.Namespace",
        "keystone.core.SecretReference",
        "keystone.core.ConfigMap",
      ],
      [
        "keystone.core.USES_IMAGE",
        "keystone.core.EXPOSES_PORT",
        "keystone.core.DEPENDS_ON",
        "keystone.core.DEPLOYS",
        "keystone.core.READS_CONFIGURATION",
      ],
      [
        "Templates/providers are not evaluated.",
        "Secret values are never stored; references are name-only.",
      ],
    );
  }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const groups: Array<[string, SemanticSourceFileInput[]]> = [
      [
        "docker",
        files.filter((file) => /^Dockerfile(?:\..+)?$/i.test(posix.basename(file.relativePath))),
      ],
      [
        "docker-compose",
        files.filter((file) => /(?:docker-)?compose(?:\.[^/]+)?\.ya?ml$/i.test(file.relativePath)),
      ],
      ["terraform", files.filter((file) => /\.tf$/i.test(file.relativePath))],
      [
        "kubernetes",
        files.filter(
          (file) =>
            /\.ya?ml$/i.test(file.relativePath) &&
            /^\s*apiVersion\s*:/m.test(file.content) &&
            /^\s*kind\s*:/m.test(file.content),
        ),
      ],
      ["helm", files.filter((file) => /(^|\/)Chart\.ya?ml$/i.test(file.relativePath))],
      ["serverless", files.filter((file) => /(^|\/)serverless\.ya?ml$/i.test(file.relativePath))],
    ];
    return groups
      .filter(([, selected]) => selected.length)
      .map(([technology, selected]) =>
        detection(
          this.id,
          technology,
          "structural",
          selected,
          "format",
          `${technology} infrastructure format matched.`,
        ),
      );
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) {
      const name = posix.basename(file.relativePath);
      if (/^Dockerfile/i.test(name)) this.docker(file, output);
      else if (/compose/i.test(name)) this.compose(file, output);
      else if (/\.tf$/i.test(name)) this.terraform(file, output);
      else this.kubernetes(file, output);
    }
  }
  private docker(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const container = output.entity(
      file,
      "keystone.core.Container",
      posix.basename(file.relativePath),
      file.relativePath,
      wholeRange(file.content),
      { technology: "docker" },
    );
    for (const match of file.content.matchAll(/^FROM\s+([^\s]+)(?:\s+AS\s+(\S+))?/gim))
      if (match.index !== undefined && match[1]) {
        const image = output.entity(
          file,
          "keystone.core.ContainerImage",
          match[1],
          `${file.relativePath}#image:${match[1]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { image: match[1], ...(match[2] ? { stage: match[2] } : {}) },
        );
        output.relationship(container, image, "keystone.core.USES_IMAGE", file, image.range);
      }
    for (const match of file.content.matchAll(/^EXPOSE\s+(.+)$/gim))
      if (match.index !== undefined && match[1])
        for (const value of match[1].trim().split(/\s+/)) {
          const port = output.entity(
            file,
            "keystone.core.Port",
            value,
            `${file.relativePath}#port:${value}`,
            rangeAt(file.content, match.index, match.index + match[0].length),
            { port: value },
          );
          output.relationship(container, port, "keystone.core.EXPOSES_PORT", file, port.range);
        }
    for (const match of file.content.matchAll(/^ENV\s+([A-Za-z_][A-Za-z0-9_]*)/gim))
      if (match.index !== undefined && match[1]) {
        const key = output.entity(
          file,
          "keystone.core.ConfigurationKey",
          match[1],
          `${file.relativePath}#env:${match[1]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { configurationClass: "sensitive-name-only", valueStored: false },
        );
        output.relationship(container, key, "keystone.core.READS_CONFIGURATION", file, key.range);
      }
  }
  private compose(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const root = output.entity(
      file,
      "keystone.core.Deployment",
      posix.basename(file.relativePath),
      file.relativePath,
      wholeRange(file.content),
      { technology: "docker-compose" },
    );
    const services = new Map<string, IntelligenceSymbolRecord>();
    let inServices = false;
    let current: IntelligenceSymbolRecord | undefined;
    for (const line of lines(file.content)) {
      if (/^services:\s*$/.test(line.text.trim())) {
        inServices = true;
        continue;
      }
      const key = line.text.match(/^(\s{2})([\w.-]+):\s*$/);
      if (inServices && key?.[2]) {
        current = output.entity(
          file,
          "keystone.core.Service",
          key[2],
          `${file.relativePath}#service:${key[2]}`,
          rangeAt(file.content, line.start, line.end),
          { technology: "docker-compose" },
        );
        services.set(key[2], current);
        output.relationship(root, current, "keystone.core.DEPLOYS", file, current.range);
        continue;
      }
      const image = current ? line.text.match(/^\s+image:\s*([^\s#]+)/)?.[1] : undefined;
      if (current && image) {
        const value = output.entity(
          file,
          "keystone.core.ContainerImage",
          image,
          `${current.qualifiedName}#image:${image}`,
          rangeAt(file.content, line.start, line.end),
          { image },
        );
        output.relationship(current, value, "keystone.core.USES_IMAGE", file, value.range);
      }
      const port = current ? line.text.match(/^\s*-\s*["']?([0-9]+(?::[0-9]+)?)/)?.[1] : undefined;
      if (current && port) {
        const value = output.entity(
          file,
          "keystone.core.Port",
          port,
          `${current.qualifiedName}#port:${port}`,
          rangeAt(file.content, line.start, line.end),
          { port },
        );
        output.relationship(current, value, "keystone.core.EXPOSES_PORT", file, value.range);
      }
    }
    for (const [name, service] of services) {
      const block = serviceBlock(file.content, name);
      for (const dependencyName of block
        .match(/depends_on:\s*\n((?:\s+-?\s*[\w.-]+\s*\n?)*)/)?.[1]
        ?.match(/[\w.-]+/g) ?? []) {
        const target = services.get(dependencyName);
        if (target)
          output.relationship(service, target, "keystone.core.DEPENDS_ON", file, service.range);
      }
    }
  }
  private terraform(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    for (const match of file.content.matchAll(
      /\b(resource|data|module|variable|output)\s+["']([^"']+)["'](?:\s+["']([^"']+)["'])?\s*\{/g,
    ))
      if (match.index !== undefined && match[1] && match[2]) {
        const name = match[3] ? `${match[2]}.${match[3]}` : match[2];
        const type =
          match[1] === "variable"
            ? "keystone.core.ConfigurationKey"
            : "keystone.core.InfrastructureResource";
        output.entity(
          file,
          type,
          name,
          `${file.relativePath}#terraform:${match[1]}:${name}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { resourceKind: match[1], resourceType: match[2], valueStored: false },
        );
      }
  }
  private kubernetes(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const kind = file.content.match(/^\s*kind\s*:\s*([^\s#]+)/m)?.[1] ?? "Resource";
    const name =
      file.content.match(/^\s*name\s*:\s*([^\s#]+)/m)?.[1] ?? posix.basename(file.relativePath);
    const type =
      kind === "Secret"
        ? "keystone.core.SecretReference"
        : kind === "ConfigMap"
          ? "keystone.core.ConfigMap"
          : /Deployment|StatefulSet|DaemonSet/.test(kind)
            ? "keystone.core.Deployment"
            : kind === "Service"
              ? "keystone.core.Service"
              : kind === "Namespace"
                ? "keystone.core.Namespace"
                : "keystone.core.InfrastructureResource";
    const resource = output.entity(
      file,
      type,
      name,
      `${file.relativePath}#${kind}:${name}`,
      wholeRange(file.content),
      { resourceKind: kind, valueStored: false },
    );
    for (const match of file.content.matchAll(/image:\s*([^\s#]+)/g))
      if (match.index !== undefined && match[1]) {
        const image = output.entity(
          file,
          "keystone.core.ContainerImage",
          match[1],
          `${resource.qualifiedName}#image:${match[1]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { image: match[1] },
        );
        output.relationship(resource, image, "keystone.core.USES_IMAGE", file, image.range);
      }
    for (const match of file.content.matchAll(
      /(?:secretKeyRef|configMapKeyRef):\s*\n\s*name:\s*([^\s#]+)/g,
    ))
      if (match.index !== undefined && match[1]) {
        const reference = output.entity(
          file,
          "keystone.core.ConfigurationKey",
          match[1],
          `${resource.qualifiedName}#config-ref:${match[1]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          { configurationClass: "sensitive-name-only", valueStored: false },
        );
        output.relationship(
          resource,
          reference,
          "keystone.core.READS_CONFIGURATION",
          file,
          reference.range,
        );
      }
  }
}

export class DeterministicConfigurationAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.configuration";
  readonly version = "1.0.0";
  capability(): AdapterCapability {
    return capability(
      this,
      "configuration",
      ["json", "yaml", "toml", "xml", "ini", "properties", "environment-template"],
      "tier-5",
      "structural",
      [
        "keystone.core.ConfigurationFile",
        "keystone.core.ConfigurationKey",
        "keystone.core.EnvironmentVariable",
      ],
      ["keystone.core.DECLARES", "keystone.core.READS_CONFIGURATION"],
      [
        "Values are never persisted by this adapter.",
        "Secret-bearing files are excluded before worker input.",
        "Arbitrary configuration semantics are not inferred.",
      ],
    );
  }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const selected = files.filter(
      (file) =>
        /\.(?:json|ya?ml|toml|xml|ini|properties|env\.example|env\.template)$/i.test(
          file.relativePath,
        ) && !isOwnedSpecialFormat(file),
    );
    return selected.length
      ? [
          detection(
            this.id,
            "configuration",
            "structural",
            selected,
            "extension",
            "Recognized non-secret configuration format.",
          ),
        ]
      : [];
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) {
      const config = output.entity(
        file,
        "keystone.core.ConfigurationFile",
        posix.basename(file.relativePath),
        file.relativePath,
        wholeRange(file.content),
        { configurationClass: configurationClass(file), valuesStored: false },
      );
      const keys = configurationKeys(file);
      for (const key of keys.slice(0, 1000)) {
        const entity = output.entity(
          file,
          key.environment ? "keystone.core.EnvironmentVariable" : "keystone.core.ConfigurationKey",
          key.name,
          `${file.relativePath}#config:${key.path}`,
          rangeAt(file.content, key.start, key.end),
          {
            keyPath: key.path,
            configurationClass: sensitiveKeyName(key.name)
              ? "sensitive-name-only"
              : configurationClass(file),
            defaultValuePresent: key.defaultValuePresent,
            valueStored: false,
          },
        );
        output.relationship(config, entity, "keystone.core.DECLARES", file, entity.range);
      }
      if (keys.length > 1000)
        output.diagnostic(
          "configuration-key-limit",
          "warning",
          "Configuration key extraction was truncated at 1,000 keys.",
          file,
          undefined,
          { technologyId: "configuration", limitation: true },
        );
    }
  }
}

export class UniversalFallbackAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.fallback";
  readonly version = "1.0.0";
  capability(): AdapterCapability {
    return capability(
      this,
      "fallback",
      ["unknown-structural"],
      "tier-0",
      "metadata-only",
      [],
      [],
      ["No reliable parser is registered; only canonical file inventory is available."],
    );
  }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const known =
      /\.(?:ts|tsx|js|jsx|java|py|cs|go|rs|c|cc|cpp|h|hpp|rb|php|kt|kts|swift|sh|bash|zsh|sql|md|mdx|adoc|rst|txt|graphql|gql|proto|avsc|prisma|json|ya?ml|toml|xml|ini|properties|tf)$/i;
    const selected = files.filter((file) => !known.test(file.relativePath));
    return selected.length
      ? [
          detection(
            this.id,
            "unknown-structural",
            "metadata-only",
            selected,
            "extension",
            "No registered structural adapter matched this file type.",
            1,
            this.capability().limitations,
          ),
        ]
      : [];
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) {
      output.unsupported++;
      output.diagnostic(
        "missing-adapter",
        "info",
        "No structural or semantic adapter is installed; file inventory remains available.",
        file,
        undefined,
        { technologyId: "unknown-structural", limitation: true },
      );
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function packageManager(file: SemanticSourceFileInput, record: Record<string, unknown>): string {
  if (typeof record.packageManager === "string")
    return record.packageManager.split("@")[0] ?? "npm";
  if (/pnpm-lock/.test(file.content)) return "pnpm";
  return "npm";
}
function classifyCommand(value: string): string {
  if (
    /\b(?:test|vitest|jest|mocha|pytest|cargo test|go test|dotnet test|mvn test|gradle test)\b/i.test(
      value,
    )
  )
    return "test";
  if (/\b(?:build|compile|bundle|package)\b/i.test(value)) return "build";
  if (/\b(?:lint|eslint|ruff|clippy)\b/i.test(value)) return "lint";
  return "command";
}
function xmlText(content: string, name: string): string | undefined {
  return content.match(new RegExp(`<${name}[^>]*>([^<]+)</${name}>`, "i"))?.[1]?.trim();
}
function ciProvider(path: string): string {
  if (/github/.test(path)) return "github-actions";
  if (/gitlab/.test(path)) return "gitlab-ci";
  if (/azure/.test(path)) return "azure-pipelines";
  if (/jenkins/i.test(path)) return "jenkins";
  if (/circleci/.test(path)) return "circleci";
  if (/travis/.test(path)) return "travis-ci";
  return "bitbucket-pipelines";
}
function commandSignature(value: string): { label: string; kind: string; scriptName?: string } {
  const npm = value.match(/(?:npm|pnpm|yarn)\s+(?:run\s+)?([A-Za-z0-9:_-]+)/);
  const scriptName = npm?.[1];
  const kind = classifyCommand(value);
  return {
    label: scriptName ? `${kind}: ${scriptName}` : kind,
    kind,
    ...(scriptName ? { scriptName } : {}),
  };
}
function secretReferences(value: string): string[] {
  return [...value.matchAll(/(?:secrets\.|\$\{?)([A-Z][A-Z0-9_]{2,})/g)]
    .map((match) => match[1] ?? "")
    .filter(Boolean)
    .slice(0, 50);
}
function serviceBlock(content: string, name: string): string {
  const expression = new RegExp(`^  ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*$`, "m");
  const start = content.search(expression);
  if (start < 0) return "";
  const rest = content.slice(start + 1);
  const next = rest.search(/^ {2}[\w.-]+:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}
function configurationClass(file: SemanticSourceFileInput): string {
  if (/test|spec/i.test(file.relativePath)) return "test";
  if (/build|tsconfig|eslint|prettier/i.test(file.relativePath)) return "build";
  if (/k8s|docker|terraform|helm/i.test(file.relativePath)) return "infrastructure";
  return "runtime";
}
function sensitiveKeyName(name: string): boolean {
  return /(?:password|passwd|secret|token|credential|private[_-]?key|api[_-]?key)/i.test(name);
}
function isOwnedSpecialFormat(file: SemanticSourceFileInput): boolean {
  return (
    /(?:openapi|swagger|compose|\.github\/workflows|\.gitlab-ci|azure-pipelines|k8s|kubernetes)/i.test(
      file.relativePath,
    ) || /^\s*(?:openapi|swagger|apiVersion|kind)\s*:/m.test(file.content)
  );
}
function configurationKeys(file: SemanticSourceFileInput): Array<{
  name: string;
  path: string;
  start: number;
  end: number;
  defaultValuePresent: boolean;
  environment: boolean;
}> {
  const result: Array<{
    name: string;
    path: string;
    start: number;
    end: number;
    defaultValuePresent: boolean;
    environment: boolean;
  }> = [];
  if (/\.json$/i.test(file.relativePath)) {
    try {
      const value = JSON.parse(file.content) as unknown;
      walkJsonKeys(value, "", result, file.content);
      return dedupeKeys(result);
    } catch {
      /* use line parser */
    }
  }
  const stack: Array<{ indent: number; key: string }> = [];
  for (const line of lines(file.content)) {
    const match = line.text.match(/^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*(?::|=)(.*)$/);
    if (!match?.[2]) continue;
    const indent = match[1]?.length ?? 0;
    while (stack.length && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop();
    const name = match[2];
    const path = [...stack.map((item) => item.key), name].join(".");
    result.push({
      name,
      path,
      start: line.start + line.text.indexOf(name),
      end: line.start + line.text.indexOf(name) + name.length,
      defaultValuePresent: Boolean(match[3]?.trim()),
      environment: /^[A-Z][A-Z0-9_]+$/.test(name),
    });
    if (!match[3]?.trim()) stack.push({ indent, key: name });
  }
  return dedupeKeys(result);
}
function walkJsonKeys(
  value: unknown,
  parent: string,
  result: Array<{
    name: string;
    path: string;
    start: number;
    end: number;
    defaultValuePresent: boolean;
    environment: boolean;
  }>,
  content: string,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = parent ? `${parent}.${key}` : key;
    const match = new RegExp(`["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\s*:`).exec(
      content,
    );
    const start = match?.index ?? 0;
    result.push({
      name: key,
      path,
      start,
      end: start + key.length,
      defaultValuePresent: child !== undefined && child !== null && typeof child !== "object",
      environment: /^[A-Z][A-Z0-9_]+$/.test(key),
    });
    walkJsonKeys(child, path, result, content);
  }
}
function dedupeKeys(
  values: Array<{
    name: string;
    path: string;
    start: number;
    end: number;
    defaultValuePresent: boolean;
    environment: boolean;
  }>,
) {
  return values.filter(
    (item, index) => values.findIndex((other) => other.path === item.path) === index,
  );
}
