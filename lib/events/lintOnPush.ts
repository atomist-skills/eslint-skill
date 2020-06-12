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
import { gitHubComRepository } from "@atomist/skill/lib/project";
import * as git from "@atomist/skill/lib/project/git";
import { gitHub } from "@atomist/skill/lib/project/github";
import { Project } from "@atomist/skill/lib/project/project";
import { globFiles } from "@atomist/skill/lib/project/util";
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
import {
    DefaultLintConfiguration,
    LintConfiguration,
} from "../configuration";
import { LintOnPushSubscription } from "../typings/types";

interface LintParameters {
    project: Project;
    credential: GitHubCredential | GitHubAppCredential;
    start: string;
    checkId: number;
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

        if (!(await fs.pathExists(params.project.path("package.json")))) {
            return {
                code: 1,
                reason: "Project not an NPM project",
                visibility: "hidden",
            };
        }

        const api = gitHub(gitHubComRepository({ owner: repo.owner, repo: repo.name, credential: params.credential }));
        params.checkId = (await api.checks.create({
            owner: repo.owner,
            repo: repo.name,
            head_sha: push.after.sha,
            status: "in_progress",
            name: "eslint-skill",
            external_id: ctx.correlationId,
            details_url: ctx.audit.url,
            started_at: params.start,
            output: {
                title: "ESLint",
                summary: `Running \`eslint\``,
            },
        })).data.id;

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
        } else if (await fs.pathExists(params.project.path("yarn.lock"))) {
            await params.project.spawn("yarn", ["install"], opts);
        } else {
            await params.project.spawn("npm", ["install"], opts);
        }

        const cfg = ctx.configuration[0].parameters;
        if (cfg.modules?.length > 0) {
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
        const configs = await globFiles(params.project, ".eslintrc.*");
        const pj = await fs.readJson(params.project.path("package.json"));
        if ((configs.length === 0 && !pj.eslintConfig) && !!cfg.config) {
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
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        const result = await params.project.spawn(cmd, args, { log: { write: msg => lines.push(msg) } });

        const violations: Array<{ message: string; path: string; startLine: number; startColumn: number; endLine: number; endColumn: number; severity: number }> = [];
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

        for (const file of filesToDelete) {
            await fs.remove(file);
        }

        const argsString = args.join(" ").split(`${params.project.path()}/`).join("");
        const api = gitHub(params.project.id);
        if (result.status === 0 && violations.length === 0) {
            const clean = (await git.status(params.project)).isClean;
            if (clean) {
                await ctx.audit.log(`ESLint returned no errors or warnings`);
                await api.checks.update({
                    check_run_id: params.checkId,
                    owner: repo.owner,
                    repo: repo.name,
                    head_sha: push.after.sha,
                    conclusion: "success",
                    status: "completed",
                    name: "eslint-skill",
                    external_id: ctx.correlationId,
                    started_at: params.start,
                    completed_at: new Date().toISOString(),
                    output: {
                        title: "ESLint",
                        summary: `Running \`eslint\` resulted in no warnings or errors.

\`$ eslint ${argsString}\``,
                    },
                });
                return {
                    code: 0,
                    reason: `ESLint returned no errors or warnings on [${repo.owner}/${repo.name}](${repo.url})`,
                };
            } else {
                await ctx.audit.log(`ESLint fixed some errors or warnings`);
                await api.checks.update({
                    check_run_id: params.checkId,
                    owner: repo.owner,
                    repo: repo.name,
                    head_sha: push.after.sha,
                    conclusion: "action_required",
                    status: "completed",
                    name: "eslint-skill",
                    external_id: ctx.correlationId,
                    started_at: params.start,
                    completed_at: new Date().toISOString(),
                    output: {
                        title: "ESLint",
                        summary: `Running \`eslint\` fixed some errors and warnings.

\`$ eslint ${argsString}\``,
                    },
                });
                return {
                    code: 0,
                    reason: `ESLint fixed some errors or warnings on [${repo.owner}/${repo.name}](${repo.url})`,
                };
            }
        } else if (result.status === 1 || violations.length > 0) {
            const check = (await api.checks.update({
                check_run_id: params.checkId,
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
                    check_run_id: params.checkId,
                    owner: repo.owner,
                    repo: repo.name,
                    output: {
                        title: "ESLint",
                        summary: `Running \`eslint\` resulted in warnings and/or errors.

\`$ eslint ${argsString}\``,
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
                reason: `ESLint raised [errors or warnings](${check.html_url}) on [${repo.owner}/${repo.name}](${repo.url})`,
            };
        } else if (result.status === 2) {
            await ctx.audit.log(`Running ESLint failed with configuration or internal error:`, Severity.ERROR);
            await ctx.audit.log(lines.join("\n"), Severity.ERROR);
            await api.checks.update({
                check_run_id: params.checkId,
                owner: repo.owner,
                repo: repo.name,
                head_sha: push.after.sha,
                conclusion: "action_required",
                status: "completed",
                name: "eslint-skill",
                external_id: ctx.correlationId,
                started_at: params.start,
                completed_at: new Date().toISOString(),
                output: {
                    title: "ESLint",
                    summary: `Running ESLint failed with a configuration error.

\`$ eslint ${argsString}\`

\`\`\`
${lines.join("\n")}
\`\`\``,
                },
            });
            return {
                code: 1,
                reason: `Running ESLint failed with a configuration error`,
            };
        } else {
            await api.checks.update({
                check_run_id: params.checkId,
                owner: repo.owner,
                repo: repo.name,
                head_sha: push.after.sha,
                conclusion: "action_required",
                status: "completed",
                name: "eslint-skill",
                external_id: ctx.correlationId,
                started_at: params.start,
                completed_at: new Date().toISOString(),
                output: {
                    title: "ESLint",
                    summary: `Unknown ESLint exit code: \`${result.status}\``,
                },
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
        const commitMsg = cfg.commitMsg;
        const branch = `eslint-${push.branch}`;
        const commitOptions = {
            name: push.after.author?.name,
            email: push.after.author?.emails?.[0]?.address,
        };

        if (pushCfg === "pr" || (push.branch === push.repo.defaultBranch && pushCfg === "pr_default")) {
            const changedFiles = (await params.project.exec("git", ["diff", "--name-only"]))
                .stdout.split("\n").filter(f => !!f && f.length > 0);
            const body = `ESLint fixed warnings and/or errors in the following files:

${changedFiles.map(f => ` * \`${f}\``)}`;
            await git.createBranch(params.project, branch);
            await git.commit(params.project, commitMsg, commitOptions);
            await git.push(params.project, { force: true, branch });

            try {
                const api = gitHub(params.project.id);
                let pr;
                const openPrs = (await api.pulls.list({
                    owner: repo.owner,
                    repo: repo.name,
                    state: "open",
                    base: push.branch,
                    per_page: 100,
                })).data;
                if (openPrs.length === 1) {
                    pr = openPrs[0];
                    await api.pulls.update({
                        owner: repo.owner,
                        repo: repo.name,
                        pull_number: pr.number,
                        body,
                    });
                } else {
                    pr = (await api.pulls.create({
                        owner: repo.owner,
                        repo: repo.name,
                        title: "ESLint fixes",
                        body,
                        base: push.branch,
                        head: branch,
                    })).data;
                }
                await api.pulls.createReviewRequest({
                    owner: repo.owner,
                    repo: repo.name,
                    pull_number: pr.number,
                    reviewers: [push.after.author.login],
                });
                return {
                    code: 0,
                    reason: `Pushed ESLint fixes to [${repo.owner}/${repo.name}/${branch}](${repo.url}) and raised PR [#${pr.number}](${pr.html_url})`,
                };
            } catch (e) {
                // This might fail if the PR already exists
            }
            return {
                code: 0,
                reason: `Pushed ESLint fixes to [${repo.owner}/${repo.name}/${branch}](${repo.url})`,
            };

        } else if (pushCfg === "commit" || (push.branch === push.repo.defaultBranch && pushCfg === "commit_default")) {
            await git.commit(params.project, commitMsg, commitOptions);
            await git.push(params.project);
            return {
                code: 0,
                reason: `Pushed ESLint fixes to [${repo.owner}/${repo.name}/${push.branch}](${repo.url})`,
            };
        }
        return {
            code: 0,
            reason: `Not pushed ESLint fixes because of configuration`,
        };
    },
};

const ClosePrStep: LintStep = {
    name: "close pr",
    runWhen: async (ctx, params) => {
        return (await git.status(params.project)).isClean;
    },
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        const repo = push.repo;

        const api = gitHub(params.project.id);
        const openPrs = (await api.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: "open",
            base: push.branch,
            per_page: 100,
        })).data;

        for (const openPr of openPrs) {
            await ctx.audit.log(`Closing ESLint fix pull request [#${openPr.number}](${openPr.html_url}) because it is no longer needed`);
            await api.issues.createComment({
                owner: repo.owner,
                repo: repo.name,
                issue_number: openPr.number,
                body: "Closing pull request because all changes have been applied to base branch",
            });
            await api.pulls.update({
                owner: repo.owner,
                repo: repo.name,
                pull_number: openPr.number,
                state: "closed",
            });
        }

        return {
            code: 0,
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
            ClosePrStep,
            PushStep,
        ],
    });
};
