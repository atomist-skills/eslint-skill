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

import {
	EventContext,
	EventHandler,
	git,
	github,
	log,
	project,
	repository,
	runSteps,
	secret,
	status,
	Step,
} from "@atomist/skill";
import * as fs from "fs-extra";
import * as path from "path";

import {
	DefaultLintConfiguration,
	LintConfiguration,
	NpmDevInstallArgs,
	NpmInstallArgs,
} from "../configuration";
import { LintOnPushSubscription } from "../typings/types";

interface LintParameters {
	project: project.Project;
	credential: secret.GitHubCredential | secret.GitHubAppCredential;
	start: string;
	check: github.Check;
}

type LintStep = Step<
	EventContext<LintOnPushSubscription, LintConfiguration>,
	LintParameters
>;

const SetupStep: LintStep = {
	name: "clone repository",
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		const repo = push.repo;

		if (push.branch.startsWith("atomist/")) {
			return status.success(`Ignore generated branch`).hidden().abort();
		}

		log.info(`Starting ESLint on ${repo.owner}/${repo.name}`);

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
		log.info(
			`Cloned repository ${repo.owner}/${
				repo.name
			} at sha ${push.after.sha.slice(0, 7)}`,
		);

		if (!(await fs.pathExists(params.project.path("package.json")))) {
			return status
				.success("Project not an npm project")
				.hidden()
				.abort();
		}

		const includeGlobs = (ctx.configuration?.parameters?.ext || [".js"])
			.map(e => (!e.startsWith(".") ? `.${e}` : e))
			.map(e => `**/*${e}`);
		const ignores = ctx.configuration?.parameters?.ignores || [];
		const matchingFiles = await project.globFiles(
			params.project,
			includeGlobs,
			{
				ignore: [".git", "node_modules", ...ignores],
			},
		);
		if (matchingFiles.length === 0) {
			return status
				.success("Project does not contain any matching files")
				.hidden()
				.abort();
		}

		params.check = await github.createCheck(ctx, params.project.id, {
			sha: push.after.sha,
			name: "eslint-skill",
			title: "ESLint",
			body: `Running \`eslint\``,
		});

		return status.success();
	},
};

const NpmInstallStep: LintStep = {
	name: "npm install",
	run: async (ctx, params) => {
		const opts = { env: { ...process.env, NODE_ENV: "development" } };
		let result;
		if (await fs.pathExists(params.project.path("package-lock.json"))) {
			result = await params.project.spawn(
				"npm",
				["ci", ...NpmInstallArgs],
				opts,
			);
		} else {
			result = await params.project.spawn(
				"npm",
				["install", ...NpmInstallArgs],
				opts,
			);
		}
		if (result.status !== 0) {
			return status.failure("`npm install` failed");
		}

		const cfg = ctx.configuration?.parameters;
		if (cfg.modules?.length > 0) {
			log.info("Installing configured npm packages");
			result = await params.project.spawn(
				"npm",
				["install", ...cfg.modules, ...NpmDevInstallArgs],
				opts,
			);
			if (result.status !== 0) {
				return status.failure("`npm install` failed");
			}

			result = await params.project.spawn(
				"git",
				["reset", "--hard"],
				opts,
			);
			if (result.status !== 0) {
				return status.failure("`git reset --hard` failed");
			}
		}
		return status.success();
	},
};

const ValidateRepositoryStep: LintStep = {
	name: "validate",
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		const repo = push.repo;

		if (
			!(await fs.pathExists(
				params.project.path("node_modules", ".bin", "eslint"),
			))
		) {
			return status.failure(
				`No \`eslint\` installed in [${repo.owner}/${repo.name}](${repo.url})`,
			);
		}
		return status.success();
	},
};

const RunEslintStep: LintStep = {
	name: "run eslint",
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		const repo = push.repo;
		const cfg: LintConfiguration = {
			...DefaultLintConfiguration,
			...(ctx.configuration?.parameters || {}),
		};
		const cmd = params.project.path("node_modules", ".bin", "eslint");
		const args: string[] = [];
		const reportFile = params.project.path(
			`eslintreport-${push.after.sha.slice(0, 7)}.json`,
		);
		const configFile = params.project.path(
			`.eslintrc-${push.after.sha.slice(0, 7)}.json`,
		);
		const ignoreFile = params.project.path(
			`.eslintignore-${push.after.sha.slice(0, 7)}`,
		);
		const formatterFile = params.project.path(
			`.eslintformatter-${push.after.sha.slice(0, 7)}`,
		);
		await fs.copyFile(
			path.join(process.cwd(), "lib", "util", "formatter.js"),
			formatterFile,
		);

		const filesToDelete = [reportFile, formatterFile];

		cfg.ext?.forEach(e => args.push("--ext", e));
		cfg.args?.forEach(a => args.push(a));

		// Add .eslintignore if missing
		if (
			!(await fs.pathExists(params.project.path(".eslintignore"))) &&
			!!cfg.ignores
		) {
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
		const argsString = args
			.join(" ")
			.split(`${params.project.path()}/`)
			.join("");
		log.info(`Running ESLint with: $ eslint ${argsString}`);

		// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
		const result = await params.project.spawn(
			cmd,
			[...args, "--format", formatterFile, "--no-color"],
			{
				log: { write: msg => lines.push(msg) },
				env: {
					...process.env,
					ESLINT_REPORT_FILE: reportFile,
				},
			},
		);
		log.info(lines.join("\n"));

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
				log.info(`ESLint returned no errors or warnings`);
				await params.check.update({
					conclusion: "success",
					body: `Running \`eslint\` resulted in no warnings or errors.

\`$ eslint ${argsString}\``,
				});
				return status.success(
					`\`eslint\` returned no errors or warnings on [${repo.owner}/${repo.name}](${repo.url})`,
				);
			} else {
				log.info(`ESLint fixed some errors or warnings`);
				await params.check.update({
					conclusion: "action_required",
					body: `Running \`eslint\` fixed some errors and warnings.

\`$ eslint ${argsString}\``,
				});
				return status.success(
					`\`eslint\` fixed some errors or warnings on [${repo.owner}/${repo.name}](${repo.url})`,
				);
			}
		} else if (result.status === 1 || violations.length > 0) {
			await params.check.update({
				conclusion: violations.some(v => v.severity === 2)
					? "action_required"
					: "neutral",
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

			return status.success(
				`\`eslint\` raised [errors or warnings](${params.check.data.html_url}) on [${repo.owner}/${repo.name}](${repo.url})`,
			);
		} else if (result.status === 2) {
			log.error(
				`Running ESLint failed with configuration or internal error:`,
			);
			log.error(lines.join("\n"));
			await params.check.update({
				conclusion: "action_required",
				body: `Running ESLint failed with a configuration error.

\`$ eslint ${argsString}\`

\`\`\`
${lines.join("\n")}
\`\`\``,
			});
			return status.failure(
				`Running \`eslint\` failed with a configuration error`,
			);
		} else {
			await params.check.update({
				conclusion: "action_required",
				body: `Unknown ESLint exit code: \`${result.status}\``,
			});
			return status.failure(`Unknown \`eslint\` exit code`).hidden();
		}
	},
};

const PushStep: LintStep = {
	name: "push",
	runWhen: async (ctx, params) => {
		const pushCfg = ctx.configuration?.parameters?.push;
		return (
			!!pushCfg &&
			pushCfg !== "none" &&
			!(await git.status(params.project)).isClean
		);
	},
	run: async (ctx, params) => {
		const cfg: LintConfiguration = {
			...DefaultLintConfiguration,
			...(ctx.configuration?.parameters || {}),
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
				branch: `atomist/eslint-${push.branch}`,
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
			`atomist/eslint-${push.branch}`,
			"Closing pull request because all fixable warnings and/or errors have been fixed in base branch",
		);
		return status.success();
	},
};

export const handler: EventHandler<
	LintOnPushSubscription,
	LintConfiguration
> = async ctx =>
	runSteps({
		context: ctx,
		steps: [
			SetupStep,
			NpmInstallStep,
			ValidateRepositoryStep,
			RunEslintStep,
			ClosePrStep,
			PushStep,
		],
	});
