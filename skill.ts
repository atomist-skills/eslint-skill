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
	Category,
	LineStyle,
	parameter,
	ParameterType,
	ParameterVisibility,
	resourceProvider,
	skill,
} from "@atomist/skill";
import { LintConfiguration } from "./lib/configuration";

export const Skill = skill<LintConfiguration & { repos: any }>({
	name: "eslint-skill",
	namespace: "atomist",
	displayName: "ESLint",
	author: "Atomist",
	categories: [Category.CodeMaintenance],
	license: "Apache-2.0",

	runtime: {
		memory: 2048,
		timeout: 540,
	},

	resourceProviders: {
		github: resourceProvider.gitHub({ minRequired: 1 }),
		slack: resourceProvider.chat({ minRequired: 0 }),
	},

	parameters: {
		ext: {
			type: ParameterType.StringArray,
			displayName: "Extensions",
			description: "File extensions to lint (defaults to .js)",
			required: false,
		},
		ignores: {
			type: ParameterType.StringArray,
			displayName: "Ignore pattern",
			description: "Pattern of files or folders to ignore during linting",
			required: false,
		},
		config: {
			type: ParameterType.String,
			displayName: "Configuration",
			description:
				"ESLint configuration in JSON format used if project does not contain own configuration. See the [ESLint documentation](https://eslint.org/docs/user-guide/configuring) on how to configure it.",
			lineStyle: LineStyle.Multiple,
			required: false,
		},
		args: {
			type: ParameterType.StringArray,
			displayName: "Extra arguments",
			description:
				"Additional [command line arguments](https://eslint.org/docs/2.13.1/user-guide/command-line-interface) passed to ESLint",
			required: false,
		},
		modules: {
			type: ParameterType.StringArray,
			displayName: "npm packages to install",
			description:
				"Use this parameter to configure npm packages like eslint itself or plugins that should get installed",
			required: false,
		},
		push: parameter.pushStrategy({
			displayName: "Fix problems",
			description:
				"Run ESLint with `--fix` option and determine how and when fixes should be committed back into the repository",
			options: [
				{
					text: "Do not apply fixes",
					value: "none",
				},
			],
		}),
		commitMsg: {
			type: ParameterType.String,
			displayName: "Commit message",
			description:
				"Commit message to use when committing ESLint fixes back into the repository",
			placeHolder: "ESLint fixes",
			required: false,
			visibility: ParameterVisibility.Hidden,
		},
		labels: {
			type: ParameterType.StringArray,
			displayName: "Pull request labels",
			description:
				"Add additional labels to pull requests raised by this skill, e.g. to configure the [auto-merge](https://go.atomist.com/catalog/skills/atomist/github-auto-merge-skill) behavior.",
			required: false,
		},
		configure: {
			type: ParameterType.SingleChoice,
			displayName: "Configure repositories",
			description:
				"Update repositories to use the skill's ESLint configuration",
			options: [
				{
					text:
						"Update ESLint config, ignore files and install Git commit hooks",
					value: "eslint_and_hook",
				},
				{
					text: "Update ESLint config and ignore files",
					value: "eslint_only",
				},
				{
					text: "Don't configure ESLint",
					value: "none",
				},
			],
			defaultValue: "none",
			required: false,
		},
		repos: parameter.repoFilter(),
	},
});
