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

import { Severity } from "@atomist/skill-logging";
import {
    EventContext,
    EventHandler,
} from "@atomist/skill/lib/handler";
import {
    gitHubComRepository,
    Project,
} from "@atomist/skill/lib/project";
import {
    GitHubAppCredential,
    gitHubAppToken,
    GitHubCredential,
} from "@atomist/skill/lib/secrets";
import {
    runSteps,
    Step,
} from "@atomist/skill/lib/steps";
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import {
    DefaultLintConfiguration,
    LintConfiguration,
} from "./configuration";
import { gitHub } from "./github";
import { LintOnPushSubscription } from "./types";

interface LintParameters {
    project: Project;
    credential: GitHubCredential | GitHubAppCredential;
    start: string;
}

type LintStep = Step<EventContext<LintOnPushSubscription, LintConfiguration>, LintParameters>;

const SetupStep: LintStep = {
    name: "setup",
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        const repo = push.repo;
        await ctx.audit.log(`Starting ESLint on ${repo.owner}/${repo.name}`);

        params.start = new Date().toISOString();
        params.credential = await ctx.credential.resolve(gitHubAppToken({
            owner: repo.owner,
            repo: repo.name,
            apiUrl: repo.org.provider.apiUrl,
        }));
        return {
            code: 0,
        };
    },
};

const CloneRepositoryStep: LintStep = {
    name: "clone repository",
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        const repo = push.repo;
        params.project = await ctx.project.clone(gitHubComRepository({
            owner: repo.owner,
            repo: repo.name,
            credential: params.credential,
            branch: push.branch,
            sha: push.after.sha,
        }), { alwaysDeep: false, detachHead: true });
        await ctx.audit.log(`Cloned repository ${repo.owner}/${repo.name} at sha ${push.after.sha.slice(0, 7)}`);
        return {
            code: 0,
        };
    },
};

const NpmInstallStep: LintStep = {
    name: "npm install",
    run: async (ctx, params) => {
        if (await params.project.hasFile("package-lock.json")) {
            await params.project.spawn("npm", ["ci"], { env: { ...process.env, NODE_ENV: "development" } });
        } else {
            await params.project.spawn("npm", ["install"], { env: { ...process.env, NODE_ENV: "development" } });
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

        if (!(await params.project.hasFile("node_modules/.bin/eslint"))) {
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
        const cmd = path.join(params.project.baseDir, "node_modules", ".bin", "eslint");
        const args: string[] = [];
        const reportFile = path.join(params.project.baseDir, `eslintreport-${push.after.sha.slice(0, 7)}.json`);
        const configFile = path.join(params.project.baseDir, `eslintrc-${push.after.sha.slice(0, 7)}.json`);
        const ignoreFile = path.join(params.project.baseDir, `eslintignore-${push.after.sha.slice(0, 7)}.json`);
        const filesToDelete = [reportFile];

        cfg.env?.forEach(e => args.push("--env", e));
        cfg.ext?.forEach(e => args.push("--ext", e));
        cfg.global?.forEach(e => args.push("--global", e));
        args.push("--format", "json");
        args.push("--output-file", reportFile);

        // Add .eslintignore if missing
        if (!(await params.project.hasFile(".eslintignore")) && !!cfg.ignores) {
            await fs.writeFile(ignoreFile, cfg.ignores.join("\n"));
            filesToDelete.push(ignoreFile);
            args.push("--ignore-path", ignoreFile);
        }
        // Add .eslintrc.json if missing
        if (!(await params.project.hasFile(".eslintrc.json")) && !!cfg.config) {
            await fs.writeFile(configFile, cfg.config);
            filesToDelete.push(configFile);
            args.push("--config", configFile);
        }

        if (cfg.fix) {
            args.push("--fix");
        }
        args.push(".");

        const prefix = `${params.project.baseDir}/`;

        const lines = [];
        const result = await params.project.spawn(cmd, args, { log: { write: msg => lines.push(msg) } });

        for (const file of filesToDelete) {
            await fs.remove(file);
        }

        const violations: Array<{ message: string, path: string, startLine: number, startColumn: number, endLine: number, endColumn: number, severity: number }> = [];
        if (await fs.pathExists(reportFile)) {
            const report = await fs.readJson(reportFile);
            report?.filter(r => r.messages.length > 0).forEach(r => {
                r.messages.forEach(m => {
                    violations.push({
                        path: r.filePath.replace(prefix, ""),
                        message: m.message,
                        startLine: m.line,
                        startColumn: m.column,
                        endLine: m.endLine,
                        endColumn: m.endColumn,
                        severity: m.severity,
                    });
                });
            });
        }

        if (result.status === 0 && violations.length === 0) {
            await ctx.audit.log(`ESLint returned no errors or warnings`);
            return {
                code: 0,
                reason: `ESLint returned no errors or warnings on [${repo.owner}/${repo.name}](${repo.url})`,
            };
        } else if (result.status === 1 || violations.length > 0) {
            const api = gitHub(params.credential.token, repo.org.provider.apiUrl);
            const check = (await api.checks.create({
                owner: repo.owner,
                repo: repo.name,
                head_sha: push.after.sha,
                conclusion: "action_required",
                status: "completed",
                name: "eslint-skill",
                external_id: ctx.correlationId,
                started_at: params.start,
                completed_at: new Date().toISOString(),
            })).data;
            const chunks = _.chunk(violations, 50);
            for (const chunk of chunks) {
                await api.checks.update({
                    owner: repo.owner,
                    repo: repo.name,
                    check_run_id: check.id,
                    output: {
                        title: "ESLint warnings and errors",
                        summary: `Running \`eslint ${args.join(" ")}\` resulted in the following warnings and errors`,
                        annotations: chunk.map(r => ({
                            annotation_level: r.severity === 1 ? "warning" : "failure",
                            path: r.path,
                            start_line: r.startLine,
                            end_line: r.endLine || r.startLine,
                            start_offset: r.startColumn,
                            end_offset: r.endColumn || r.startColumn,
                            message: r.message,
                        })),
                    },
                });
            }
            return {
                code: 0,
                reason: `ESLint returned errors or warnings on [${repo.owner}/${repo.name}](${repo.url})`,
            };
        } else if (result.status === 2) {
            await ctx.audit.log(`Running ESLint failed with configuration or internal error:`, Severity.ERROR);
            await ctx.audit.log(lines.join("\n"), Severity.ERROR);
            return {
                code: 1,
                reason: `Running ESLint failed with a configuration error`,
            };
        } else {
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
        return !!pushCfg && !(await params.project.gitStatus()).isClean;
    },
    run: async (ctx, params) => {
        const pushCfg = ctx.configuration[0]?.parameters?.push;
        const push = ctx.data.Push[0];
        const repo = push.repo;
        const commitMsg = `Autofix: ESLint\n\n[atomist:generated]\n[atomist-skill:atomist/eslint-skill]`;

        if (pushCfg === "pr") {
            await params.project.createBranch(`eslint-${push.branch}`);
            await params.project.commit(commitMsg);
            await params.project.push({ force: true });

            try {
                const api = gitHub(params.credential.token, repo.org.provider.apiUrl);
                const pr = (await api.pulls.create({
                    owner: repo.owner,
                    repo: repo.name,
                    title: "Autofix: ESLint",
                    body: commitMsg,
                    base: push.branch,
                    head: `eslint-${push.branch}`,
                })).data;
                await api.pulls.createReviewRequest({
                    owner: repo.owner,
                    repo: repo.name,
                    pull_number: pr.number,
                    reviewers: [push.after.author.login],
                });
                return {
                    code: 0,
                    reason: `Pushed ESLint fix to [${repo.owner}/${repo.name}](${repo.url}) and raised PR [#${pr.number}](${pr.html_url})`,
                };
            } catch (e) {
                // This might fail if the PR already exists
            }

        } else if (pushCfg === "commit" || (push.branch === push.repo.defaultBranch && pushCfg === "commit_default")) {
            await params.project.commit(commitMsg);
            await params.project.push();
        }
        return {
            code: 0,
            reason: `Pushed ESLint fix to [${repo.owner}/${repo.name}](${repo.url})`,
        };
    },
};

export const handler: EventHandler<LintOnPushSubscription, LintConfiguration> = async ctx => {
    return runSteps({
        context: ctx,
        steps: [
            SetupStep,
            CloneRepositoryStep,
            NpmInstallStep,
            ValidateRepositoryStep,
            RunEslintStep,
            PushStep,
        ],
    });
};
