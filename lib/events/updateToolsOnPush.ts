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
	project,
	repository,
	runSteps,
	secret,
	status,
	Step,
} from "@atomist/skill";
import * as fs from "fs-extra";
import {
	DefaultLintConfiguration,
	LintConfiguration,
	NpmDevInstallArgs,
} from "../configuration";
import {
	LintOnPushSubscription,
	UpdateToolsOnPushSubscription,
} from "../typings/types";
import * as _ from "lodash";

interface UpdateParameters {
	project: project.Project;
	credential: secret.GitHubCredential | secret.GitHubAppCredential;
}

type UpdateStep = Step<
	EventContext<UpdateToolsOnPushSubscription, LintConfiguration>,
	UpdateParameters
>;

const SetupStep: UpdateStep = {
	name: "clone repository",
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		const repo = push.repo;

		if (push.branch !== push.repo.defaultBranch) {
			return status
				.success(`Ignore push to non-default branch`)
				.hidden()
				.abort();
		}

		if (ctx.configuration?.[0]?.parameters?.configure === "none") {
			return status
				.success(`No configuration updates requested`)
				.hidden()
				.abort();
		}

		await ctx.audit.log(
			`Updating ESLint configuration on ${repo.owner}/${repo.name}`,
		);

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
		await ctx.audit.log(
			`Cloned repository ${repo.owner}/${
				repo.name
			} at sha ${push.after.sha.slice(0, 7)}`,
		);

		if (!(await fs.pathExists(params.project.path("package.json")))) {
			return status
				.success("Project is not an npm project")
				.hidden()
				.abort();
		}

		const includeGlobs = (
			ctx.configuration?.[0]?.parameters?.ext || [".js"]
		)
			.map(e => (!e.startsWith(".") ? `.${e}` : e))
			.map(e => `**/*${e}`);
		const ignores = ctx.configuration?.[0]?.parameters?.ignores || [];
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

		return status.success();
	},
};

const NpmInstallStep: UpdateStep = {
	name: "npm install",
	runWhen: async ctx => {
		return ctx.configuration?.[0]?.parameters?.modules?.length > 0;
	},
	run: async (ctx, params) => {
		const opts = { env: { ...process.env, NODE_ENV: "development" } };

		const cfg = ctx.configuration[0].parameters;
		const pj = await fs.readJson(params.project.path("package.json"));
		const modules = cfg.modules.filter(
			m =>
				!pj.dependencies?.[moduleName(m)] &&
				!pj.devDependencies?.[moduleName(m)],
		);
		if (modules.length > 0) {
			await ctx.audit.log("Installing configured npm packages");
			await params.project.spawn(
				"npm",
				["install", ...modules, ...NpmDevInstallArgs],
				opts,
			);
		}

		return status.success();
	},
};

const ConfigureEslintStep: UpdateStep = {
	name: "configure eslint",
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		const repo = push.repo;
		const cfg: LintConfiguration = {
			...DefaultLintConfiguration,
			...ctx.configuration[0].parameters,
		};

		const configFile = params.project.path(`.eslintrc.json`);
		const ignoreFile = params.project.path(`.eslintignore`);

		// Add .eslintignore
		if (cfg.ignores) {
			await fs.writeFile(ignoreFile, `${cfg.ignores.join("\n")}\n`);
		}

		// Add .eslintrc.json
		if (cfg.config) {
			await fs.writeFile(configFile, cfg.config);
		}

		if ((await git.status(params.project)).isClean) {
			return status.success(
				`No configuration updates in [${repo.owner}/${repo.name}](${repo.url})`,
			);
		} else {
			return status.success(
				`Updated configuration in [${repo.owner}/${repo.name}](${repo.url})`,
			);
		}
	},
};

const ConfigureHooksStep: UpdateStep = {
	name: "configure hooks",
	runWhen: async ctx => {
		return (
			ctx.configuration?.[0]?.parameters?.configure === "eslint_and_hook"
		);
	},
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		const repo = push.repo;
		const cfg = ctx.configuration[0].parameters;
		const opts = { env: { ...process.env, NODE_ENV: "development" } };

		let pj = await fs.readJson(params.project.path("package.json"));

		const modules = [];
		if (!pj.devDependencies?.eslint && !pj.dependencies?.eslint) {
			modules.push("eslint");
		}
		if (!pj.devDependencies?.husky && !pj.dependencies?.husky) {
			modules.push("husky");
		}
		if (
			!pj.devDependencies?.["lint-staged"] &&
			!pj.dependencies?.["lint-staged"]
		) {
			modules.push("lint-staged");
		}
		if (modules.length > 0) {
			await params.project.spawn(
				"npm",
				["install", ...modules, ...NpmDevInstallArgs],
				opts,
			);
		}

		pj = await fs.readJson(params.project.path("package.json"));

		// Add npm script to run eslint
		const script = `atm:lint:eslint`;

		const args = ["--fix"];
		cfg.args?.forEach(a => args.push(a));
		_.set(pj, `scripts.${script}`, `eslint ${_.uniq(args)}`);

		// Add husky configuration
		if (!pj.husky?.["hooks"]?.["pre-commit"]) {
			_.set(pj, "husky.hooks.pre-commit", "lint-staged");
		} else if (!pj.husky.hooks["pre-commit"].includes("lint-staged")) {
			pj.husky.hooks[
				"pre-commit"
			] = `${pj.husky["pre-commit"]} && lint-staged`;
		}

		// Add lint-staged configuration
		let globs = (ctx.configuration?.[0]?.parameters?.ext || [".js"])
			.map(e => (!e.startsWith(".") ? `.${e}` : e))
			.map(e => `**/*${e}`);
		if (pj["lint-staged"]) {
			// First attempt to delete the previous globs
			for (const g in pj["lint-staged"]) {
				if (pj["lint-staged"][g] === `npm run ${script}`) {
					if (globs.includes(g)) {
						globs = globs.filter(glob => g !== glob);
					} else {
						delete pj["lint-staged"][g];
					}
				}
			}
		} else {
			pj["lint-staged"] = {};
		}
		// Now install the new version
		globs.forEach(g => (pj["lint-staged"][g] = `npm run ${script}`));

		await fs.writeJson(params.project.path("package.json"), pj, {
			spaces: 2,
		});

		if ((await git.status(params.project)).isClean) {
			return status.success(
				`No configuration updates in [${repo.owner}/${repo.name}](${repo.url})`,
			);
		} else {
			return status.success(
				`Updated configuration in [${repo.owner}/${repo.name}](${repo.url})`,
			);
		}
	},
};

const PushStep: UpdateStep = {
	name: "push",
	runWhen: async (ctx, params) => {
		const pushCfg = ctx.configuration[0]?.parameters?.push;
		return (
			!!pushCfg &&
			pushCfg !== "none" &&
			!(await git.status(params.project)).isClean &&
			!(await onlyPackageLockChanged(params.project))
		);
	},
	run: async (ctx, params) => {
		const cfg: LintConfiguration = {
			...DefaultLintConfiguration,
			...ctx.configuration[0].parameters,
		};
		const push = ctx.data.Push[0];
		const repo = push.repo;

		let body = `Update ESLint repository configuration to [skill configuration](https://go.atomist.com/${
			ctx.workspaceId
		}/manage/skills/configure/${ctx.skill.id}/${encodeURIComponent(
			ctx.configuration[0].name,
		)}).`;

		if (
			ctx.configuration?.[0]?.parameters?.configure === "eslint_and_hook"
		) {
			body = `${body}

This pull request configures support for applying ESLint linting rules on every commit locally by using a Git pre-commit hook. The pre-commit hook will only format staged files. To apply the linting rules across your entire repository, run: 

\`$ npm run atm:lint:eslint --- ${cfg.ext
				.map(e => `--ext ${e}`)
				.join(" ")} .\``;
		}

		return github.persistChanges(
			ctx,
			params.project,
			"pr_default",
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
				branch: `atomist/eslint-config-${push.branch}`,
				title: "Update ESLint configuration",
				body,
				labels: cfg.labels,
			},
			{
				message: `Update ESLint repository configuration\n\n[atomist:generated]\n[atomist-skill:${ctx.skill.namespace}/${ctx.skill.name}]`,
			},
		);
	},
};

const ClosePrStep: UpdateStep = {
	name: "close pr",
	runWhen: async (ctx, params) => {
		return (
			(await git.status(params.project)).isClean ||
			(await onlyPackageLockChanged(params.project))
		);
	},
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		await github.closePullRequests(
			ctx,
			params.project,
			push.branch,
			`atomist/eslint-config-${push.branch}`,
			"Closing pull request because configuration has been updated in base branch",
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
			ConfigureEslintStep,
			ConfigureHooksStep,
			ClosePrStep,
			PushStep,
		],
	});

async function onlyPackageLockChanged(p: project.Project): Promise<boolean> {
	const files = await git.changedFiles(p);
	return files.length === 1 && files[0] === "package-lock.json";
}

export function moduleName(module: string): string {
	const ix = module.lastIndexOf("@");
	if (ix > 0) {
		return module.slice(0, ix);
	} else {
		return module;
	}
}
