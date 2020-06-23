/*
 * Copyright © 2020 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventContext, EventHandler, git, github, project, repository, runSteps, secret, Step } from "@atomist/skill";
import { Severity } from "@atomist/skill-logging";
import * as fs from "fs-extra";
import { DefaultLintConfiguration, LintConfiguration } from "../configuration";
import { LintOnPushSubscription } from "../typings/types";

interface LintParameters {
    project: project.Project;
    credential: secret.GitHubCredential | secret.GitHubAppCredential;
    start: string;
    check: github.Check;
}

type LintStep = Step<EventContext<LintOnPushSubscription, LintConfiguration>, LintParameters>;

const SetupStep: LintStep = {
    name: "clone repository",
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        const repo = push.repo;

        if (push.branch.startsWith("eslint-")) {
            return {
                code: 1,
                reason: "Don't lint an eslint branch",
                visibility: "hidden",
            };
        }

        await ctx.audit.log(`Starting ESLint on ${repo.owner}/${repo.name}`);

        params.credential = await ctx.credential.resolve(
            secret.gitHubAppToken({
                owner: repo.owner,
                repo: repo.name,
                apiUrl: repo.org.provider.apiUrl,
            }),
        );

        params.project = await ctx.project.clone(
            repository.gitHub({
                owner: repo.owner,
                repo: repo.name,
                credential: params.credential,
                branch: push.branch,
                sha: push.after.sha,
            }),
            { alwaysDeep: false, detachHead: false },
        );
        await ctx.audit.log(`Cloned repository ${repo.owner}/${repo.name} at sha ${push.after.sha.slice(0, 7)}`);

        if (!(await fs.pathExists(params.project.path("package.json")))) {
            return {
                code: 1,
                reason: "Project not an NPM project",
                visibility: "hidden",
            };
        }

        const includeGlobs = (ctx.configuration?.[0]?.parameters?.ext || [".js"])
            .map(e => (!e.startsWith(".") ? `.${e}` : e))
            .map(e => `**/*${e}`);
        const ignores = ctx.configuration?.[0]?.parameters?.ignores || [];
        const matchingFiles = await project.globFiles(params.project, includeGlobs, {
            ignore: [".git", "node_modules", ...ignores],
        });
        if (matchingFiles.length === 0) {
            return {
                code: 1,
                reason: "Project does not contain any matching files",
                visibility: "hidden",
            };
        }

        params.check = await github.openCheck(ctx, params.project.id, {
            sha: push.after.sha,
            name: "eslint-skill",
            title: "ESLint",
            body: `Running \`eslint\``,
        });

        return {
            code: 0,
        };
    },
};

const NpmInstallStep: LintStep = {
    name: "npm install",
    run: async (ctx, params) => {
        const opts = { env: { ...process.env, NODE_ENV: "development" } };
        if (await fs.pathExists(params.project.path("package-lock.json"))) {
            await params.project.spawn("npm", ["ci"], opts);
        } else {
            await params.project.spawn("npm", ["install"], opts);
        }

        const cfg = ctx.configuration[0].parameters;
        if (cfg.modules?.length > 0) {
            await ctx.audit.log("Installing configured NPM packages");
            await params.project.spawn("npm", ["install", ...cfg.modules, "--save-dev"], opts);
            await params.project.spawn("git", ["reset", "--hard"], opts);
        }
        return {
            code: 0,
        };
    },
};

const ValidateRepositoryStep: LintStep = {
    name: "validate",
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        const repo = push.repo;

        if (!(await fs.pathExists(params.project.path("node_modules", ".bin", "eslint")))) {
            return {
                code: 1,
                visibility: "hidden",
                reason: `No ESLint installed in [${repo.owner}/${repo.name}](${repo.url})`,
            };
        } else {
            return {
                code: 0,
            };
        }
    },
};

const RunEslintStep: LintStep = {
    name: "run eslint",
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        const repo = push.repo;
        const cfg: LintConfiguration = {
            ...DefaultLintConfiguration,
            ...ctx.configuration[0].parameters,
        };
        const cmd = params.project.path("node_modules", ".bin", "eslint");
        const args: string[] = [];
        const reportFile = params.project.path(`eslintreport-${push.after.sha.slice(0, 7)}.json`);
        const configFile = params.project.path(`eslintrc-${push.after.sha.slice(0, 7)}.json`);
        const ignoreFile = params.project.path(`eslintignore-${push.after.sha.slice(0, 7)}.json`);
        const filesToDelete = [reportFile];

        cfg.ext?.forEach(e => args.push("--ext", e));
        args.push("--format", "json");
        args.push("--output-file", reportFile);
        cfg.args?.forEach(a => args.push(a));

        // Add .eslintignore if missing
        if (!(await fs.pathExists(params.project.path(".eslintignore"))) && !!cfg.ignores) {
            await fs.writeFile(ignoreFile, cfg.ignores.join("\n"));
            filesToDelete.push(ignoreFile);
            args.push("--ignore-path", ignoreFile);
        }

        // Add .eslintrc.json if missing
        const configs = await project.globFiles(params.project, ".eslintrc.*");
        const pj = await fs.readJson(params.project.path("package.json"));
        if (configs.length === 0 && !pj.eslintConfig && !!cfg.config) {
            await fs.writeFile(configFile, cfg.config);
            filesToDelete.push(configFile);
            args.push("--config", configFile);
        }

        if (!!cfg.push && cfg.push !== "none") {
            args.push("--fix");
        }
        args.push(".");

        const prefix = `${params.project.path()}/`;

        const lines = [];
        const argsString = args.join(" ").split(`${params.project.path()}/`).join("");
        await ctx.audit.log(`Running ESLint with: $ eslint ${argsString}`);

        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        const result = await params.project.spawn(cmd, args, { log: { write: msg => lines.push(msg) } });

        const violations: Array<{
            message: string;
            path: string;
            startLine: number;
            startColumn: number;
            endLine: number;
            endColumn: number;
            severity: number;
            rule: string;
        }> = [];
        if (await fs.pathExists(reportFile)) {
            const report = await fs.readJson(reportFile);
            report
                ?.filter(r => r.messages.length > 0)
                .forEach(r => {
                    r.messages.forEach(m => {
                        violations.push({
                            path: r.filePath.replace(prefix, ""),
                            message: m.message,
                            startLine: m.line,
                            startColumn: m.column,
                            endLine: m.endLine,
                            endColumn: m.endColumn,
                            severity: m.severity,
                            rule: m.ruleId,
                        });
                    });
                });
        }

        for (const file of filesToDelete) {
            await fs.remove(file);
        }

        if (result.status === 0 && violations.length === 0) {
            const clean = (await git.status(params.project)).isClean;
            if (clean) {
                await ctx.audit.log(`ESLint returned no errors or warnings`);
                await params.check.update({
                    conclusion: "success",
                    body: `Running \`eslint\` resulted in no warnings or errors.

\`$ eslint ${argsString}\``,
                });
                return {
                    code: 0,
                    reason: `ESLint returned no errors or warnings on [${repo.owner}/${repo.name}](${repo.url})`,
                };
            } else {
                await ctx.audit.log(`ESLint fixed some errors or warnings`);
                await params.check.update({
                    conclusion: "action_required",
                    body: `Running \`eslint\` fixed some errors and warnings.

\`$ eslint ${argsString}\``,
                });
                return {
                    code: 0,
                    reason: `ESLint fixed some errors or warnings on [${repo.owner}/${repo.name}](${repo.url})`,
                };
            }
        } else if (result.status === 1 || violations.length > 0) {
            await params.check.update({
                conclusion: "action_required",
                body: `Running \`eslint\` resulted in warnings and/or errors.

\`$ eslint ${argsString}\``,
                annotations: violations.map(r => ({
                    annotationLevel: r.severity === 1 ? "warning" : "failure",
                    path: r.path,
                    startLine: r.startLine,
                    endLine: r.endLine || r.startLine,
                    startOffset: r.startColumn,
                    endOffset: r.endColumn || r.startColumn,
                    title: r.rule,
                    message: r.message,
                })),
            });

            return {
                code: 0,
                reason: `ESLint raised [errors or warnings](${params.check.data.html_url}) on [${repo.owner}/${repo.name}](${repo.url})`,
            };
        } else if (result.status === 2) {
            await ctx.audit.log(`Running ESLint failed with configuration or internal error:`, Severity.ERROR);
            await ctx.audit.log(lines.join("\n"), Severity.ERROR);
            await params.check.update({
                conclusion: "action_required",
                body: `Running ESLint failed with a configuration error.

\`$ eslint ${argsString}\`

\`\`\`
${lines.join("\n")}
\`\`\``,
            });
            return {
                code: 1,
                reason: `Running ESLint failed with a configuration error`,
            };
        } else {
            await params.check.update({
                conclusion: "action_required",
                body: `Unknown ESLint exit code: \`${result.status}\``,
            });
            return {
                code: 1,
                visibility: "hidden",
                reason: `Unknown ESLint exit code`,
            };
        }
    },
};

const PushStep: LintStep = {
    name: "push",
    runWhen: async (ctx, params) => {
        const pushCfg = ctx.configuration[0]?.parameters?.push;
        return !!pushCfg && pushCfg !== "none" && !(await git.status(params.project)).isClean;
    },
    run: async (ctx, params) => {
        const cfg: LintConfiguration = {
            ...DefaultLintConfiguration,
            ...ctx.configuration[0].parameters,
        };
        const pushCfg = cfg.push;
        const push = ctx.data.Push[0];
        const repo = push.repo;

        return github.persistChanges(
            ctx,
            params.project,
            pushCfg,
            {
                branch: push.branch,
                defaultBranch: repo.defaultBranch,
                author: {
                    login: push.after.author?.login,
                    name: push.after.author?.name,
                    email: push.after.author?.emails?.[0]?.address,
                },
            },
            {
                branch: `eslint-${push.branch}`,
                title: "ESLint fixes",
                body: "ESLint fixed warnings and/or errors",
                labels: cfg.labels,
            },
            {
                message: cfg.commitMsg,
            },
        );
    },
};

const ClosePrStep: LintStep = {
    name: "close pr",
    runWhen: async (ctx, params) => {
        return (await git.status(params.project)).isClean;
    },
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        await github.closePullRequests(
            ctx,
            params.project,
            push.branch,
            `eslint-${push.branch}`,
            "Closing pull request because all fixable warnings and/or errors have been fixed in base branch",
        );
        return {
            code: 0,
        };
    },
};

export const handler: EventHandler<LintOnPushSubscription, LintConfiguration> = async ctx => {
    return runSteps({
        context: ctx,
        steps: [SetupStep, NpmInstallStep, ValidateRepositoryStep, RunEslintStep, ClosePrStep, PushStep],
    });
};
